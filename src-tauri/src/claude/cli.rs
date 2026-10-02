//! Spawning the `claude` CLI safely: absolute path, no shell, scrubbed
//! auth environment, no console window, bounded run time.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;

use crate::error::{NativeError, NativeResult};

#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
pub const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;

/// Removed from every child environment so a stray key can never switch the
/// account/billing away from the user's Claude subscription sign-in.
pub const SCRUBBED_ENV: [&str; 3] = [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
];

/// `PATH` for a `claude` child process. On macOS/Linux: this process's
/// `PATH`, then the login-shell `PATH` (when already resolved), then the
/// directory of `exe` — so npm / nvm `#!/usr/bin/env node` launchers find
/// `node` in a GUI app. `None` (inherit) on Windows.
pub fn child_path(exe: &Path) -> Option<std::ffi::OsString> {
    #[cfg(unix)]
    {
        use super::shell_env;
        let process = std::env::var_os("PATH");
        let login = shell_env::cached_login_shell_path();
        shell_env::merge_paths(&[process.as_deref(), login.as_deref()], exe.parent())
    }
    #[cfg(not(unix))]
    {
        let _ = exe;
        None
    }
}

/// A `tokio` command for `exe` with the common hardening applied.
pub fn command(exe: &Path) -> Command {
    let mut cmd = Command::new(exe);
    for key in SCRUBBED_ENV {
        cmd.env_remove(key);
    }
    if let Some(path) = child_path(exe) {
        cmd.env("PATH", path);
    }
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.stdin(Stdio::null()).kill_on_drop(true);
    cmd
}

#[derive(Debug)]
pub struct CliOutput {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

/// Runs `claude <args>` in a neutral working directory (the temp dir, so no
/// project `.mcp.json`/settings are picked up) and collects its output.
pub async fn run(exe: &Path, args: &[&str], timeout: Duration) -> NativeResult<CliOutput> {
    let mut cmd = command(exe);
    cmd.args(args)
        .current_dir(std::env::temp_dir())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let child = cmd.spawn().map_err(|e| {
        NativeError::new("spawn_failed", format!("could not start Claude Code: {e}"))
    })?;
    // On timeout the future (and the child) is dropped: kill_on_drop kills it.
    let output = tokio::time::timeout(timeout, child.wait_with_output())
        .await
        .map_err(|_| NativeError::new("timeout", "Claude Code did not respond in time"))?
        .map_err(|e| NativeError::io("Claude Code output", &e))?;
    Ok(CliOutput {
        code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

/// Last `max_chars` characters of `text`, for error messages.
pub fn tail(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    let count = trimmed.chars().count();
    if count <= max_chars {
        return trimmed.to_owned();
    }
    let tail: String = trimmed.chars().skip(count - max_chars).collect();
    format!("\u{2026}{tail}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tail_keeps_the_end() {
        assert_eq!(tail("  abc  ", 10), "abc");
        assert_eq!(tail("abcdef", 3), "\u{2026}def");
    }
}
