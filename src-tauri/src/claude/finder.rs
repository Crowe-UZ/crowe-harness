//! Choosing the `claude` to run (docs/NATIVE_API.md, "Locating `claude`"):
//! validation of discovered candidates (`claude --version`), the cached
//! choice, the user's manual override and the diagnostics report.
//!
//! Validation is injectable ([`VersionProbe`]) and so is the environment
//! snapshot ([`Discovery::env`]), so the whole flow is tested with temp dirs
//! and fake probes.

use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::auth::ClaudeInstall;
use super::cli;
use super::locate::{self, Finding, InstallSource, LocateEnv, Os};
use crate::error::{NativeError, NativeResult};
use crate::util::{display_path, is_unc_like};

/// `claude --version` must answer within this time.
pub const VERSION_TIMEOUT: Duration = Duration::from_secs(10);
/// Upper bound of `LocateReport.checked` entries.
pub const MAX_REPORT_ENTRIES: usize = 60;
/// File (in the app config dir) holding the user's manual override.
pub const OVERRIDE_FILE: &str = "claude-code.json";
const MAX_OVERRIDE_BYTES: u64 = 64 * 1024;

// ---------------------------------------------------------------- validation

/// Why a candidate was not accepted (`CheckedLocation.reason`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rejection {
    NotExecutable,
    Timeout,
    BadOutput,
    SpawnFailed,
}

impl Rejection {
    pub const fn code(self) -> &'static str {
        match self {
            Rejection::NotExecutable => "not_executable",
            Rejection::Timeout => "timeout",
            Rejection::BadOutput => "bad_output",
            Rejection::SpawnFailed => "spawn_failed",
        }
    }

    const fn explain(self) -> &'static str {
        match self {
            Rejection::NotExecutable => "it is not a program that can be run",
            Rejection::Timeout => "it did not answer within 10 seconds",
            Rejection::BadOutput => "it did not report a Claude Code version",
            Rejection::SpawnFailed => "it could not be started",
        }
    }
}

pub type ProbeFuture<'a> = Pin<Box<dyn Future<Output = Result<String, Rejection>> + Send + 'a>>;

/// Runs `<exe> --version` and returns the Claude Code version.
pub trait VersionProbe: Send + Sync {
    fn probe<'a>(&'a self, exe: &'a Path) -> ProbeFuture<'a>;
}

/// The real probe: [`probe_version`] with [`VERSION_TIMEOUT`].
pub struct CliProbe;

impl VersionProbe for CliProbe {
    fn probe<'a>(&'a self, exe: &'a Path) -> ProbeFuture<'a> {
        Box::pin(probe_version(exe, VERSION_TIMEOUT))
    }
}

/// `<exe> --version` with the common hardening (no shell, no console
/// window, stdin null, API-key variables removed, merged `PATH` on Unix);
/// accepted when stdout is `<semver> … Claude Code …`.
pub async fn probe_version(exe: &Path, timeout: Duration) -> Result<String, Rejection> {
    if !locate::is_executable(exe) {
        return Err(Rejection::NotExecutable);
    }
    let mut cmd = cli::command(exe);
    cmd.arg("--version")
        .current_dir(std::env::temp_dir())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let child = cmd.spawn().map_err(|e| spawn_rejection(&e))?;
    // On timeout the child is dropped and killed (kill_on_drop).
    let output = tokio::time::timeout(timeout, child.wait_with_output())
        .await
        .map_err(|_| Rejection::Timeout)?
        .map_err(|_| Rejection::SpawnFailed)?;
    locate::parse_claude_version(&String::from_utf8_lossy(&output.stdout))
        .ok_or(Rejection::BadOutput)
}

fn spawn_rejection(e: &std::io::Error) -> Rejection {
    // ERROR_BAD_EXE_FORMAT (193) on Windows, ENOEXEC (8) on Unix.
    let bad_format = if cfg!(windows) { 193 } else { 8 };
    if e.kind() == std::io::ErrorKind::PermissionDenied || e.raw_os_error() == Some(bad_format) {
        Rejection::NotExecutable
    } else {
        Rejection::SpawnFailed
    }
}

/// A validated install.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Located {
    pub exe: PathBuf,
    pub source: InstallSource,
    /// Version reported by `--version` when it was validated.
    pub version: String,
}

impl Located {
    pub fn install(&self) -> ClaudeInstall {
        ClaudeInstall {
            path: display_path(&self.exe),
            version: Some(self.version.clone()),
            source: self.source,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CheckResult {
    Ok,
    Missing,
    Rejected,
}

/// One checked location (internal form of [`CheckedLocation`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Check {
    pub source: InstallSource,
    pub path: PathBuf,
    pub result: CheckResult,
    pub reason: Option<Rejection>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// Stop at the first candidate that validates (status, spawning).
    FirstValid,
    /// Validate every candidate (diagnostics).
    All,
}

#[derive(Debug, Clone, Default)]
pub struct Outcome {
    pub chosen: Option<Located>,
    pub checks: Vec<Check>,
}

/// Validates `findings` in order; the first candidate that validates is chosen.
pub async fn validate(findings: Vec<Finding>, probe: &dyn VersionProbe, mode: Mode) -> Outcome {
    let mut out = Outcome::default();
    for finding in findings {
        let Some(candidate) = finding.candidate else {
            out.checks.push(Check {
                source: finding.source,
                path: finding.path,
                result: CheckResult::Missing,
                reason: None,
            });
            continue;
        };
        if mode == Mode::FirstValid && out.chosen.is_some() {
            break;
        }
        let (result, reason) = match probe.probe(&candidate.exe).await {
            Ok(version) => {
                if out.chosen.is_none() {
                    out.chosen = Some(Located {
                        exe: candidate.exe.clone(),
                        source: candidate.source,
                        version,
                    });
                }
                (CheckResult::Ok, None)
            }
            Err(rejection) => (CheckResult::Rejected, Some(rejection)),
        };
        out.checks.push(Check {
            source: candidate.source,
            path: candidate.exe,
            result,
            reason,
        });
    }
    out
}

// ---------------------------------------------------------------- report

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CheckedLocation {
    /// The home directory is shown as `~`.
    pub path: String,
    pub source: InstallSource,
    pub result: CheckResult,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocateReport {
    pub chosen: Option<ClaudeInstall>,
    pub checked: Vec<CheckedLocation>,
}

/// `path` for display, with the home directory replaced by `~`.
pub fn tilde(path: &Path, home: Option<&Path>) -> String {
    let shown = display_path(path);
    let Some(home) = home else {
        return shown;
    };
    let home = display_path(home);
    let home = home.trim_end_matches(['\\', '/']);
    let Some(head) = shown.get(..home.len()).filter(|_| !home.is_empty()) else {
        return shown;
    };
    let same = if cfg!(windows) {
        head.eq_ignore_ascii_case(home)
    } else {
        head == home
    };
    let rest = &shown[home.len()..];
    if same && (rest.is_empty() || rest.starts_with(['\\', '/'])) {
        format!("~{rest}")
    } else {
        shown
    }
}

/// The report: every candidate plus missing locations, at most
/// [`MAX_REPORT_ENTRIES`] entries (overflowing misses are summarized per
/// source as `"N more locations"` with reason `"summarized"`).
pub fn build_report(outcome: &Outcome, home: Option<&Path>) -> LocateReport {
    let found = outcome
        .checks
        .iter()
        .filter(|c| c.result != CheckResult::Missing)
        .count();
    let budget = MAX_REPORT_ENTRIES.saturating_sub(found + InstallSource::ALL.len());
    let mut missing_kept = 0usize;
    let mut dropped: Vec<(InstallSource, usize)> = Vec::new();
    let mut checked = Vec::new();
    for c in &outcome.checks {
        if c.result == CheckResult::Missing {
            if missing_kept >= budget {
                match dropped.iter_mut().find(|(s, _)| *s == c.source) {
                    Some((_, n)) => *n += 1,
                    None => dropped.push((c.source, 1)),
                }
                continue;
            }
            missing_kept += 1;
        }
        checked.push(CheckedLocation {
            path: tilde(&c.path, home),
            source: c.source,
            result: c.result,
            reason: c.reason.map(|r| r.code().to_owned()),
        });
    }
    for (source, n) in dropped {
        checked.push(CheckedLocation {
            path: format!("{n} more locations"),
            source,
            result: CheckResult::Missing,
            reason: Some("summarized".to_owned()),
        });
    }
    LocateReport {
        chosen: outcome.chosen.as_ref().map(Located::install),
        checked,
    }
}

// ---------------------------------------------------------------- manual override

#[derive(Debug, Serialize, Deserialize)]
struct OverrideFile {
    version: u32,
    executable: String,
}

/// The user's chosen executable, persisted as JSON in the app config dir.
pub struct OverrideStore {
    file: Option<PathBuf>,
    lock: Mutex<()>,
}

impl OverrideStore {
    pub fn new(file: Option<PathBuf>) -> Self {
        OverrideStore {
            file,
            lock: Mutex::new(()),
        }
    }

    /// The persisted path (absolute), if any. A corrupt file is ignored.
    pub fn load(&self) -> Option<PathBuf> {
        let _g = self.lock.lock();
        let file = self.file.as_ref()?;
        let meta = std::fs::metadata(file).ok()?;
        if !meta.is_file() || meta.len() > MAX_OVERRIDE_BYTES {
            return None;
        }
        let text = std::fs::read_to_string(file).ok()?;
        let parsed: OverrideFile = serde_json::from_str(&text).ok()?;
        Some(PathBuf::from(parsed.executable)).filter(|p| p.is_absolute())
    }

    pub fn save(&self, exe: &Path) -> NativeResult<()> {
        let _g = self.lock.lock();
        let Some(file) = &self.file else {
            return Err(NativeError::internal("app config directory is unavailable"));
        };
        let json = serde_json::to_string_pretty(&OverrideFile {
            version: 1,
            executable: display_path(exe),
        })
        .map_err(|_| NativeError::internal("could not encode the Claude Code location"))?;
        if let Some(parent) = file.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| NativeError::io("app config directory", &e))?;
        }
        let tmp = file.with_extension("json.tmp");
        std::fs::write(&tmp, json).map_err(|e| NativeError::io("Claude Code location", &e))?;
        std::fs::rename(&tmp, file).map_err(|e| NativeError::io("Claude Code location", &e))
    }

    pub fn clear(&self) -> NativeResult<()> {
        let _g = self.lock.lock();
        let Some(file) = &self.file else {
            return Ok(());
        };
        match std::fs::remove_file(file) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                Err(NativeError::io("Claude Code location", &e))
            }
            _ => Ok(()),
        }
    }
}

fn invalid_executable(message: impl Into<String>) -> NativeError {
    NativeError::new("invalid_executable", message)
}

fn rejected(r: Rejection) -> NativeError {
    invalid_executable(format!(
        "The selected file is not a working Claude Code: {} ({}).",
        r.explain(),
        r.code()
    ))
}

/// Checks a picked file before running it; returns the path to run.
fn check_picked(picked: &Path, os: Os) -> NativeResult<PathBuf> {
    if !picked.is_absolute() {
        return Err(invalid_executable("Unsupported file location."));
    }
    let ext = picked
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    if matches!(ext.as_deref(), Some("cmd" | "bat" | "ps1")) {
        return Err(rejected(Rejection::NotExecutable));
    }
    if os == Os::Windows
        && !picked
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.eq_ignore_ascii_case(os.exe_name()))
    {
        return Err(invalid_executable(
            "Select claude.exe, the Claude Code program.",
        ));
    }
    let canonical = std::fs::canonicalize(picked)
        .map_err(|_| invalid_executable("The selected file could not be opened."))?;
    if !canonical.is_file() {
        return Err(rejected(Rejection::NotExecutable));
    }
    if is_unc_like(&canonical) {
        return Err(invalid_executable(
            "Claude Code on a network location is not supported.",
        ));
    }
    Ok(if os == Os::Windows {
        canonical
    } else {
        picked.to_path_buf()
    })
}

// ---------------------------------------------------------------- finder (managed state)

/// Builds the environment snapshot for a discovery (blocking; the argument is the override).
pub type EnvBuilder = Arc<dyn Fn(Option<PathBuf>) -> LocateEnv + Send + Sync>;

/// How discovery runs: target OS, version probe and environment snapshot.
pub struct Discovery {
    pub os: Os,
    pub probe: Arc<dyn VersionProbe>,
    pub env: EnvBuilder,
}

impl Discovery {
    pub fn real() -> Self {
        Discovery {
            os: Os::current(),
            probe: Arc::new(CliProbe),
            env: Arc::new(LocateEnv::from_process),
        }
    }
}

/// The chosen `claude`, cached for the app lifetime (re-discovered when
/// forced, when nothing is cached or when the cached file disappeared).
pub struct ClaudeFinder {
    overrides: OverrideStore,
    discovery: Discovery,
    cache: Mutex<Option<Located>>,
    /// Serializes discoveries and override changes.
    busy: tokio::sync::Mutex<()>,
}

impl ClaudeFinder {
    pub fn new(override_file: Option<PathBuf>, discovery: Discovery) -> Self {
        ClaudeFinder {
            overrides: OverrideStore::new(override_file),
            discovery,
            cache: Mutex::new(None),
            busy: tokio::sync::Mutex::new(()),
        }
    }

    /// The cached install if its file still exists.
    pub fn cached(&self) -> Option<Located> {
        self.cache.lock().ok()?.clone().filter(|l| l.exe.is_file())
    }

    pub fn invalidate(&self) {
        self.set_cached(None);
    }

    fn set_cached(&self, value: Option<Located>) {
        if let Ok(mut c) = self.cache.lock() {
            *c = value;
        }
    }

    async fn run(&self, mode: Mode) -> NativeResult<(Outcome, Option<PathBuf>)> {
        let custom = self.overrides.load();
        let build = Arc::clone(&self.discovery.env);
        let os = self.discovery.os;
        let (findings, home) = tokio::task::spawn_blocking(move || {
            let env = build(custom);
            (locate::discover(os, &env), env.home)
        })
        .await
        .map_err(|_| NativeError::internal("background task failed"))?;
        let outcome = validate(findings, self.discovery.probe.as_ref(), mode).await;
        self.set_cached(outcome.chosen.clone());
        Ok((outcome, home))
    }

    /// The install to run: cached, or discovered (`force` always re-discovers).
    pub async fn find(&self, force: bool) -> NativeResult<Option<Located>> {
        if !force {
            if let Some(hit) = self.cached() {
                return Ok(Some(hit));
            }
        }
        let _busy = self.busy.lock().await;
        if !force {
            if let Some(hit) = self.cached() {
                return Ok(Some(hit)); // found by a concurrent discovery
            }
        }
        Ok(self.run(Mode::FirstValid).await?.0.chosen)
    }

    /// Fresh discovery validating every candidate; updates the cache.
    pub async fn report(&self) -> NativeResult<LocateReport> {
        let _busy = self.busy.lock().await;
        let (outcome, home) = self.run(Mode::All).await?;
        Ok(build_report(&outcome, home.as_deref()))
    }

    /// Validates a file the user picked; on success it becomes the override
    /// (persisted) and the cached install. Rejects with `invalid_executable`.
    pub async fn set_override(&self, picked: &Path) -> NativeResult<Located> {
        let exe = check_picked(picked, self.discovery.os)?;
        let version = self.discovery.probe.probe(&exe).await.map_err(rejected)?;
        let _busy = self.busy.lock().await;
        self.overrides.save(picked)?;
        let located = Located {
            exe,
            source: InstallSource::Custom,
            version,
        };
        self.set_cached(Some(located.clone()));
        Ok(located)
    }

    /// Removes the override and re-discovers.
    pub async fn clear_override(&self) -> NativeResult<Option<Located>> {
        {
            let _busy = self.busy.lock().await;
            self.overrides.clear()?;
            self.invalidate();
        }
        self.find(true).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use crate::claude::locate::{Candidate, EXE_NAME};

    /// Reads the fake binary: `ok <version>` validates, `reject <code>` does not.
    struct FakeProbe {
        calls: AtomicUsize,
    }

    impl FakeProbe {
        fn new() -> Arc<Self> {
            Arc::new(FakeProbe {
                calls: AtomicUsize::new(0),
            })
        }

        fn calls(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
    }

    impl VersionProbe for FakeProbe {
        fn probe<'a>(&'a self, exe: &'a Path) -> ProbeFuture<'a> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let text = std::fs::read_to_string(exe).unwrap_or_default();
            Box::pin(async move {
                match text.split_once(' ') {
                    Some(("ok", v)) => Ok(v.trim().to_owned()),
                    Some(("reject", "timeout")) => Err(Rejection::Timeout),
                    Some(("reject", "not_executable")) => Err(Rejection::NotExecutable),
                    Some(("reject", "spawn_failed")) => Err(Rejection::SpawnFailed),
                    _ => Err(Rejection::BadOutput),
                }
            })
        }
    }

    fn write(p: &Path, content: &str) {
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).expect("mkdir");
        }
        std::fs::write(p, content).expect("write");
    }

    struct Fixture {
        _tmp: tempfile::TempDir,
        root: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let tmp = tempfile::tempdir().expect("tempdir");
            // Canonical root so `~` replacement matches canonical candidate paths.
            let root = PathBuf::from(display_path(
                &std::fs::canonicalize(tmp.path()).expect("canonical"),
            ));
            Fixture { _tmp: tmp, root }
        }

        fn p(&self, rel: &str) -> PathBuf {
            rel.split('/').fold(self.root.clone(), |p, s| p.join(s))
        }

        fn home(&self) -> PathBuf {
            self.p("home")
        }

        /// PATH = [bin1, bin2]; home with the native launcher location.
        fn env(&self) -> EnvBuilder {
            let home = self.home();
            let path = std::env::join_paths([self.p("bin1"), self.p("bin2")]).expect("join");
            Arc::new(move |custom| LocateEnv {
                home: Some(home.clone()),
                custom,
                process_path: Some(path.clone()),
                ..LocateEnv::default()
            })
        }

        fn finder(&self, probe: Arc<FakeProbe>) -> ClaudeFinder {
            ClaudeFinder::new(
                Some(self.p("config/claude-code.json")),
                Discovery {
                    os: Os::current(),
                    probe,
                    env: self.env(),
                },
            )
        }

        fn exe(&self, dir: &str) -> PathBuf {
            self.p(dir).join(EXE_NAME)
        }
    }

    fn same(a: &Path, b: &Path) -> bool {
        crate::util::path_key(a) == crate::util::path_key(b)
    }

    fn finding(path: PathBuf, source: InstallSource, exists: bool) -> Finding {
        Finding {
            source,
            path: path.clone(),
            candidate: exists.then_some(Candidate { exe: path, source }),
        }
    }

    #[tokio::test]
    async fn validation_outcomes() {
        let fx = Fixture::new();
        let a = fx.exe("a");
        let b = fx.exe("b");
        let c = fx.exe("c");
        let d = fx.exe("d");
        write(&a, "reject timeout");
        write(&b, "garbage");
        write(&c, "ok 2.1.284");
        write(&d, "ok 2.1.300");
        let findings = vec![
            finding(fx.exe("missing"), InstallSource::Path, false),
            finding(a.clone(), InstallSource::Path, true),
            finding(b.clone(), InstallSource::Local, true),
            finding(c.clone(), InstallSource::Package, true),
            finding(d.clone(), InstallSource::Desktop, true),
        ];

        let probe = FakeProbe::new();
        let out = validate(findings.clone(), probe.as_ref(), Mode::FirstValid).await;
        let chosen = out.chosen.expect("chosen");
        assert_eq!(chosen.exe, c);
        assert_eq!(chosen.source, InstallSource::Package);
        assert_eq!(chosen.version, "2.1.284");
        assert_eq!(probe.calls(), 3, "stops at the first valid candidate");
        let summary: Vec<(CheckResult, Option<&str>)> = out
            .checks
            .iter()
            .map(|c| (c.result, c.reason.map(Rejection::code)))
            .collect();
        assert_eq!(
            summary,
            vec![
                (CheckResult::Missing, None),
                (CheckResult::Rejected, Some("timeout")),
                (CheckResult::Rejected, Some("bad_output")),
                (CheckResult::Ok, None),
            ]
        );

        let probe = FakeProbe::new();
        let all = validate(findings, probe.as_ref(), Mode::All).await;
        assert_eq!(probe.calls(), 4);
        assert_eq!(all.checks.len(), 5);
        assert_eq!(all.chosen.map(|l| l.exe), Some(c));
    }

    #[tokio::test]
    async fn nothing_valid() {
        let fx = Fixture::new();
        let a = fx.exe("a");
        write(&a, "reject not_executable");
        let probe = FakeProbe::new();
        let out = validate(
            vec![finding(a, InstallSource::Path, true)],
            probe.as_ref(),
            Mode::FirstValid,
        )
        .await;
        assert_eq!(out.chosen, None);
        assert_eq!(out.checks[0].reason, Some(Rejection::NotExecutable));
    }

    #[test]
    fn report_shape() {
        let fx = Fixture::new();
        let home = fx.home();
        let exe = home.join(".local").join("bin").join(EXE_NAME);
        let outcome = Outcome {
            chosen: Some(Located {
                exe: exe.clone(),
                source: InstallSource::Local,
                version: "2.1.284".to_owned(),
            }),
            checks: vec![
                Check {
                    source: InstallSource::Custom,
                    path: fx.p("tools/claude"),
                    result: CheckResult::Rejected,
                    reason: Some(Rejection::BadOutput),
                },
                Check {
                    source: InstallSource::Local,
                    path: exe.clone(),
                    result: CheckResult::Ok,
                    reason: None,
                },
            ],
        };
        let json = serde_json::to_value(build_report(&outcome, Some(&home))).expect("json");
        let sep = std::path::MAIN_SEPARATOR;
        assert_eq!(
            json,
            serde_json::json!({
                "chosen": { "path": display_path(&exe), "version": "2.1.284", "source": "local" },
                "checked": [
                    { "path": display_path(&fx.p("tools/claude")), "source": "custom", "result": "rejected", "reason": "bad_output" },
                    { "path": format!("~{sep}.local{sep}bin{sep}{EXE_NAME}"), "source": "local", "result": "ok" },
                ]
            })
        );
        let empty = serde_json::to_value(build_report(&Outcome::default(), None)).expect("json");
        assert_eq!(empty, serde_json::json!({ "chosen": null, "checked": [] }));
    }

    #[test]
    fn report_is_capped_with_summaries() {
        let mut checks: Vec<Check> = (0..80)
            .map(|i| Check {
                source: InstallSource::Path,
                path: PathBuf::from(format!("/p{i}/claude")),
                result: CheckResult::Missing,
                reason: None,
            })
            .collect();
        checks.push(Check {
            source: InstallSource::Desktop,
            path: PathBuf::from("/d/claude"),
            result: CheckResult::Rejected,
            reason: Some(Rejection::SpawnFailed),
        });
        checks.extend((0..10).map(|i| Check {
            source: InstallSource::Package,
            path: PathBuf::from(format!("/pkg{i}/claude")),
            result: CheckResult::Missing,
            reason: None,
        }));
        let report = build_report(
            &Outcome {
                chosen: None,
                checks,
            },
            None,
        );
        assert!(report.checked.len() <= MAX_REPORT_ENTRIES);
        assert!(report
            .checked
            .iter()
            .any(|c| c.result == CheckResult::Rejected));
        let summaries: Vec<(InstallSource, &str)> = report
            .checked
            .iter()
            .filter(|c| c.reason.as_deref() == Some("summarized"))
            .map(|c| (c.source, c.path.as_str()))
            .collect();
        assert_eq!(
            summaries,
            vec![
                (InstallSource::Path, "26 more locations"),
                (InstallSource::Package, "10 more locations")
            ]
        );
    }

    #[test]
    fn tilde_replacement() {
        let sep = std::path::MAIN_SEPARATOR;
        let home = PathBuf::from(if cfg!(windows) {
            r"C:\Users\me"
        } else {
            "/home/me"
        });
        assert_eq!(tilde(&home.join("x"), Some(&home)), format!("~{sep}x"));
        assert_eq!(tilde(&home, Some(&home)), "~");
        let sibling = PathBuf::from(if cfg!(windows) {
            r"C:\Users\meow\x"
        } else {
            "/home/meow/x"
        });
        assert_eq!(tilde(&sibling, Some(&home)), display_path(&sibling));
        assert_eq!(tilde(&sibling, None), display_path(&sibling));
        if cfg!(windows) {
            assert_eq!(tilde(Path::new(r"\\?\c:\users\ME\a"), Some(&home)), r"~\a");
        }
    }

    #[test]
    fn override_persistence() {
        let fx = Fixture::new();
        let file = fx.p("config/claude-code.json");
        let store = OverrideStore::new(Some(file.clone()));
        assert_eq!(store.load(), None);
        let exe = fx.exe("tools");
        store.save(&exe).expect("save");
        assert_eq!(store.load(), Some(exe.clone()));
        let text = std::fs::read_to_string(&file).expect("read");
        assert!(text.contains("\"version\": 1"), "{text}");
        store.clear().expect("clear");
        assert_eq!(store.load(), None);
        store.clear().expect("clear twice");

        write(&file, "not json");
        assert_eq!(store.load(), None);
        write(&file, r#"{"version":1,"executable":"relative/claude"}"#);
        assert_eq!(store.load(), None);
        assert!(OverrideStore::new(None).save(&exe).is_err());
        assert_eq!(OverrideStore::new(None).load(), None);
    }

    #[tokio::test]
    async fn finder_caches_and_refreshes() {
        let fx = Fixture::new();
        let probe = FakeProbe::new();
        let finder = fx.finder(Arc::clone(&probe));
        assert_eq!(finder.find(false).await.expect("find"), None);

        let local = fx.home().join(".local").join("bin").join(EXE_NAME);
        write(&local, "ok 2.1.284");
        let found = finder.find(false).await.expect("find").expect("found");
        assert_eq!(found.source, InstallSource::Local);
        assert_eq!(found.version, "2.1.284");
        let calls = probe.calls();

        // Cached: no new probe, even though a higher-priority install appeared.
        write(&fx.exe("bin2"), "ok 2.1.290");
        assert_eq!(finder.find(false).await.expect("find"), Some(found.clone()));
        assert_eq!(probe.calls(), calls);

        // "Check again" re-discovers.
        let forced = finder.find(true).await.expect("find").expect("found");
        assert_eq!(forced.source, InstallSource::Path);
        assert_eq!(forced.version, "2.1.290");

        // The cached file disappeared: re-discovered without forcing.
        std::fs::remove_file(fx.exe("bin2")).expect("rm");
        let again = finder.find(false).await.expect("find").expect("found");
        assert_eq!(again.source, InstallSource::Local);
    }

    #[tokio::test]
    async fn manual_override() {
        let fx = Fixture::new();
        let probe = FakeProbe::new();
        let finder = fx.finder(Arc::clone(&probe));
        let auto = fx.exe("bin1");
        write(&auto, "ok 2.1.284");
        let custom = fx.exe("custom");
        write(&custom, "ok 2.0.0");

        let picked = finder.set_override(&custom).await.expect("valid");
        assert_eq!(picked.source, InstallSource::Custom);
        assert_eq!(picked.version, "2.0.0");
        assert_eq!(finder.find(false).await.expect("find"), Some(picked));

        // Persisted: a new finder (app restart) prefers it over PATH.
        let restarted = fx.finder(FakeProbe::new());
        let found = restarted.find(false).await.expect("find").expect("found");
        assert_eq!(found.source, InstallSource::Custom);
        assert!(same(&found.exe, &custom));

        // An override that no longer validates is ignored and reported, not fatal.
        write(&custom, "reject spawn_failed");
        let found = restarted.find(true).await.expect("find").expect("found");
        assert_eq!(found.source, InstallSource::Path);
        let report = restarted.report().await.expect("report");
        let first = report.checked.first().expect("entry");
        assert_eq!(
            (first.source, first.result, first.reason.as_deref()),
            (
                InstallSource::Custom,
                CheckResult::Rejected,
                Some("spawn_failed")
            )
        );
        assert_eq!(report.chosen.map(|c| c.source), Some(InstallSource::Path));

        // Clearing goes back to automatic detection.
        let cleared = restarted
            .clear_override()
            .await
            .expect("clear")
            .expect("found");
        assert_eq!(cleared.source, InstallSource::Path);
        assert_eq!(
            fx.finder(FakeProbe::new())
                .find(false)
                .await
                .expect("find")
                .map(|l| l.source),
            Some(InstallSource::Path)
        );
    }

    #[tokio::test]
    async fn invalid_picks_are_rejected_and_not_persisted() {
        let fx = Fixture::new();
        let finder = fx.finder(FakeProbe::new());
        let bad = fx.exe("bad");
        write(&bad, "garbage");
        let err = finder.set_override(&bad).await.expect_err("invalid");
        assert_eq!(err.code, "invalid_executable");
        assert!(err.message.contains("bad_output"), "{}", err.message);

        let shim = fx.p("npm/claude.cmd");
        write(&shim, "ok 1.0.0");
        let err = finder.set_override(&shim).await.expect_err("shim");
        assert_eq!(err.code, "invalid_executable");
        assert!(err.message.contains("not_executable"), "{}", err.message);

        let err = finder
            .set_override(&fx.exe("missing"))
            .await
            .expect_err("missing");
        assert_eq!(err.code, "invalid_executable");
        let err = finder
            .set_override(Path::new("relative/claude"))
            .await
            .expect_err("relative");
        assert_eq!(err.code, "invalid_executable");

        if cfg!(windows) {
            let other = fx.p("tools/notepad.exe");
            write(&other, "ok 1.0.0");
            let err = finder.set_override(&other).await.expect_err("wrong name");
            assert!(err.message.contains("claude.exe"), "{}", err.message);
        }
        assert!(!fx.p("config/claude-code.json").exists());
    }

    #[tokio::test]
    async fn real_probe_rejects_non_claude_programs() {
        let fx = Fixture::new();
        let script = fx.p("claude.cmd");
        write(&script, "@echo 2.1.284 (Claude Code)");
        assert_eq!(
            probe_version(&script, VERSION_TIMEOUT).await,
            Err(Rejection::NotExecutable)
        );
        assert_eq!(
            probe_version(&fx.exe("missing"), VERSION_TIMEOUT).await,
            Err(Rejection::NotExecutable)
        );
        // A real program that is not Claude Code.
        #[cfg(windows)]
        let other = PathBuf::from(std::env::var_os("SystemRoot").expect("SystemRoot"))
            .join("System32")
            .join("whoami.exe");
        #[cfg(unix)]
        let other = PathBuf::from("/bin/echo");
        if other.is_file() {
            assert_eq!(
                probe_version(&other, VERSION_TIMEOUT).await,
                Err(Rejection::BadOutput)
            );
        }
    }

    /// Real discovery + validation on this machine:
    /// `cargo test smoke_locate_real_machine -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore = "inspects the real machine"]
    async fn smoke_locate_real_machine() {
        let started = std::time::Instant::now();
        let finder = ClaudeFinder::new(None, Discovery::real());
        let chosen = finder.find(true).await.expect("find");
        let first = started.elapsed();
        println!("chosen (first valid): {chosen:?} in {first:?}");
        let started = std::time::Instant::now();
        let report = finder.report().await.expect("report");
        let all = started.elapsed();
        println!("report (all validated) in {all:?}");
        println!("chosen: {:?}", report.chosen);
        for c in &report.checked {
            println!(
                "  {:<8} {:<9} {:<15} {}",
                format!("{:?}", c.source).to_lowercase(),
                format!("{:?}", c.result).to_lowercase(),
                c.reason.as_deref().unwrap_or(""),
                c.path
            );
        }
        println!("{} entries", report.checked.len());
    }
}
