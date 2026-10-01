//! Project registry: Claude Code history directories merged with folders the
//! user opened in Crowe Harness (persisted as JSON in the app data dir).
//!
//! The webview only ever sees project ids. Ids are resolved here to a
//! canonical project root and the matching history directories.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use memchr::memmem;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::claude::history::{FileMeta, HistoryCache};
use crate::claude::records::LStr;
use crate::error::{NativeError, NativeResult};
use crate::guard::ConfigGuard;
use crate::util::{display_path, is_unc_like, iso_time, path_key};

pub const OPENED_PREFIX: &str = "opened-";
/// Lines scanned per transcript when looking for the recorded `cwd`.
const CWD_SCAN_LINES: usize = 2000;
/// Newest transcripts tried per project when looking for the `cwd`.
const CWD_SCAN_FILES: usize = 3;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProjectSource {
    History,
    Opened,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub id: String,
    pub name: String,
    pub path: Option<String>,
    pub session_count: u32,
    pub last_activity: Option<String>,
    pub source: ProjectSource,
}

// ---------------------------------------------------------------- opened registry

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenedFolder {
    pub path: String,
    pub added_at: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct RegistryFile {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    folders: Vec<OpenedFolder>,
}

/// Folders opened by the user, stored in `<app data>/projects.json`.
pub struct OpenedRegistry {
    file: Option<PathBuf>,
    lock: Mutex<()>,
}

impl OpenedRegistry {
    pub fn new(file: Option<PathBuf>) -> Self {
        Self {
            file,
            lock: Mutex::new(()),
        }
    }

    pub fn load(&self) -> Vec<OpenedFolder> {
        let _g = self.lock.lock();
        self.load_unlocked()
    }

    fn load_unlocked(&self) -> Vec<OpenedFolder> {
        let Some(file) = &self.file else {
            return Vec::new();
        };
        std::fs::read_to_string(file)
            .ok()
            .and_then(|s| serde_json::from_str::<RegistryFile>(&s).ok())
            .map(|r| r.folders)
            .unwrap_or_default()
    }

    /// Adds a canonical folder (no-op when already present).
    pub fn add(&self, canonical: &Path) -> NativeResult<()> {
        let _g = self.lock.lock();
        let Some(file) = &self.file else {
            return Err(NativeError::internal("app data directory is unavailable"));
        };
        let mut folders = self.load_unlocked();
        let key = path_key(canonical);
        if folders.iter().any(|f| path_key(Path::new(&f.path)) == key) {
            return Ok(());
        }
        folders.push(OpenedFolder {
            path: display_path(canonical),
            added_at: iso_time(SystemTime::now()),
        });
        let json = serde_json::to_string_pretty(&RegistryFile {
            version: 1,
            folders,
        })
        .map_err(|_| NativeError::internal("could not encode the project registry"))?;
        if let Some(parent) = file.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| NativeError::io("app data directory", &e))?;
        }
        let tmp = file.with_extension("json.tmp");
        std::fs::write(&tmp, json).map_err(|e| NativeError::io("project registry", &e))?;
        std::fs::rename(&tmp, file).map_err(|e| NativeError::io("project registry", &e))
    }
}

/// Stable id of an opened folder: `opened-<12 hex of sha256(path key)>`.
pub fn opened_id(path: &Path) -> String {
    let digest = Sha256::digest(path_key(path).as_bytes());
    let hex: String = digest.iter().take(6).map(|b| format!("{b:02x}")).collect();
    format!("{OPENED_PREFIX}{hex}")
}

/// Claude Code's history directory name for a project path.
pub fn encode_project_dir(path: &str) -> String {
    path.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// Valid history directory name (no separators, no traversal).
pub fn is_history_dir_name(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 255
        && id != "."
        && id != ".."
        && !id.starts_with(OPENED_PREFIX)
        && id
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | ' '))
}

fn folder_name(path: &str) -> Option<String> {
    path.trim_end_matches(['\\', '/'])
        .rsplit(['\\', '/'])
        .next()
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

// ---------------------------------------------------------------- history scan

#[derive(Debug, Clone)]
pub struct HistoryProject {
    pub dir_name: String,
    pub dir: PathBuf,
    pub cwd: Option<String>,
    pub session_files: u32,
    pub last_activity: Option<SystemTime>,
}

impl HistoryProject {
    /// Canonical project root when the recorded folder still exists.
    pub fn root(&self) -> Option<PathBuf> {
        let c = canonical_local(self.cwd.as_ref()?)?;
        c.is_dir().then_some(c)
    }

    fn key(&self) -> Option<String> {
        let cwd = self.cwd.as_ref()?;
        Some(match canonical_local(cwd) {
            Some(c) => path_key(&c),
            None => path_key(Path::new(cwd)),
        })
    }
}

/// Canonicalizes a local path. Network/UNC paths are not touched at all (an
/// unreachable share could block the listing for a long time).
fn canonical_local(path: &str) -> Option<PathBuf> {
    if is_unc_like(Path::new(path)) || path.starts_with("//") {
        return None;
    }
    let c = std::fs::canonicalize(path).ok()?;
    (!is_unc_like(&c)).then_some(c)
}

type CwdEntry = (u64, SystemTime, Option<String>);

/// Cache of the `cwd` recorded in a transcript, keyed by (path, len, mtime).
#[derive(Default)]
pub struct CwdCache {
    map: Mutex<HashMap<PathBuf, CwdEntry>>,
}

#[derive(Deserialize)]
struct CwdOnly {
    #[serde(default)]
    cwd: LStr,
}

impl CwdCache {
    fn cwd_of(&self, guard: &ConfigGuard, history: &HistoryCache, f: &FileMeta) -> Option<String> {
        if let Some(Some(s)) = history.get(f) {
            if s.cwd.is_some() {
                return s.cwd;
            }
        }
        if let Ok(map) = self.map.lock() {
            if let Some((len, mtime, cwd)) = map.get(&f.path) {
                if *len == f.len && *mtime == f.mtime {
                    return cwd.clone();
                }
            }
        }
        let found = scan_cwd(guard, &f.path);
        if let Ok(mut map) = self.map.lock() {
            map.insert(f.path.clone(), (f.len, f.mtime, found.clone()));
        }
        found
    }
}

fn scan_cwd(guard: &ConfigGuard, path: &Path) -> Option<String> {
    let file = guard.open(path).ok()?;
    let mut reader = BufReader::with_capacity(64 * 1024, file);
    let mut buf = Vec::new();
    for _ in 0..CWD_SCAN_LINES {
        buf.clear();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => return None,
            Ok(_) => {}
        }
        if memmem::find(&buf, b"\"cwd\":\"").is_none() {
            continue;
        }
        if let Ok(rec) = serde_json::from_slice::<CwdOnly>(buf.trim_ascii()) {
            if let Some(cwd) = rec.cwd.non_empty() {
                return Some(cwd.to_owned());
            }
        }
    }
    None
}

fn scan_project_dir(
    guard: &ConfigGuard,
    history: &HistoryCache,
    cwd_cache: &CwdCache,
    dir: &Path,
    dir_name: String,
) -> Option<HistoryProject> {
    let (mut files, _) = crate::claude::history::list_session_files(guard, dir).ok()?;
    files.retain(|f| f.len > 0 && !matches!(history.get(f), Some(None)));
    files.sort_by_key(|f| std::cmp::Reverse(f.mtime));
    let cwd = files
        .iter()
        .take(CWD_SCAN_FILES)
        .find_map(|f| cwd_cache.cwd_of(guard, history, f));
    Some(HistoryProject {
        dir_name,
        dir: dir.to_path_buf(),
        cwd,
        session_files: files.len() as u32,
        last_activity: files.first().map(|f| f.mtime),
    })
}

/// All history projects (directories under `<config>/projects`).
pub fn scan_history(
    guard: &ConfigGuard,
    history: &HistoryCache,
    cwd_cache: &CwdCache,
) -> Vec<HistoryProject> {
    let root = guard.projects_dir();
    let Ok(rd) = guard.read_dir(&root) else {
        return Vec::new();
    };
    rd.flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if !is_history_dir_name(&name) {
                return None;
            }
            scan_project_dir(guard, history, cwd_cache, &e.path(), name)
        })
        .collect()
}

/// One history project by id.
pub fn history_project(
    guard: &ConfigGuard,
    history: &HistoryCache,
    cwd_cache: &CwdCache,
    id: &str,
) -> NativeResult<HistoryProject> {
    if !is_history_dir_name(id) {
        return Err(NativeError::invalid("invalid project id"));
    }
    let dir = guard.projects_dir().join(id);
    let canonical = guard
        .check(&dir)
        .map_err(|_| NativeError::not_found("project not found"))?;
    if !canonical.is_dir() {
        return Err(NativeError::not_found("project not found"));
    }
    scan_project_dir(guard, history, cwd_cache, &canonical, id.to_owned())
        .ok_or_else(|| NativeError::not_found("project not found"))
}

// ---------------------------------------------------------------- listing + resolution

fn history_info(p: &HistoryProject) -> ProjectInfo {
    let path = p.cwd.as_ref().map(|cwd| match canonical_local(cwd) {
        Some(c) => display_path(&c),
        None => cwd.clone(),
    });
    ProjectInfo {
        id: p.dir_name.clone(),
        name: path
            .as_deref()
            .and_then(folder_name)
            .unwrap_or_else(|| p.dir_name.clone()),
        path,
        session_count: p.session_files,
        last_activity: p.last_activity.map(iso_time),
        source: ProjectSource::History,
    }
}

fn opened_info(f: &OpenedFolder) -> ProjectInfo {
    ProjectInfo {
        id: opened_id(Path::new(&f.path)),
        name: folder_name(&f.path).unwrap_or_else(|| f.path.clone()),
        path: Some(f.path.clone()),
        session_count: 0,
        last_activity: Some(f.added_at.clone()),
        source: ProjectSource::Opened,
    }
}

/// Merges history projects and opened folders (same folder => history id
/// wins), newest activity first.
pub fn merge_projects(history: &[HistoryProject], opened: &[OpenedFolder]) -> Vec<ProjectInfo> {
    let mut out: Vec<ProjectInfo> = history
        .iter()
        .filter(|p| p.session_files > 0)
        .map(history_info)
        .collect();
    // Only listed history projects absorb an opened folder.
    let keys: std::collections::HashSet<String> = history
        .iter()
        .filter(|p| p.session_files > 0)
        .filter_map(HistoryProject::key)
        .collect();
    for f in opened {
        let key = match canonical_local(&f.path) {
            Some(c) => path_key(&c),
            None => path_key(Path::new(&f.path)),
        };
        if !keys.contains(&key) {
            out.push(opened_info(f));
        }
    }
    out.sort_by(|a, b| {
        b.last_activity
            .cmp(&a.last_activity)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    out
}

/// What a project id resolves to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedProject {
    /// Canonical, existing project folder (None if it no longer exists).
    pub root: Option<PathBuf>,
    pub history_dirs: Vec<PathBuf>,
}

impl ResolvedProject {
    pub fn require_root(&self) -> NativeResult<&Path> {
        self.root
            .as_deref()
            .ok_or_else(|| NativeError::not_found("project folder not found on disk"))
    }
}

pub fn resolve(
    guard: Option<&ConfigGuard>,
    history: &HistoryCache,
    cwd_cache: &CwdCache,
    registry: &OpenedRegistry,
    id: &str,
) -> NativeResult<ResolvedProject> {
    if id.starts_with(OPENED_PREFIX) {
        let folder = registry
            .load()
            .into_iter()
            .find(|f| opened_id(Path::new(&f.path)) == id)
            .ok_or_else(|| NativeError::not_found("project not found"))?;
        let root = canonical_local(&folder.path).filter(|c| c.is_dir());
        let key = root
            .as_deref()
            .map_or_else(|| path_key(Path::new(&folder.path)), path_key);
        let mut history_dirs = Vec::new();
        if let Some(guard) = guard {
            let encoded = encode_project_dir(&folder.path);
            for p in scan_history(guard, history, cwd_cache) {
                if p.dir_name == encoded || p.key().as_deref() == Some(key.as_str()) {
                    history_dirs.push(p.dir);
                }
            }
        }
        return Ok(ResolvedProject { root, history_dirs });
    }
    let guard = guard.ok_or_else(|| NativeError::not_found("project not found"))?;
    let p = history_project(guard, history, cwd_cache, id)?;
    Ok(ResolvedProject {
        root: p.root(),
        history_dirs: vec![p.dir],
    })
}

/// Validates a folder picked by the user and returns its canonical path.
pub fn validate_opened_folder(path: &Path) -> NativeResult<PathBuf> {
    let canonical = std::fs::canonicalize(path).map_err(|e| NativeError::io("folder", &e))?;
    if !canonical.is_dir() {
        return Err(NativeError::invalid("not a folder"));
    }
    if is_unc_like(&canonical) {
        return Err(NativeError::invalid("network folders are not supported"));
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;

    const S1: &str = "11111111-2222-3333-4444-555555555555";

    fn user_line(cwd: &str) -> String {
        let cwd = cwd.replace('\\', "\\\\");
        format!(
            r#"{{"type":"user","message":{{"content":"hello"}},"uuid":"u","timestamp":"2026-01-01T00:00:00.000Z","cwd":"{cwd}"}}"#
        )
    }

    #[test]
    fn ids_and_encoding() {
        assert_eq!(
            encode_project_dir(r"C:\Users\a.b\prj\X_y"),
            "C--Users-a-b-prj-X-y"
        );
        assert!(is_history_dir_name("C--Users-a-b-prj-X"));
        assert!(!is_history_dir_name(".."));
        assert!(!is_history_dir_name("a/b"));
        assert!(!is_history_dir_name("a\\b"));
        assert!(!is_history_dir_name("opened-abc"));
        let id = opened_id(Path::new(r"C:\Work\Demo"));
        assert!(id.starts_with(OPENED_PREFIX) && id.len() == OPENED_PREFIX.len() + 12);
        if cfg!(windows) {
            assert_eq!(id, opened_id(Path::new(r"c:\work\demo\")));
        }
        assert_eq!(folder_name(r"C:\a\b\"), Some("b".into()));
    }

    #[test]
    fn scan_merge_and_resolve() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let cfg = tmp.path().join(".claude");
        let work = tmp.path().join("work");
        let other = tmp.path().join("other");
        std::fs::create_dir_all(&work).expect("mkdir");
        std::fs::create_dir_all(&other).expect("mkdir");
        let work_c = std::fs::canonicalize(&work).expect("canon");

        let hist = cfg.join("projects").join("hist-work");
        std::fs::create_dir_all(&hist).expect("mkdir");
        std::fs::write(
            hist.join(format!("{S1}.jsonl")),
            user_line(&display_path(&work_c)),
        )
        .expect("write");
        std::fs::create_dir_all(cfg.join("projects").join("empty-dir")).expect("mkdir");

        let guard = ConfigGuard::new(&cfg, None).expect("guard");
        let history = HistoryCache::default();
        let cwd_cache = CwdCache::default();
        let projects = scan_history(&guard, &history, &cwd_cache);
        assert_eq!(projects.len(), 2);
        let hp = projects
            .iter()
            .find(|p| p.dir_name == "hist-work")
            .expect("hist");
        assert_eq!(hp.session_files, 1);
        assert_eq!(hp.root().as_deref(), Some(work_c.as_path()));

        let registry = OpenedRegistry::new(Some(tmp.path().join("app").join("projects.json")));
        registry.add(&work_c).expect("add");
        registry.add(&work_c).expect("add twice");
        registry
            .add(&std::fs::canonicalize(&other).expect("canon"))
            .expect("add");
        assert_eq!(registry.load().len(), 2);

        let merged = merge_projects(&projects, &registry.load());
        let ids: Vec<&str> = merged.iter().map(|p| p.id.as_str()).collect();
        assert!(ids.contains(&"hist-work"));
        assert!(
            !ids.contains(&"empty-dir"),
            "history dirs without sessions are hidden"
        );
        assert!(
            !ids.contains(&opened_id(&work_c).as_str()),
            "duplicate folder merged"
        );
        let opened = merged
            .iter()
            .find(|p| p.source == ProjectSource::Opened)
            .expect("opened");
        assert_eq!(opened.name, "other");
        let json = serde_json::to_value(opened).expect("json");
        assert_eq!(json["source"], "opened");
        assert!(json.get("sessionCount").is_some() && json.get("lastActivity").is_some());

        let r =
            resolve(Some(&guard), &history, &cwd_cache, &registry, "hist-work").expect("resolve");
        assert_eq!(r.root.as_deref(), Some(work_c.as_path()));
        assert_eq!(r.history_dirs.len(), 1);

        // The opened id of a merged folder still resolves (and finds its history).
        let r = resolve(
            Some(&guard),
            &history,
            &cwd_cache,
            &registry,
            &opened_id(&work_c),
        )
        .expect("resolve");
        assert_eq!(r.root.as_deref(), Some(work_c.as_path()));
        assert_eq!(r.history_dirs.len(), 1);

        for bad in [
            "..",
            "../x",
            "opened-000000000000",
            "missing",
            "a\\..\\..\\x",
        ] {
            assert!(
                resolve(Some(&guard), &history, &cwd_cache, &registry, bad).is_err(),
                "{bad}"
            );
        }
        let empty =
            resolve(Some(&guard), &history, &cwd_cache, &registry, "empty-dir").expect("resolve");
        assert!(empty.require_root().is_err());
    }

    #[test]
    fn corrupt_registry_is_empty() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let file = tmp.path().join("projects.json");
        std::fs::write(&file, "{not json").expect("write");
        assert!(OpenedRegistry::new(Some(file)).load().is_empty());
        assert!(OpenedRegistry::new(None).load().is_empty());
    }
}
