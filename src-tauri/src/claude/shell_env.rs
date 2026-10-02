//! The user's login-shell `PATH` on macOS/Linux.
//!
//! GUI apps started from the Dock / a desktop launcher do not inherit the
//! `PATH` set up in `~/.zshrc`, `~/.bashrc`, `~/.profile`, … so Claude Code
//! installed through npm, nvm, Homebrew or similar is invisible to them, and
//! npm's `#!/usr/bin/env node` launchers cannot find `node`. Like VS Code's
//! `resolveShellEnv`, the user's `$SHELL` is run once as an interactive login
//! shell that prints `PATH` between unique markers (stdin null, 5 s timeout,
//! output outside the markers ignored). The result is cached for the app
//! lifetime and merged into the `PATH` of every `claude` child process.
//!
//! The parsing / argument helpers are platform-independent so they are
//! tested on every host.

use std::collections::HashSet;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const SHELL_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellKind {
    /// zsh, bash, sh and other POSIX-like shells (`-ilc`).
    Posix,
    /// fish (`-lc`, `PATH` is a list).
    Fish,
}

/// Shells run without being listed in `/etc/shells`.
const KNOWN_SHELLS: [&str; 4] = ["zsh", "bash", "fish", "sh"];

/// Whether `shell` may be run, and how: it must be absolute and either a
/// known shell (zsh, bash, fish, sh) or listed in `/etc/shells`.
pub fn shell_kind(shell: &Path, etc_shells: Option<&str>) -> Option<ShellKind> {
    // `has_root` (not `is_absolute`) so Unix paths are judged the same on every host.
    if !shell.has_root() {
        return None;
    }
    let name = shell.file_name()?.to_str()?;
    let listed = etc_shells.is_some_and(|text| {
        text.lines()
            .map(str::trim)
            .any(|line| !line.starts_with('#') && !line.is_empty() && Path::new(line) == shell)
    });
    if !(KNOWN_SHELLS.contains(&name) || listed) {
        return None;
    }
    Some(if name == "fish" {
        ShellKind::Fish
    } else {
        ShellKind::Posix
    })
}

/// Arguments printing `PATH` between two copies of `marker`.
pub fn shell_args(kind: ShellKind, marker: &str) -> [String; 2] {
    match kind {
        ShellKind::Posix => [
            "-ilc".to_owned(),
            format!("printf '%s' '{marker}'; printf '%s' \"$PATH\"; printf '%s' '{marker}'"),
        ],
        ShellKind::Fish => [
            "-lc".to_owned(),
            format!("printf '%s' '{marker}'; string join : $PATH; printf '%s' '{marker}'"),
        ],
    }
}

/// The text between the first two `marker`s, trimmed (fish's `string join`
/// adds a newline). Banners, motd and prompts around the markers are ignored.
pub fn parse_marked(output: &str, marker: &str) -> Option<String> {
    let start = output.find(marker)? + marker.len();
    let len = output[start..].find(marker)?;
    let value = output[start..start + len].trim();
    (!value.is_empty() && !value.contains('\0')).then(|| value.to_owned())
}

/// `lists` (in order) plus `extra`, absolute entries only, first occurrence kept.
pub fn merge_paths(lists: &[Option<&OsStr>], extra: Option<&Path>) -> Option<OsString> {
    let mut seen = HashSet::new();
    let mut dirs: Vec<PathBuf> = Vec::new();
    let all = lists
        .iter()
        .flatten()
        .flat_map(std::env::split_paths)
        .chain(extra.map(Path::to_path_buf));
    for dir in all {
        if dir.is_absolute() && seen.insert(dir.clone()) {
            dirs.push(dir);
        }
    }
    if dirs.is_empty() {
        return None;
    }
    std::env::join_paths(dirs).ok()
}

#[cfg(unix)]
mod imp {
    use std::ffi::OsString;
    use std::io::Read;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};
    use std::sync::{mpsc, OnceLock};
    use std::time::Duration;

    use super::{parse_marked, shell_args, shell_kind, SHELL_TIMEOUT};

    const MAX_OUTPUT: u64 = 1 << 20;

    static LOGIN_PATH: OnceLock<Option<OsString>> = OnceLock::new();

    /// Login-shell `PATH`, resolved on first use (blocking, ≤ 5 s) and cached.
    pub fn login_shell_path() -> Option<OsString> {
        LOGIN_PATH.get_or_init(resolve).clone()
    }

    /// The cached value without resolving (never blocks).
    pub fn cached_login_shell_path() -> Option<OsString> {
        LOGIN_PATH.get().cloned().flatten()
    }

    fn user_shell(etc_shells: Option<&str>) -> Option<PathBuf> {
        let from_env = std::env::var_os("SHELL")
            .filter(|s| !s.is_empty())
            .map(PathBuf::from)
            .filter(|s| shell_kind(s, etc_shells).is_some() && s.is_file());
        from_env.or_else(|| {
            let fallbacks: &[&str] = if cfg!(target_os = "macos") {
                &["/bin/zsh", "/bin/bash", "/bin/sh"]
            } else {
                &["/bin/bash", "/bin/sh"]
            };
            fallbacks.iter().map(PathBuf::from).find(|p| p.is_file())
        })
    }

    fn resolve() -> Option<OsString> {
        let etc = std::fs::read_to_string("/etc/shells").ok();
        let shell = user_shell(etc.as_deref())?;
        let kind = shell_kind(&shell, etc.as_deref())?;
        let marker = format!("__CROWE_PATH_{}__", uuid::Uuid::new_v4().simple());
        let output = run(&shell, &shell_args(kind, &marker), SHELL_TIMEOUT)?;
        parse_marked(&output, &marker).map(OsString::from)
    }

    fn run(shell: &Path, args: &[String], timeout: Duration) -> Option<String> {
        use std::os::unix::process::CommandExt;
        let mut child = Command::new(shell)
            .args(args)
            .current_dir(std::env::temp_dir())
            .env("CROWE_HARNESS_RESOLVING_ENVIRONMENT", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .process_group(0) // never take over a terminal
            .spawn()
            .ok()?;
        let stdout = child.stdout.take()?;
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = stdout.take(MAX_OUTPUT).read_to_end(&mut buf);
            let _ = tx.send(buf);
        });
        let output = rx.recv_timeout(timeout).ok();
        // Done or timed out: make sure the shell is gone, then reap it.
        let _ = child.kill();
        let _ = child.wait();
        String::from_utf8(output?).ok()
    }
}

#[cfg(unix)]
pub use imp::{cached_login_shell_path, login_shell_path};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marker_parsing_ignores_noise() {
        let m = "__CROWE_PATH_abc__";
        let out = format!(
            "Last login: Mon\nWelcome!\n{m}/usr/local/bin:/usr/bin:/home/me/.nvm/versions/node/v20.0.0/bin{m}\nlogout\n"
        );
        assert_eq!(
            parse_marked(&out, m).as_deref(),
            Some("/usr/local/bin:/usr/bin:/home/me/.nvm/versions/node/v20.0.0/bin")
        );
        // fish: `string join` ends with a newline.
        let fish = format!("{m}/opt/homebrew/bin:/usr/bin\n{m}");
        assert_eq!(
            parse_marked(&fish, m).as_deref(),
            Some("/opt/homebrew/bin:/usr/bin")
        );
        assert_eq!(parse_marked("no markers", m), None);
        assert_eq!(parse_marked(&format!("{m}/usr/bin"), m), None); // timed out mid-way
        assert_eq!(parse_marked(&format!("{m}  \n{m}"), m), None);
        assert_eq!(parse_marked(&format!("{m}a\0b{m}"), m), None);
    }

    #[test]
    fn shell_validation() {
        let etc = "# /etc/shells\n/bin/sh\n/bin/bash\n/usr/local/bin/nu\n";
        assert_eq!(
            shell_kind(Path::new("/bin/zsh"), None),
            Some(ShellKind::Posix)
        );
        assert_eq!(
            shell_kind(Path::new("/opt/homebrew/bin/fish"), None),
            Some(ShellKind::Fish)
        );
        assert_eq!(
            shell_kind(Path::new("/usr/local/bin/nu"), Some(etc)),
            Some(ShellKind::Posix)
        );
        assert_eq!(shell_kind(Path::new("/usr/local/bin/nu"), None), None);
        assert_eq!(shell_kind(Path::new("/tmp/evil"), Some(etc)), None);
        assert_eq!(shell_kind(Path::new("zsh"), None), None); // relative
        assert_eq!(shell_kind(Path::new("bin/bash"), Some(etc)), None);
    }

    #[test]
    fn shell_arguments() {
        let [flag, script] = shell_args(ShellKind::Posix, "M");
        assert_eq!(flag, "-ilc");
        assert_eq!(
            script,
            "printf '%s' 'M'; printf '%s' \"$PATH\"; printf '%s' 'M'"
        );
        let [flag, script] = shell_args(ShellKind::Fish, "M");
        assert_eq!(flag, "-lc");
        assert!(script.contains("string join : $PATH"));
    }

    #[test]
    fn merging_dedups_and_drops_relative_entries() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let a = tmp.path().join("a");
        let b = tmp.path().join("b");
        let c = tmp.path().join("c");
        let first = std::env::join_paths([&a, &PathBuf::from("rel"), &b]).expect("join");
        let second = std::env::join_paths([&b, &c]).expect("join");
        let merged = merge_paths(
            &[Some(first.as_os_str()), None, Some(second.as_os_str())],
            Some(&a),
        )
        .expect("merged");
        let dirs: Vec<PathBuf> = std::env::split_paths(&merged).collect();
        assert_eq!(dirs, vec![a.clone(), b, c]);
        assert_eq!(merge_paths(&[None], None), None);
        let only_extra = merge_paths(&[], Some(&a)).expect("extra");
        assert_eq!(
            std::env::split_paths(&only_extra).collect::<Vec<_>>(),
            vec![a]
        );
    }
}
