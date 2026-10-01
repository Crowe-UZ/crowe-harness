//! Path guards.
//!
//! * [`ConfigGuard`]: the only way this app touches the Claude Code config
//!   directory. It allows `projects/`, `agents/` and `skills/` only, so the
//!   credential store (`.credentials.json`), `sessions/` (contains key files)
//!   and `~/.claude.json` can never be opened, even through symlinks.
//! * [`resolve_in_root`]: resolves a webview-supplied relative path inside a
//!   project root (rejects `..`, absolute paths, drive/ADS syntax and symlinks
//!   or junctions that escape the root).

use std::fs::{File, ReadDir};
use std::path::{Component, Path, PathBuf};

use crate::error::{NativeError, NativeResult};

/// File names that must never be opened, wherever they are.
const FORBIDDEN_NAMES: &[&str] = &[".credentials.json", ".claude.json"];
/// Sub-directories of the config dir that may be read.
const ALLOWED_SUBDIRS: &[&str] = &["projects", "agents", "skills"];

#[derive(Debug, Clone)]
pub struct ConfigGuard {
    config_dir: PathBuf,
    projects_dir: PathBuf,
    allowed: Vec<PathBuf>,
}

impl ConfigGuard {
    /// `projects_dir` is the history directory reported by the CLI (normally
    /// `<config_dir>/projects`).
    pub fn new(config_dir: &Path, projects_dir: Option<&Path>) -> NativeResult<Self> {
        let config_dir = std::fs::canonicalize(config_dir)
            .map_err(|e| NativeError::io("Claude config directory", &e))?;
        let mut allowed: Vec<PathBuf> = ALLOWED_SUBDIRS
            .iter()
            .map(|d| canonical_or_joined(&config_dir, d))
            .collect();
        let mut history = canonical_or_joined(&config_dir, "projects");
        if let Some(c) = projects_dir.and_then(|p| std::fs::canonicalize(p).ok()) {
            // Only a directory named `projects`, and never the config dir
            // itself or one of its ancestors, may widen the guard.
            let named_projects = c
                .file_name()
                .is_some_and(|n| n.eq_ignore_ascii_case("projects"));
            if named_projects && !config_dir.starts_with(&c) && !has_forbidden_name(&c) {
                if !allowed.contains(&c) {
                    allowed.push(c.clone());
                }
                history = c;
            }
        }
        Ok(Self {
            config_dir,
            projects_dir: history,
            allowed,
        })
    }

    pub fn config_dir(&self) -> &Path {
        &self.config_dir
    }

    /// History directory (`projects/`), canonical when it exists.
    pub fn projects_dir(&self) -> PathBuf {
        self.projects_dir.clone()
    }

    pub fn agents_dir(&self) -> PathBuf {
        canonical_or_joined(&self.config_dir, "agents")
    }

    pub fn skills_dir(&self) -> PathBuf {
        canonical_or_joined(&self.config_dir, "skills")
    }

    /// Canonicalizes `path` and checks that it lies inside an allowed
    /// sub-directory and is not a forbidden file.
    pub fn check(&self, path: &Path) -> NativeResult<PathBuf> {
        let canonical =
            std::fs::canonicalize(path).map_err(|e| NativeError::io("history file", &e))?;
        if self.is_allowed_canonical(&canonical) {
            Ok(canonical)
        } else {
            Err(NativeError::forbidden("access to this file is not allowed"))
        }
    }

    /// Pure check on an already canonical path (unit-tested).
    pub fn is_allowed_canonical(&self, canonical: &Path) -> bool {
        if has_forbidden_name(canonical) {
            return false;
        }
        self.allowed.iter().any(|root| canonical.starts_with(root))
    }

    pub fn open(&self, path: &Path) -> NativeResult<File> {
        let canonical = self.check(path)?;
        File::open(canonical).map_err(|e| NativeError::io("history file", &e))
    }

    pub fn read_dir(&self, path: &Path) -> NativeResult<ReadDir> {
        let canonical = self.check(path)?;
        std::fs::read_dir(canonical).map_err(|e| NativeError::io("history directory", &e))
    }

    /// Reads a small text file (≤ `max` bytes) through the guard.
    pub fn read_small(&self, path: &Path, max: u64) -> NativeResult<String> {
        use std::io::Read;
        let mut buf = Vec::new();
        self.open(path)?
            .take(max)
            .read_to_end(&mut buf)
            .map_err(|e| NativeError::io("config file", &e))?;
        Ok(String::from_utf8_lossy(&buf).into_owned())
    }
}

fn canonical_or_joined(base: &Path, sub: &str) -> PathBuf {
    let joined = base.join(sub);
    std::fs::canonicalize(&joined).unwrap_or(joined)
}

fn has_forbidden_name(path: &Path) -> bool {
    path.components().any(|c| match c {
        Component::Normal(name) => {
            let name = name.to_string_lossy();
            FORBIDDEN_NAMES.iter().any(|f| name.eq_ignore_ascii_case(f))
        }
        _ => false,
    })
}

/// Validates a webview-supplied relative path (`/` or `\` separated) and
/// returns its normal components. `""` and `"."` mean the root.
pub fn validate_rel_path(rel: &str) -> NativeResult<Vec<String>> {
    if rel.len() > 4096 || rel.contains('\0') {
        return Err(NativeError::invalid("invalid path"));
    }
    if rel.starts_with('/') || rel.starts_with('\\') || rel.contains(':') {
        return Err(NativeError::invalid("path must be relative to the project"));
    }
    let mut out = Vec::new();
    for part in rel.split(['/', '\\']) {
        match part {
            "" | "." => continue,
            ".." => return Err(NativeError::invalid("path must stay inside the project")),
            p => out.push(p.to_owned()),
        }
    }
    Ok(out)
}

/// Joins `rel` to the canonical `root`, canonicalizes the result and checks
/// that it stays inside `root` (symlinks/junctions resolved).
pub fn resolve_in_root(root: &Path, rel: &str) -> NativeResult<PathBuf> {
    let parts = validate_rel_path(rel)?;
    let mut joined = root.to_path_buf();
    for p in &parts {
        joined.push(p);
    }
    let canonical = std::fs::canonicalize(&joined).map_err(|e| NativeError::io("path", &e))?;
    if canonical.starts_with(root) {
        Ok(canonical)
    } else {
        Err(NativeError::forbidden("path is outside the project"))
    }
}

/// Relative path of `canonical` inside `root` with `/` separators.
pub fn rel_from_root(root: &Path, canonical: &Path) -> Option<String> {
    let rel = canonical.strip_prefix(root).ok()?;
    let parts: Vec<String> = rel
        .components()
        .filter_map(|c| match c {
            Component::Normal(n) => Some(n.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect();
    Some(parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_guard_allows_only_history_agents_skills() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let cfg = tmp.path().join(".claude");
        for d in ["projects/p1", "agents", "skills/s1", "sessions"] {
            std::fs::create_dir_all(cfg.join(d)).expect("mkdir");
        }
        std::fs::write(cfg.join(".credentials.json"), "{}").expect("write");
        std::fs::write(cfg.join("sessions/x.key"), "k").expect("write");
        std::fs::write(cfg.join("settings.json"), "{}").expect("write");
        std::fs::write(cfg.join("projects/p1/a.jsonl"), "").expect("write");
        std::fs::write(cfg.join("projects/.credentials.json"), "{}").expect("write");
        std::fs::write(tmp.path().join(".claude.json"), "{}").expect("write");

        let guard = ConfigGuard::new(&cfg, None).expect("guard");
        assert!(guard.check(&cfg.join("projects/p1/a.jsonl")).is_ok());
        assert!(guard.check(&cfg.join("projects")).is_ok());
        assert!(guard.check(&cfg.join("skills/s1")).is_ok());
        assert!(guard.check(&cfg.join("agents")).is_ok());

        for bad in [
            cfg.join(".credentials.json"),
            cfg.join("sessions/x.key"),
            cfg.join("sessions"),
            cfg.join("settings.json"),
            cfg.clone(),
            cfg.join("projects/.credentials.json"),
            cfg.join("projects/p1/../../.credentials.json"),
            tmp.path().join(".claude.json"),
        ] {
            let err = guard.check(&bad).expect_err("must be rejected");
            assert_eq!(err.code, "forbidden", "{}", bad.display());
        }
        assert!(guard.open(&cfg.join(".credentials.json")).is_err());
        assert!(guard.read_dir(&cfg.join("sessions")).is_err());

        // A bogus projects dir (the config dir, or its parent) cannot widen the guard.
        for widen in [cfg.clone(), tmp.path().to_path_buf()] {
            let g = ConfigGuard::new(&cfg, Some(&widen)).expect("guard");
            assert!(g.check(&cfg.join(".credentials.json")).is_err());
            assert!(g.check(&cfg.join("settings.json")).is_err());
            assert!(g.projects_dir().ends_with("projects"));
        }
    }

    #[test]
    fn rel_path_validation() {
        assert_eq!(validate_rel_path("").expect("ok"), Vec::<String>::new());
        assert_eq!(validate_rel_path("./src//a").expect("ok"), vec!["src", "a"]);
        assert_eq!(validate_rel_path("src\\a").expect("ok"), vec!["src", "a"]);
        for bad in [
            "..",
            "src/../..",
            "/etc",
            "\\x",
            "C:\\Windows",
            "c:x",
            "file.txt:stream",
            "a\0b",
            "\\\\server\\share",
        ] {
            assert!(validate_rel_path(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn resolve_stays_inside_root() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path().join("proj");
        std::fs::create_dir_all(root.join("src")).expect("mkdir");
        std::fs::write(root.join("src/a.txt"), "x").expect("write");
        std::fs::write(tmp.path().join("secret.txt"), "s").expect("write");
        let root = std::fs::canonicalize(&root).expect("canon");

        let p = resolve_in_root(&root, "src/a.txt").expect("inside");
        assert_eq!(rel_from_root(&root, &p).as_deref(), Some("src/a.txt"));
        assert_eq!(resolve_in_root(&root, "").expect("root"), root);
        assert!(resolve_in_root(&root, "../secret.txt").is_err());
        assert!(resolve_in_root(&root, "missing").is_err());

        // A symlink escaping the root is rejected (skipped when the OS does not
        // allow creating symlinks without privileges).
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_file(
            tmp.path().join("secret.txt"),
            root.join("link.txt"),
        );
        #[cfg(unix)]
        let linked =
            std::os::unix::fs::symlink(tmp.path().join("secret.txt"), root.join("link.txt"));
        if linked.is_ok() {
            let err = resolve_in_root(&root, "link.txt").expect_err("escape");
            assert_eq!(err.code, "forbidden");
        }
    }
}
