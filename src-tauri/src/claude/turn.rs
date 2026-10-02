//! Live turns: one headless `claude -p` process per turn, streamed to the
//! webview through a per-call `tauri::ipc::Channel<TurnEvent>`.
//!
//! Each process is placed in a Windows Job Object with
//! `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`; the job handle lives in the
//! [`TurnRegistry`] entry. Removing the entry (cancel, turn end, app exit)
//! closes the handle and kills the whole process tree (claude → node → MCP
//! servers), and also wakes the supervisor task.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Deserialize;
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Child;
use tokio::sync::oneshot;

use super::cli::{self, tail};
use super::stream::{StreamMapper, TurnEvent, ERROR_MAX};
use crate::error::{NativeError, NativeResult};
use crate::util::{display_path, is_uuid};

pub const MAX_PROMPT_CHARS: usize = 100_000;
pub const MAX_CONCURRENT_TURNS: usize = 8;
const STDERR_LINES: usize = 50;
const STDERR_LINE_MAX: usize = 500;
const RESULT_GRACE: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PermissionMode {
    Default,
    AcceptEdits,
    Plan,
}

impl PermissionMode {
    pub fn as_arg(self) -> &'static str {
        match self {
            PermissionMode::Default => "default",
            PermissionMode::AcceptEdits => "acceptEdits",
            PermissionMode::Plan => "plan",
        }
    }
}

/// Validated turn request (everything except the project path comes from
/// the webview).
#[derive(Debug)]
pub struct TurnSpec {
    pub exe: PathBuf,
    pub cwd: PathBuf,
    pub session_id: Option<String>,
    pub prompt: String,
    pub permission_mode: PermissionMode,
}

pub fn validate_prompt(prompt: &str) -> NativeResult<()> {
    if prompt.trim().is_empty() {
        return Err(NativeError::invalid("prompt is empty"));
    }
    if prompt.chars().count() > MAX_PROMPT_CHARS {
        return Err(NativeError::invalid(format!(
            "prompt is longer than {MAX_PROMPT_CHARS} characters"
        )));
    }
    Ok(())
}

pub fn validate_session_id(id: Option<&str>) -> NativeResult<()> {
    match id {
        Some(id) if !is_uuid(id) => Err(NativeError::invalid("invalid session id")),
        _ => Ok(()),
    }
}

/// CLI arguments, built only from allow-listed values.
pub fn build_args(mode: PermissionMode, session_id: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--input-format",
        "stream-json",
        "--permission-mode",
        mode.as_arg(),
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    if let Some(id) = session_id {
        args.push("--resume".into());
        args.push(id.to_owned());
    }
    args
}

/// The single stdin line carrying the user prompt.
pub fn stdin_line(prompt: &str) -> String {
    let v = serde_json::json!({
        "type": "user",
        "message": { "role": "user", "content": [ { "type": "text", "text": prompt } ] }
    });
    format!("{v}\n")
}

struct TurnEntry {
    /// Dropping the sender wakes the supervisor (cancellation).
    _cancel: oneshot::Sender<()>,
    #[cfg(windows)]
    _job: Option<win32job::Job>,
}

#[derive(Default)]
pub struct TurnRegistry {
    turns: Mutex<HashMap<String, TurnEntry>>,
}

impl TurnRegistry {
    fn insert(&self, id: String, entry: TurnEntry) {
        if let Ok(mut t) = self.turns.lock() {
            t.insert(id, entry);
        }
    }

    pub fn len(&self) -> usize {
        self.turns.lock().map_or(0, |t| t.len())
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Cancels a turn. Returns `false` when it is unknown or already over.
    pub fn cancel(&self, id: &str) -> bool {
        let entry = self.turns.lock().ok().and_then(|mut t| t.remove(id));
        entry.is_some() // dropped here: job closed (tree killed), supervisor woken
    }

    /// Kills every running turn (app exit).
    pub fn kill_all(&self) {
        let drained: Vec<TurnEntry> = self
            .turns
            .lock()
            .map(|mut t| t.drain().map(|(_, e)| e).collect())
            .unwrap_or_default();
        drop(drained);
    }
}

#[cfg(windows)]
pub(crate) fn job_for(child: &Child) -> Option<win32job::Job> {
    let handle = child.raw_handle()? as isize;
    let mut info = win32job::ExtendedLimitInfo::new();
    info.limit_kill_on_job_close();
    let job = win32job::Job::create_with_limit_info(&info).ok()?;
    job.assign_process(handle).ok()?;
    Some(job)
}

/// Spawns the turn and returns its id. Events flow through `channel`; the
/// last event is always `exit`.
pub async fn start(
    registry: Arc<TurnRegistry>,
    spec: TurnSpec,
    channel: Channel<TurnEvent>,
) -> NativeResult<String> {
    validate_prompt(&spec.prompt)?;
    validate_session_id(spec.session_id.as_deref())?;
    if registry.len() >= MAX_CONCURRENT_TURNS {
        return Err(NativeError::new(
            "too_many_turns",
            "too many turns are running; wait for one to finish",
        ));
    }

    let mut cmd = cli::command(&spec.exe);
    cmd.args(build_args(spec.permission_mode, spec.session_id.as_deref()))
        .current_dir(plain_cwd(&spec.cwd))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| {
        NativeError::new("spawn_failed", format!("could not start Claude Code: {e}"))
    })?;

    #[cfg(windows)]
    let job = job_for(&child);

    if let Some(mut stdin) = child.stdin.take() {
        // Written concurrently with stdout draining (no pipe deadlock). A write
        // error means the process already died; the supervisor reports it.
        let line = stdin_line(&spec.prompt);
        tauri::async_runtime::spawn(async move {
            let _ = stdin.write_all(line.as_bytes()).await;
            let _ = stdin.shutdown().await;
        });
    }

    let turn_id = uuid::Uuid::new_v4().to_string();
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    registry.insert(
        turn_id.clone(),
        TurnEntry {
            _cancel: cancel_tx,
            #[cfg(windows)]
            _job: job,
        },
    );
    let reg = Arc::clone(&registry);
    let id = turn_id.clone();
    tauri::async_runtime::spawn(async move {
        supervise(child, cancel_rx, channel).await;
        reg.cancel(&id); // closes the job: leftover grandchildren are killed
    });
    Ok(turn_id)
}

fn plain_cwd(p: &Path) -> PathBuf {
    PathBuf::from(display_path(p))
}

async fn supervise(
    mut child: Child,
    mut cancel_rx: oneshot::Receiver<()>,
    channel: Channel<TurnEvent>,
) {
    let send = |ev: TurnEvent| {
        let _ = channel.send(ev); // the webview may be gone; keep draining
    };

    let stderr_tail: Arc<Mutex<VecDeque<String>>> = Arc::default();
    let stderr_task = child.stderr.take().map(|stderr| {
        let tail_buf = Arc::clone(&stderr_tail);
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Ok(mut t) = tail_buf.lock() {
                    if t.len() == STDERR_LINES {
                        t.pop_front();
                    }
                    t.push_back(line.chars().take(STDERR_LINE_MAX).collect());
                }
            }
        })
    });

    let mut mapper = StreamMapper::default();
    let mut cancelled = false;
    if let Some(stdout) = child.stdout.take() {
        let mut lines = BufReader::new(stdout).lines();
        loop {
            let after_result = mapper.got_result();
            tokio::select! {
                _ = &mut cancel_rx => { cancelled = true; break; }
                line = lines.next_line() => match line {
                    Ok(Some(l)) => for ev in mapper.handle_line(&l) { send(ev) },
                    Ok(None) | Err(_) => break,
                },
                // A grandchild that inherited stdout must not keep a finished
                // turn open: after the result, stop at the first quiet period.
                _ = tokio::time::sleep(RESULT_GRACE), if after_result => break,
            }
        }
    }

    if cancelled {
        let _ = child.start_kill();
    }
    let wait = if cancelled {
        Duration::from_secs(5)
    } else {
        Duration::from_secs(15)
    };
    let code = match tokio::time::timeout(wait, child.wait()).await {
        Ok(Ok(status)) => status.code(),
        _ => {
            let _ = child.start_kill();
            None
        }
    };
    if let Some(task) = stderr_task {
        // Grandchildren may keep stderr open; do not wait for them forever.
        let _ = tokio::time::timeout(Duration::from_secs(1), task).await;
    }

    if cancelled {
        for ev in mapper.interrupt() {
            send(ev);
        }
    } else {
        if !mapper.got_result() && code != Some(0) {
            let stderr = stderr_tail
                .lock()
                .map(|t| t.iter().cloned().collect::<Vec<_>>().join("\n"))
                .unwrap_or_default();
            let code_txt = code.map_or_else(|| "unknown".to_owned(), |c| c.to_string());
            let mut message = format!("Claude Code exited with code {code_txt}");
            if !stderr.trim().is_empty() {
                message.push_str(": ");
                message.push_str(&tail(&stderr, ERROR_MAX));
            }
            send(TurnEvent::Error { message });
        }
        for ev in mapper.finish() {
            send(ev);
        }
    }
    send(TurnEvent::Exit { code });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_mode_is_a_closed_enum() {
        let ok: PermissionMode = serde_json::from_str("\"acceptEdits\"").expect("ok");
        assert_eq!(ok.as_arg(), "acceptEdits");
        assert!(serde_json::from_str::<PermissionMode>("\"bypassPermissions\"").is_err());
        assert!(serde_json::from_str::<PermissionMode>("\"Plan\"").is_err());
    }

    #[test]
    fn args_and_validation() {
        let args = build_args(
            PermissionMode::Plan,
            Some("11111111-2222-3333-4444-555555555555"),
        );
        assert_eq!(
            args,
            [
                "-p",
                "--output-format",
                "stream-json",
                "--verbose",
                "--include-partial-messages",
                "--input-format",
                "stream-json",
                "--permission-mode",
                "plan",
                "--resume",
                "11111111-2222-3333-4444-555555555555"
            ]
        );
        assert!(!build_args(PermissionMode::Default, None).contains(&"--resume".to_owned()));
        assert!(validate_prompt("  ").is_err());
        assert!(validate_prompt("hi").is_ok());
        assert!(validate_prompt(&"x".repeat(MAX_PROMPT_CHARS + 1)).is_err());
        assert!(validate_session_id(Some("--dangerously-skip-permissions")).is_err());
        assert!(validate_session_id(None).is_ok());
    }

    #[test]
    fn stdin_line_is_one_json_line() {
        let line = stdin_line("say \"hi\"\nand bye");
        assert!(line.ends_with('\n'));
        assert_eq!(line.matches('\n').count(), 1);
        let v: serde_json::Value = serde_json::from_str(line.trim()).expect("json");
        assert_eq!(v["type"], "user");
        assert_eq!(v["message"]["content"][0]["text"], "say \"hi\"\nand bye");
    }

    /// Channel that records every event as JSON.
    fn recording_channel() -> (Channel<TurnEvent>, Arc<Mutex<Vec<serde_json::Value>>>) {
        let seen: Arc<Mutex<Vec<serde_json::Value>>> = Arc::default();
        let sink = Arc::clone(&seen);
        let channel = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(s) = body {
                if let (Ok(v), Ok(mut seen)) = (serde_json::from_str(&s), sink.lock()) {
                    seen.push(v);
                }
            }
            Ok(())
        });
        (channel, seen)
    }

    fn types(events: &[serde_json::Value]) -> Vec<String> {
        events
            .iter()
            .map(|e| e["type"].as_str().unwrap_or_default().to_owned())
            .collect()
    }

    // The fake "claude" is `cmd /c type <file>` (test only: production code never uses a shell).
    #[cfg(windows)]
    #[tokio::test]
    async fn supervisor_streams_a_fake_turn_and_exits_last() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let script = tmp.path().join("out.ndjson");
        std::fs::write(
            &script,
            [
                r#"{"type":"system","subtype":"init","session_id":"s1","model":"m"}"#,
                r#"{"type":"stream_event","event":{"type":"message_start","message":{"id":"msg_1"}}}"#,
                r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}}"#,
                r#"{"type":"result","is_error":false,"result":"hi","session_id":"s1","usage":{"input_tokens":1,"output_tokens":1}}"#,
            ]
            .join("\r\n"),
        )
        .expect("write");
        let child = tokio::process::Command::new("cmd")
            .args(["/c", "type"])
            .arg(&script)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .expect("spawn");
        let (channel, seen) = recording_channel();
        let (_tx, rx) = oneshot::channel::<()>();
        supervise(child, rx, channel).await;
        let events = seen.lock().expect("lock").clone();
        assert_eq!(
            types(&events),
            [
                "session_started",
                "message_start",
                "text_delta",
                "message_end",
                "exit"
            ]
        );
        assert_eq!(events[3]["usage"]["inputTokens"], 1);
        assert_eq!(events[4]["code"], 0);
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn supervisor_reports_failure_and_cancellation() {
        // Non-zero exit without a result => error with stderr tail, then exit.
        let child = tokio::process::Command::new("cmd")
            .args(["/c", "echo boom 1>&2 & exit 3"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .expect("spawn");
        let (channel, seen) = recording_channel();
        let (_tx, rx) = oneshot::channel::<()>();
        supervise(child, rx, channel).await;
        let events = seen.lock().expect("lock").clone();
        assert_eq!(types(&events), ["error", "exit"]);
        let msg = events[0]["message"].as_str().unwrap_or_default();
        assert!(msg.contains("code 3") && msg.contains("boom"), "{msg}");
        assert_eq!(events[1]["code"], 3);

        // Cancellation of a long-running process (dropping the sender = cancel).
        let child = tokio::process::Command::new("cmd")
            .args(["/c", "ping -n 30 127.0.0.1 >nul"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .expect("spawn");
        let job = job_for(&child).expect("job object");
        let (channel, seen) = recording_channel();
        let (tx, rx) = oneshot::channel::<()>();
        let started = std::time::Instant::now();
        let task = tokio::spawn(supervise(child, rx, channel));
        tokio::time::sleep(Duration::from_millis(500)).await;
        // The grandchild (ping) was started after the assignment: it is in the job too.
        let pids = job.query_process_id_list().expect("pids");
        assert!(
            pids.len() >= 2,
            "cmd and ping are in the job: {}",
            pids.len()
        );
        // turn_cancel = drop the registry entry: job handle closed (tree killed) + sender dropped.
        drop(job);
        drop(tx);
        task.await.expect("join");
        assert!(started.elapsed() < Duration::from_secs(10));
        let events = seen.lock().expect("lock").clone();
        assert_eq!(types(&events), ["exit"]);
    }

    #[test]
    fn registry_cancel_is_idempotent() {
        let reg = TurnRegistry::default();
        let (tx, mut rx) = oneshot::channel::<()>();
        reg.insert(
            "t1".into(),
            TurnEntry {
                _cancel: tx,
                #[cfg(windows)]
                _job: None,
            },
        );
        assert_eq!(reg.len(), 1);
        assert!(reg.cancel("t1"));
        assert!(!reg.cancel("t1"));
        assert!(reg.is_empty());
        // The supervisor is woken by the dropped sender.
        assert!(rx.try_recv().is_err());
    }
}
