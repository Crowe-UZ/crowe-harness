//! Locating the `claude` executable.
//!
//! Order (first hit wins, docs/NATIVE_API.md):
//! 1. `PATH`
//! 2. the native-installer launcher `~/.local/bin/claude[.exe]`
//! 3. package-manager locations GUI apps may not see on `PATH`
//!    (Homebrew, `/usr/local/bin`, `/usr/bin`, WinGet links)
//! 4. the binary bundled with the Claude desktop app
//!    (`%APPDATA%\Claude\claude-code\<highest semver>\claude.exe`).
//!
//! `.cmd`/`.bat` shims are never executed (they would need `cmd.exe`); for an
//! npm shim the native binary shipped inside the package is used when present.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde::Serialize;

#[cfg(windows)]
pub const EXE_NAME: &str = "claude.exe";
#[cfg(not(windows))]
pub const EXE_NAME: &str = "claude";

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum InstallSource {
    Path,
    Local,
    Package,
    Desktop,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Located {
    /// Canonical absolute path of the executable.
    pub exe: PathBuf,
    pub source: InstallSource,
    /// Version taken from the install directory name (desktop bundle).
    pub dir_version: Option<String>,
}

/// Inputs of [`locate_with`] (the real environment in [`locate`], fakes in tests).
#[derive(Debug, Clone, Default)]
pub struct LocateEnv {
    pub path_var: Option<OsString>,
    pub appdata: Option<PathBuf>,
    pub home: Option<PathBuf>,
    /// Package-manager bin directories, in priority order.
    pub package_dirs: Vec<PathBuf>,
}

impl LocateEnv {
    pub fn from_env() -> Self {
        LocateEnv {
            path_var: std::env::var_os("PATH"),
            appdata: env_path("APPDATA"),
            home: home_dir(),
            package_dirs: package_dirs(env_path("LOCALAPPDATA")),
        }
    }
}

fn env_path(key: &str) -> Option<PathBuf> {
    std::env::var_os(key)
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
}

/// Package-manager locations for this OS.
pub fn package_dirs(localappdata: Option<PathBuf>) -> Vec<PathBuf> {
    if cfg!(windows) {
        localappdata
            .map(|l| vec![l.join("Microsoft").join("WinGet").join("Links")])
            .unwrap_or_default()
    } else {
        [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/home/linuxbrew/.linuxbrew/bin",
            "/usr/bin",
        ]
        .into_iter()
        .map(PathBuf::from)
        .collect()
    }
}

/// Locates `claude` using the real environment.
pub fn locate() -> Option<Located> {
    locate_with(&LocateEnv::from_env())
}

pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

/// Directory the native installer puts its launcher in (`~/.local/bin`).
pub fn native_bin_dir(home: &Path) -> PathBuf {
    home.join(".local").join("bin")
}

/// The native installer's launcher (`~/.local/bin/claude[.exe]`), if present.
pub fn native_launcher(home: &Path) -> Option<PathBuf> {
    canonical_file(&native_bin_dir(home).join(EXE_NAME))
}

pub fn locate_with(env: &LocateEnv) -> Option<Located> {
    let found = |exe: PathBuf, source: InstallSource| Located {
        exe,
        source,
        dir_version: None,
    };
    if let Some(exe) = env.path_var.as_deref().and_then(find_on_path) {
        return Some(found(exe, InstallSource::Path));
    }
    if let Some(exe) = env.home.as_deref().and_then(native_launcher) {
        return Some(found(exe, InstallSource::Local));
    }
    if let Some(exe) = env
        .package_dirs
        .iter()
        .filter(|d| d.is_absolute())
        .find_map(|d| canonical_file(&d.join(EXE_NAME)))
    {
        return Some(found(exe, InstallSource::Package));
    }
    let (exe, version) = env
        .appdata
        .as_ref()
        .map(|a| a.join("Claude").join("claude-code"))
        .and_then(|base| pick_desktop(&base))?;
    Some(Located {
        exe,
        source: InstallSource::Desktop,
        dir_version: Some(version),
    })
}

fn canonical_file(p: &Path) -> Option<PathBuf> {
    if p.is_file() {
        std::fs::canonicalize(p).ok()
    } else {
        None
    }
}

fn find_on_path(path_var: &std::ffi::OsStr) -> Option<PathBuf> {
    for dir in std::env::split_paths(path_var) {
        if !dir.is_absolute() {
            continue; // never resolve relative PATH entries (cwd hijacking)
        }
        if let Some(exe) = canonical_file(&dir.join(EXE_NAME)) {
            return Some(exe);
        }
        if cfg!(windows) && dir.join("claude.cmd").is_file() {
            // npm global install: use the package's native binary, not the shim.
            let native = dir
                .join("node_modules")
                .join("@anthropic-ai")
                .join("claude-code")
                .join("bin")
                .join(EXE_NAME);
            if let Some(exe) = canonical_file(&native) {
                return Some(exe);
            }
        }
    }
    None
}

/// Highest-semver `<base>/<version>/claude(.exe)`.
pub fn pick_desktop(base: &Path) -> Option<(PathBuf, String)> {
    let entries = std::fs::read_dir(base).ok()?;
    entries
        .filter_map(Result::ok)
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let version = semver::Version::parse(&name).ok()?;
            let exe = canonical_file(&e.path().join(EXE_NAME))?;
            Some((version, exe, name))
        })
        .max_by(|a, b| a.0.cmp(&b.0))
        .map(|(_, exe, name)| (exe, name))
}

/// Parses `claude --version` output (`"2.1.284 (Claude Code)"`).
pub fn parse_version(stdout: &str) -> Option<String> {
    let token = stdout.split_whitespace().next()?;
    let ok = token.chars().next()?.is_ascii_digit()
        && token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+'));
    ok.then(|| token.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(p: &Path) {
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).expect("mkdir");
        }
        std::fs::write(p, b"bin").expect("write");
    }

    #[test]
    fn picks_highest_semver_with_binary() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let base = tmp.path();
        touch(&base.join("2.1.281").join(EXE_NAME));
        touch(&base.join("2.1.284").join(EXE_NAME));
        touch(&base.join("2.1.9").join(EXE_NAME));
        touch(&base.join("10.0.0-beta").join("readme.txt")); // no binary
        std::fs::create_dir_all(base.join("not-a-version")).expect("mkdir");
        let (exe, version) = pick_desktop(base).expect("found");
        assert_eq!(version, "2.1.284");
        assert!(exe.ends_with(Path::new("2.1.284").join(EXE_NAME)));
        assert!(pick_desktop(&base.join("missing")).is_none());
    }

    #[test]
    fn locate_order() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let appdata = tmp.path().join("appdata");
        let home = tmp.path().join("home");
        let pkg = tmp.path().join("pkg");
        let bindir = tmp.path().join("bin");
        let mut env = LocateEnv {
            path_var: Some(OsString::from("")),
            appdata: Some(appdata.clone()),
            home: Some(home.clone()),
            package_dirs: vec![tmp.path().join("missing"), pkg.clone()],
        };
        assert!(locate_with(&env).is_none());

        // 4. desktop bundle (lowest priority)
        touch(&appdata.join("Claude/claude-code/2.1.284").join(EXE_NAME));
        let found = locate_with(&env).expect("desktop");
        assert_eq!(found.source, InstallSource::Desktop);
        assert_eq!(found.dir_version.as_deref(), Some("2.1.284"));

        // 3. package manager beats desktop
        touch(&pkg.join(EXE_NAME));
        let found = locate_with(&env).expect("package");
        assert_eq!(found.source, InstallSource::Package);
        assert_eq!(found.dir_version, None);

        // 2. native launcher beats package managers
        touch(&home.join(".local/bin").join(EXE_NAME));
        let found = locate_with(&env).expect("local");
        assert_eq!(found.source, InstallSource::Local);
        assert_eq!(native_launcher(&home), Some(found.exe));

        // 1. PATH beats everything
        touch(&bindir.join(EXE_NAME));
        env.path_var = Some(std::env::join_paths([bindir]).expect("join"));
        let found = locate_with(&env).expect("path");
        assert_eq!(found.source, InstallSource::Path);

        assert!(locate_with(&LocateEnv::default()).is_none());
    }

    #[test]
    fn relative_entries_are_ignored() {
        let tmp = tempfile::tempdir().expect("tempdir");
        touch(&tmp.path().join("rel").join(EXE_NAME));
        let env = LocateEnv {
            path_var: Some(OsString::from("rel")),
            package_dirs: vec![PathBuf::from("rel")],
            ..LocateEnv::default()
        };
        assert!(locate_with(&env).is_none());
    }

    #[cfg(windows)]
    #[test]
    fn cmd_shims_are_never_used() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let npm = tmp.path().join("npm");
        touch(&npm.join("claude.cmd"));
        let env = LocateEnv {
            path_var: Some(std::env::join_paths([&npm]).expect("join")),
            ..LocateEnv::default()
        };
        assert!(locate_with(&env).is_none());
        let native = npm.join("node_modules/@anthropic-ai/claude-code/bin/claude.exe");
        touch(&native);
        let found = locate_with(&env).expect("npm native binary");
        assert!(found.exe.ends_with("claude.exe"));
        assert_eq!(found.source, InstallSource::Path);
    }

    #[test]
    fn package_dirs_per_os() {
        let dirs = package_dirs(Some(PathBuf::from("/lad")));
        if cfg!(windows) {
            assert_eq!(dirs, vec![PathBuf::from("/lad/Microsoft/WinGet/Links")]);
            assert!(package_dirs(None).is_empty());
        } else {
            assert_eq!(dirs.first(), Some(&PathBuf::from("/opt/homebrew/bin")));
            assert!(dirs.contains(&PathBuf::from("/usr/bin")));
        }
    }

    #[test]
    fn source_serializes_lowercase() {
        for (s, want) in [
            (InstallSource::Path, "\"path\""),
            (InstallSource::Local, "\"local\""),
            (InstallSource::Package, "\"package\""),
            (InstallSource::Desktop, "\"desktop\""),
        ] {
            assert_eq!(serde_json::to_string(&s).expect("json"), want);
        }
    }

    #[test]
    fn version_parsing() {
        assert_eq!(
            parse_version("2.1.284 (Claude Code)\n").as_deref(),
            Some("2.1.284")
        );
        assert_eq!(parse_version("error: boom"), None);
        assert_eq!(parse_version(""), None);
    }
}
