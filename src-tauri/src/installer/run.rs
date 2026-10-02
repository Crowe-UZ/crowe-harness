//! Runs the verified binary's own installer (`<binary> install <channel>`,
//! exactly what the official scripts do) and checks the result.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt};

use super::{codes, ierr, Cancel, InstallChannel};
use crate::claude::{cli, locate};
use crate::error::{NativeError, NativeResult};

pub const INSTALL_TIMEOUT: Duration = Duration::from_secs(10 * 60);
pub const VERSION_TIMEOUT: Duration = Duration::from_secs(30);
/// Captured output kept per stream (the tail).
const OUTPUT_CAP: usize = 64 * 1024;
const MESSAGE_TAIL_CHARS: usize = 300;

/// Bounded buffer keeping the last `cap` bytes written to it.
#[derive(Debug, Default)]
pub struct TailBuffer {
    buf: Vec<u8>,
    cap: usize,
}

impl TailBuffer {
    pub fn new(cap: usize) -> Self {
        TailBuffer {
            buf: Vec::new(),
            cap,
        }
    }

    pub fn push(&mut self, data: &[u8]) {
        if data.len() >= self.cap {
            self.buf.clear();
            self.buf.extend_from_slice(&data[data.len() - self.cap..]);
            return;
        }
        let overflow = (self.buf.len() + data.len()).saturating_sub(self.cap);
        self.buf.drain(..overflow);
        self.buf.extend_from_slice(data);
    }

    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.buf).into_owned()
    }
}

async fn drain(mut reader: impl AsyncRead + Unpin, sink: Arc<Mutex<TailBuffer>>) {
    let mut chunk = [0u8; 8192];
    while let Ok(n) = reader.read(&mut chunk).await {
        if n == 0 {
            break;
        }
        if let Ok(mut s) = sink.lock() {
            s.push(&chunk[..n]);
        }
    }
}

/// Makes installer output safe and short for an error message: ANSI escape
/// sequences and control characters removed, the home directory replaced by
/// `~`, whitespace collapsed, last [`MESSAGE_TAIL_CHARS`] characters kept.
pub fn sanitize_output(text: &str, home: Option<&Path>) -> String {
    let mut clean = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            // CSI: ESC [ ... final byte in @..~ ; other escapes: drop one char.
            if chars.peek() == Some(&'[') {
                chars.next();
                for f in chars.by_ref() {
                    if ('@'..='~').contains(&f) {
                        break;
                    }
                }
            } else {
                chars.next();
            }
        } else if c.is_control() && !matches!(c, '\n' | '\t') {
            continue;
        } else {
            clean.push(c);
        }
    }
    if let Some(home) = home.map(crate::util::display_path).filter(|h| h.len() > 3) {
        clean = clean.replace(&home, "~");
        if cfg!(windows) {
            clean = clean.replace(&home.replace('\\', "/"), "~");
        }
    }
    let collapsed = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    cli::tail(&collapsed, MESSAGE_TAIL_CHARS)
}

/// Error for a failed `install` run.
pub fn exit_error(code: Option<i32>, output_tail: &str) -> NativeError {
    let mut message = match code {
        Some(137) if cfg!(target_os = "linux") => {
            "the installer was killed (exit 137), most likely because the system ran out of memory"
                .to_owned()
        }
        Some(c) => format!("the Claude Code installer failed (exit code {c})"),
        None => "the Claude Code installer was terminated".to_owned(),
    };
    if !output_tail.is_empty() {
        message.push_str(": ");
        message.push_str(output_tail);
    }
    ierr(codes::INSTALL_FAILED, message)
}

/// `<exe> install <channel>`: no shell, stdin null, no console window,
/// API-key variables removed, Job Object on Windows, 10 minute timeout,
/// cancellable (the process tree is killed).
pub async fn run_install(
    exe: &Path,
    channel: InstallChannel,
    home: &Path,
    cancel: &Cancel,
) -> NativeResult<()> {
    let mut cmd = cli::command(exe); // env scrub, CREATE_NO_WINDOW, stdin null, kill_on_drop
    cmd.args(["install", channel.as_str()])
        .current_dir(home)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| {
        ierr(
            codes::INSTALL_FAILED,
            format!("could not start the Claude Code installer: {e}"),
        )
    })?;
    #[cfg(windows)]
    let _job = crate::claude::turn::job_for(&child); // closed on return: tree killed

    let output = Arc::new(Mutex::new(TailBuffer::new(OUTPUT_CAP)));
    let mut readers = Vec::new();
    if let Some(out) = child.stdout.take() {
        readers.push(tokio::spawn(drain(out, Arc::clone(&output))));
    }
    if let Some(err) = child.stderr.take() {
        readers.push(tokio::spawn(drain(err, Arc::clone(&output))));
    }

    let status = cancel
        .run(tokio::time::timeout(INSTALL_TIMEOUT, child.wait()))
        .await;
    let status = match status {
        Err(cancelled) => {
            let _ = child.start_kill();
            let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
            return Err(cancelled);
        }
        Ok(Err(_elapsed)) => {
            let _ = child.start_kill();
            let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
            return Err(ierr(
                codes::INSTALL_FAILED,
                "the Claude Code installer did not finish within 10 minutes",
            ));
        }
        Ok(Ok(Err(e))) => {
            return Err(ierr(
                codes::INSTALL_FAILED,
                format!("the Claude Code installer could not be monitored: {e}"),
            ))
        }
        Ok(Ok(Ok(status))) => status,
    };
    for r in readers {
        // Grandchildren may keep the pipes open; do not wait for them forever.
        let _ = tokio::time::timeout(Duration::from_secs(2), r).await;
    }
    if status.success() {
        return Ok(());
    }
    let text = output.lock().map(|o| o.text()).unwrap_or_default();
    Err(exit_error(
        status.code(),
        &sanitize_output(&text, Some(home)),
    ))
}

/// Finds the native launcher the installer created and runs `--version`.
pub async fn check_installed(home: &Path) -> NativeResult<(PathBuf, String)> {
    let launcher = locate::native_launcher(home).ok_or_else(|| {
        ierr(
            codes::INSTALL_FAILED,
            "the installer finished, but the Claude Code launcher was not found in ~/.local/bin",
        )
    })?;
    let out = cli::run(&launcher, &["--version"], VERSION_TIMEOUT)
        .await
        .map_err(|e| {
            ierr(
                codes::INSTALL_FAILED,
                format!(
                    "the installed Claude Code could not be started ({})",
                    e.message
                ),
            )
        })?;
    let version = (out.code == Some(0))
        .then(|| locate::parse_version(&out.stdout))
        .flatten()
        .ok_or_else(|| {
            let tail = sanitize_output(&format!("{}\n{}", out.stdout, out.stderr), Some(home));
            ierr(
                codes::INSTALL_FAILED,
                format!("the installed Claude Code did not report its version: {tail}"),
            )
        })?;
    Ok((launcher, version))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tail_buffer_keeps_the_end() {
        let mut t = TailBuffer::new(8);
        t.push(b"abc");
        t.push(b"defgh");
        assert_eq!(t.text(), "abcdefgh");
        t.push(b"ij");
        assert_eq!(t.text(), "cdefghij");
        t.push(b"0123456789");
        assert_eq!(t.text(), "23456789");
    }

    #[test]
    fn output_is_sanitized() {
        let home = if cfg!(windows) {
            PathBuf::from(r"C:\Users\someone")
        } else {
            PathBuf::from("/home/someone")
        };
        let raw = format!(
            "\u{1b}[31mError:\u{1b}[0m failed\r\n  writing {}{}x\u{7}",
            crate::util::display_path(&home),
            std::path::MAIN_SEPARATOR
        );
        let s = sanitize_output(&raw, Some(&home));
        assert!(s.starts_with("Error: failed writing ~"), "{s}");
        assert!(!s.contains('\u{1b}') && !s.contains('\u{7}') && !s.contains("someone"));
        let long = "x ".repeat(1000);
        assert!(sanitize_output(&long, None).chars().count() <= MESSAGE_TAIL_CHARS + 1);
    }

    #[test]
    fn exit_codes() {
        let e = exit_error(Some(1), "boom");
        assert_eq!(e.code, codes::INSTALL_FAILED);
        assert!(e.message.contains("exit code 1") && e.message.ends_with("boom"));
        let oom = exit_error(Some(137), "");
        assert_eq!(oom.code, codes::INSTALL_FAILED);
        if cfg!(target_os = "linux") {
            assert!(oom.message.contains("memory"));
        }
        assert!(exit_error(None, "").message.contains("terminated"));
    }

    #[tokio::test]
    async fn missing_launcher_is_install_failed() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let err = check_installed(tmp.path()).await.expect_err("missing");
        assert_eq!(err.code, codes::INSTALL_FAILED);
    }
}
