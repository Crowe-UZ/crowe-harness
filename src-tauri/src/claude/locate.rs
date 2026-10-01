//! Locating the `claude` executable.
//!
//! Order (first hit wins): `PATH` → Claude desktop app bundle
//! (`%APPDATA%\Claude\claude-code\<highest semver>\claude.exe`) →
//! `%USERPROFILE%\.local\bin\claude.exe`. `.cmd`/`.bat` shims are never
//! executed (they would need `cmd.exe`); for an npm shim the native binary
//! shipped inside the package is used when present.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde::Serialize;

#[cfg(windows)]
const EXE_NAME: &str = "claude.exe";
#[cfg(not(windows))]
const EXE_NAME: &str = "claude";

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum InstallSource {
    Path,
    Desktop,
    Local,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Located {
    /// Canonical absolute path of the executable.
    pub exe: PathBuf,
    pub source: InstallSource,
    /// Version taken from the install directory name (desktop bundle).
    pub dir_version: Option<String>,
}

/// Locates `claude` using the real environment.
pub fn locate() -> Option<Located> {
    locate_with(
        std::env::var_os("PATH"),
        std::env::var_os("APPDATA").map(PathBuf::from),
        home_dir(),
    )
}

pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

pub fn locate_with(
    path_var: Option<OsString>,
    appdata: Option<PathBuf>,
    home: Option<PathBuf>,
) -> Option<Located> {
    if let Some(exe) = path_var.as_deref().and_then(find_on_path) {
        return Some(Located {
            exe,
            source: InstallSource::Path,
            dir_version: None,
        });
    }
    if let Some((exe, version)) = appdata
        .map(|a| a.join("Claude").join("claude-code"))
        .and_then(|base| pick_desktop(&base))
    {
        return Some(Located {
            exe,
            source: InstallSource::Desktop,
            dir_version: Some(version),
        });
    }
    let local = home?.join(".local").join("bin").join(EXE_NAME);
    canonical_file(&local).map(|exe| Located {
        exe,
        source: InstallSource::Local,
        dir_version: None,
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
        let bindir = tmp.path().join("bin");
        touch(&appdata.join("Claude/claude-code/2.1.284").join(EXE_NAME));
        touch(&home.join(".local/bin").join(EXE_NAME));

        let empty_path = Some(OsString::from(""));
        let found = locate_with(
            empty_path.clone(),
            Some(appdata.clone()),
            Some(home.clone()),
        )
        .expect("desktop");
        assert_eq!(found.source, InstallSource::Desktop);
        assert_eq!(found.dir_version.as_deref(), Some("2.1.284"));

        let found = locate_with(empty_path.clone(), None, Some(home.clone())).expect("local");
        assert_eq!(found.source, InstallSource::Local);

        touch(&bindir.join(EXE_NAME));
        let path_var = std::env::join_paths([bindir]).expect("join");
        let found = locate_with(Some(path_var), Some(appdata), Some(home)).expect("path");
        assert_eq!(found.source, InstallSource::Path);

        assert!(locate_with(empty_path, None, None).is_none());
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
