//! In-app Claude Code installer (docs/NATIVE_API.md, "Installing Claude
//! Code"). Replicates the official `install.sh` / `install.ps1` in Rust,
//! without piping a remote script into a shell:
//!
//! 1. platform detection ([`platform`]);
//! 2. channel → version, signed manifest verified with the embedded,
//!    fingerprint-pinned release key ([`release`], [`verify`]);
//! 3. streamed download with SHA-256 + exact size ([`download`]);
//! 4. OS publisher signature check ([`verify::verify_publisher`]);
//! 5. `<binary> install <channel>`, then `~/.local/bin/claude --version` ([`run`]).
//!
//! Network traffic goes to `https://downloads.claude.ai` only. No telemetry.

pub mod download;
pub mod platform;
pub mod release;
pub mod run;
#[cfg(windows)]
pub mod sys_windows;
pub mod verify;

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tokio::sync::watch;

use crate::claude::auth::ClaudeInstall;
use crate::claude::locate::InstallSource;
use crate::error::{NativeError, NativeResult};

/// Installer error codes (`NativeError.code` / `InstallEvent::Error.code`).
pub mod codes {
    pub const UNSUPPORTED_PLATFORM: &str = "unsupported_platform";
    pub const NETWORK: &str = "network";
    pub const UNEXPECTED_RESPONSE: &str = "unexpected_response";
    pub const SIGNATURE_INVALID: &str = "signature_invalid";
    pub const CHECKSUM_MISMATCH: &str = "checksum_mismatch";
    pub const PUBLISHER_UNTRUSTED: &str = "publisher_untrusted";
    pub const INSTALL_FAILED: &str = "install_failed";
    pub const DISK_FULL: &str = "disk_full";
    pub const BUSY: &str = "busy";
    /// Internal marker only: surfaces as the `cancelled` event, never as an error.
    pub const CANCELLED: &str = "cancelled";
}

pub(crate) fn ierr(code: &str, message: impl Into<String>) -> NativeError {
    NativeError::new(code, message)
}

fn cancelled() -> NativeError {
    ierr(codes::CANCELLED, "cancelled")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InstallChannel {
    Stable,
    Latest,
}

impl InstallChannel {
    pub fn as_str(self) -> &'static str {
        match self {
            InstallChannel::Stable => "stable",
            InstallChannel::Latest => "latest",
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstallPlan {
    pub version: String,
    pub channel: InstallChannel,
    pub platform: String,
    pub size_bytes: u64,
    pub source_host: &'static str,
    pub install_dir: String,
    pub auto_updates: bool,
    pub already_installed: Option<ClaudeInstall>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InstallPhase {
    Resolving,
    VerifyingManifest,
    Downloading,
    VerifyingBinary,
    Installing,
    Checking,
}

/// Events of one install. Exactly one of `done` | `error` | `cancelled` is
/// the last event.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum InstallEvent {
    Phase {
        phase: InstallPhase,
    },
    Progress {
        received_bytes: u64,
        total_bytes: u64,
    },
    Done {
        install: ClaudeInstall,
    },
    Error {
        code: String,
        message: String,
    },
    Cancelled,
}

impl InstallEvent {
    /// Terminal event for the outcome of an install.
    pub fn terminal(result: NativeResult<ClaudeInstall>) -> Self {
        match result {
            Ok(install) => InstallEvent::Done { install },
            Err(e) if e.code == codes::CANCELLED => InstallEvent::Cancelled,
            Err(e) => InstallEvent::Error {
                code: e.code,
                message: e.message,
            },
        }
    }
}

// ---------------------------------------------------------------- cancellation

/// Cancellation signal shared by every await point of an install.
#[derive(Debug, Clone)]
pub struct Cancel {
    rx: watch::Receiver<bool>,
    /// Keeps the channel open for [`Cancel::never`].
    _keep: Option<std::sync::Arc<watch::Sender<bool>>>,
}

impl Cancel {
    fn new(rx: watch::Receiver<bool>) -> Self {
        Cancel { rx, _keep: None }
    }

    /// A signal that never fires (plan requests, tests).
    pub fn never() -> Self {
        let (tx, rx) = watch::channel(false);
        Cancel {
            rx,
            _keep: Some(std::sync::Arc::new(tx)),
        }
    }

    pub fn is_cancelled(&self) -> bool {
        *self.rx.borrow() || self.rx.has_changed().is_err()
    }

    /// Resolves when cancelled (or when the sender is gone: app exit).
    pub async fn cancelled(&self) {
        let mut rx = self.rx.clone();
        let _ = rx.wait_for(|v| *v).await;
    }

    /// Runs `fut` unless cancelled first.
    pub async fn run<F: std::future::Future>(&self, fut: F) -> NativeResult<F::Output> {
        if self.is_cancelled() {
            return Err(cancelled());
        }
        tokio::select! {
            biased;
            () = self.cancelled() => Err(cancelled()),
            out = fut => Ok(out),
        }
    }

    pub async fn sleep(&self, d: std::time::Duration) -> NativeResult<()> {
        self.run(tokio::time::sleep(d)).await
    }

    pub fn check(&self) -> NativeResult<()> {
        if self.is_cancelled() {
            Err(cancelled())
        } else {
            Ok(())
        }
    }
}

// ---------------------------------------------------------------- registry

/// At most one install runs at a time.
#[derive(Default)]
pub struct InstallRegistry {
    current: Mutex<Option<(String, watch::Sender<bool>)>>,
}

impl InstallRegistry {
    /// Reserves the single install slot (`busy` when taken).
    pub fn begin(&self) -> NativeResult<(String, Cancel)> {
        let mut cur = self
            .current
            .lock()
            .map_err(|_| NativeError::internal("installer state unavailable"))?;
        if cur.is_some() {
            return Err(ierr(codes::BUSY, "Claude Code is already being installed"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = watch::channel(false);
        *cur = Some((id.clone(), tx));
        Ok((id, Cancel::new(rx)))
    }

    /// Releases the slot held by `id`.
    pub fn finish(&self, id: &str) {
        if let Ok(mut cur) = self.current.lock() {
            if cur.as_ref().is_some_and(|(cid, _)| cid == id) {
                *cur = None;
            }
        }
    }

    /// Signals cancellation; the install task emits `cancelled` and releases
    /// the slot. Returns `false` for an unknown/finished id.
    pub fn cancel(&self, id: &str) -> bool {
        let Ok(cur) = self.current.lock() else {
            return false;
        };
        match cur.as_ref() {
            Some((cid, tx)) if cid == id => {
                let _ = tx.send(true);
                true
            }
            _ => false,
        }
    }

    /// Cancels whatever runs (app exit).
    pub fn cancel_all(&self) {
        if let Ok(cur) = self.current.lock() {
            if let Some((_, tx)) = cur.as_ref() {
                let _ = tx.send(true);
            }
        }
    }

    pub fn is_busy(&self) -> bool {
        self.current.lock().map_or(true, |c| c.is_some())
    }
}

// ---------------------------------------------------------------- orchestration

/// Directories an install works with (resolved by the command layer).
#[derive(Debug, Clone)]
pub struct InstallDirs {
    /// Private download directory (`<app cache>/installer`).
    pub cache_dir: PathBuf,
    /// The user's home directory (the launcher lands in `~/.local/bin`).
    pub home: PathBuf,
}

fn unsupported() -> NativeError {
    ierr(
        codes::UNSUPPORTED_PLATFORM,
        "Claude Code has no native build for this operating system or processor",
    )
}

/// Detects the platform (blocking probes run off the async runtime).
pub async fn detect_platform() -> NativeResult<&'static str> {
    crate::error::join_blocking(|| Ok(platform::detect()))
        .await?
        .ok_or_else(unsupported)
}

/// Resolves and verifies a release without downloading the binary.
pub async fn plan_release(
    channel: InstallChannel,
    cancel: &Cancel,
) -> NativeResult<release::Release> {
    let platform = detect_platform().await?;
    let client = release::client()?;
    release::resolve(&client, channel, platform, cancel, || {}).await
}

/// Full install. `emit` receives the non-terminal events; the result decides
/// the terminal event ([`InstallEvent::terminal`]).
pub async fn install(
    channel: InstallChannel,
    dirs: &InstallDirs,
    cancel: &Cancel,
    emit: &(dyn Fn(InstallEvent) + Send + Sync),
) -> NativeResult<ClaudeInstall> {
    let phase = |p: InstallPhase| emit(InstallEvent::Phase { phase: p });

    phase(InstallPhase::Resolving);
    let platform = detect_platform().await?;
    let client = release::client()?;
    let rel = release::resolve(&client, channel, platform, cancel, || {
        phase(InstallPhase::VerifyingManifest)
    })
    .await?;
    cancel.check()?;

    phase(InstallPhase::Downloading);
    let cache_dir = dirs.cache_dir.clone();
    let home = dirs.home.clone();
    let size = rel.entry.size;
    crate::error::join_blocking(move || {
        download::ensure_private_dir(&cache_dir)?;
        download::sweep_stale(&cache_dir);
        download::check_free_space(&[&cache_dir, &home], size)
    })
    .await?;
    let (temp, digest) = download::download(&client, &rel, &dirs.cache_dir, cancel, |r, t| {
        emit(InstallEvent::Progress {
            received_bytes: r,
            total_bytes: t,
        })
    })
    .await?;

    phase(InstallPhase::VerifyingBinary);
    verify::ensure_checksum(&digest, &rel.entry.checksum)?;
    let exe = temp.path().to_path_buf();
    crate::error::join_blocking(move || {
        verify::verify_publisher(&exe)?;
        make_executable(&exe)
    })
    .await?;
    cancel.check()?;

    phase(InstallPhase::Installing);
    let installed = run::run_install(temp.path(), channel, &dirs.home, cancel).await;
    // The temp binary is no longer needed whatever the outcome.
    temp.remove().await;
    installed?;

    phase(InstallPhase::Checking);
    let (launcher, version) = run::check_installed(&dirs.home).await?;
    Ok(ClaudeInstall {
        path: crate::util::display_path(&launcher),
        version: Some(version),
        source: InstallSource::Local,
    })
}

/// `chmod 0700` after verification (Unix); no-op elsewhere.
fn make_executable(path: &std::path::Path) -> NativeResult<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| download::io_error("downloaded file", &e))?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_is_a_closed_enum() {
        let c: InstallChannel = serde_json::from_str("\"stable\"").expect("stable");
        assert_eq!(c.as_str(), "stable");
        let c: InstallChannel = serde_json::from_str("\"latest\"").expect("latest");
        assert_eq!(c, InstallChannel::Latest);
        for bad in ["\"Stable\"", "\"2.1.285\"", "\"\"", "\"stable; rm -rf\""] {
            assert!(
                serde_json::from_str::<InstallChannel>(bad).is_err(),
                "{bad}"
            );
        }
    }

    #[test]
    fn events_serialize_per_contract() {
        let j = |e: &InstallEvent| serde_json::to_value(e).expect("json");
        assert_eq!(
            j(&InstallEvent::Phase {
                phase: InstallPhase::VerifyingManifest
            }),
            serde_json::json!({"type": "phase", "phase": "verifying_manifest"})
        );
        assert_eq!(
            j(&InstallEvent::Progress {
                received_bytes: 5,
                total_bytes: 10
            }),
            serde_json::json!({"type": "progress", "receivedBytes": 5, "totalBytes": 10})
        );
        assert_eq!(
            j(&InstallEvent::Cancelled),
            serde_json::json!({"type": "cancelled"})
        );
        let done = InstallEvent::terminal(Ok(ClaudeInstall {
            path: "/x/claude".into(),
            version: Some("2.1.285".into()),
            source: InstallSource::Local,
        }));
        assert_eq!(
            j(&done),
            serde_json::json!({"type": "done", "install": {"path": "/x/claude", "version": "2.1.285", "source": "local"}})
        );
        let err = InstallEvent::terminal(Err(ierr(codes::CHECKSUM_MISMATCH, "bad")));
        assert_eq!(
            j(&err),
            serde_json::json!({"type": "error", "code": "checksum_mismatch", "message": "bad"})
        );
        assert_eq!(
            InstallEvent::terminal(Err(cancelled())),
            InstallEvent::Cancelled
        );
    }

    #[test]
    fn plan_serializes_per_contract() {
        let plan = InstallPlan {
            version: "2.1.285".into(),
            channel: InstallChannel::Stable,
            platform: "win32-x64".into(),
            size_bytes: 1,
            source_host: release::HOST,
            install_dir: "C:\\Users\\me\\.local\\bin".into(),
            auto_updates: true,
            already_installed: None,
        };
        let v = serde_json::to_value(&plan).expect("json");
        for key in [
            "version",
            "channel",
            "platform",
            "sizeBytes",
            "sourceHost",
            "installDir",
            "autoUpdates",
            "alreadyInstalled",
        ] {
            assert!(v.get(key).is_some(), "{key}");
        }
        assert_eq!(v["sourceHost"], "downloads.claude.ai");
        assert_eq!(v["channel"], "stable");
    }

    #[test]
    fn registry_allows_one_install() {
        let reg = InstallRegistry::default();
        let (id, cancel) = reg.begin().expect("first");
        assert!(reg.is_busy());
        assert_eq!(reg.begin().expect_err("second").code, codes::BUSY);
        assert!(!reg.cancel("other-id"));
        assert!(!cancel.is_cancelled());
        assert!(reg.cancel(&id));
        assert!(cancel.is_cancelled());
        reg.finish("other-id"); // not the owner: slot kept
        assert!(reg.is_busy());
        reg.finish(&id);
        assert!(!reg.is_busy());
        assert!(!reg.cancel(&id)); // finished: no-op
        let (_id2, c2) = reg.begin().expect("free again");
        reg.cancel_all();
        assert!(c2.is_cancelled());
    }

    #[tokio::test]
    async fn cancel_interrupts_waits() {
        let reg = InstallRegistry::default();
        let (id, cancel) = reg.begin().expect("begin");
        let c = cancel.clone();
        let waiter = tokio::spawn(async move { c.sleep(std::time::Duration::from_secs(60)).await });
        tokio::task::yield_now().await;
        reg.cancel(&id);
        let res = tokio::time::timeout(std::time::Duration::from_secs(5), waiter)
            .await
            .expect("woken")
            .expect("join");
        assert_eq!(res.expect_err("cancelled").code, codes::CANCELLED);
        assert!(cancel.check().is_err());
        assert!(Cancel::never().check().is_ok());
    }

    #[test]
    fn dropped_sender_counts_as_cancelled() {
        let (tx, rx) = watch::channel(false);
        let c = Cancel::new(rx);
        assert!(!c.is_cancelled());
        drop(tx);
        assert!(c.is_cancelled());
    }
}
