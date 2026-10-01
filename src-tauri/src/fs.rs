//! Read-only workspace access (`fs_list_dir`, `fs_read_file`).
//!
//! Every path is resolved inside the canonical project root
//! ([`crate::guard::resolve_in_root`]); listings honour `.gitignore` files
//! from the root down to the listed directory plus `.git/info/exclude`.

use std::io::Read;
use std::path::{Path, PathBuf};

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use ignore::Match;
use serde::Serialize;

use crate::error::{NativeError, NativeResult};
use crate::guard::{rel_from_root, resolve_in_root};

pub const MAX_FILE_BYTES: usize = 1024 * 1024;
pub const MAX_DIR_ENTRIES: usize = 10_000;
const BINARY_SNIFF: usize = 8 * 1024;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Dir,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub rel_path: String,
    pub kind: EntryKind,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub content: String,
    pub truncated: bool,
    pub binary: bool,
}

/// `.gitignore` matchers from `root` down to `dir` (outermost first).
fn matchers(root: &Path, dir: &Path) -> Vec<Gitignore> {
    let mut out = Vec::new();
    let exclude = root.join(".git").join("info").join("exclude");
    let exclude_inside =
        std::fs::canonicalize(&exclude).is_ok_and(|c| c.starts_with(root) && c.is_file());
    if exclude_inside {
        let mut b = GitignoreBuilder::new(root);
        if b.add(&exclude).is_none() {
            if let Ok(g) = b.build() {
                out.push(g);
            }
        }
    }
    let mut levels: Vec<PathBuf> = vec![root.to_path_buf()];
    if let Ok(rel) = dir.strip_prefix(root) {
        let mut cur = root.to_path_buf();
        for c in rel.components() {
            cur.push(c);
            levels.push(cur.clone());
        }
    }
    for level in levels {
        let gi = level.join(".gitignore");
        // Only regular files inside the root (a symlinked .gitignore is skipped).
        let inside = std::fs::canonicalize(&gi).is_ok_and(|c| c.starts_with(root) && c.is_file());
        if !inside {
            continue;
        }
        let mut b = GitignoreBuilder::new(&level);
        if b.add(&gi).is_none() {
            if let Ok(g) = b.build() {
                out.push(g);
            }
        }
    }
    out
}

fn is_ignored(matchers: &[Gitignore], path: &Path, is_dir: bool) -> bool {
    for m in matchers.iter().rev() {
        match m.matched(path, is_dir) {
            Match::Ignore(_) => return true,
            Match::Whitelist(_) => return false,
            Match::None => {}
        }
    }
    false
}

/// Lists one directory of the project (dirs first, then files, by name).
pub fn list_dir(root: &Path, rel: &str) -> NativeResult<Vec<DirEntry>> {
    let dir = resolve_in_root(root, rel)?;
    if !dir.is_dir() {
        return Err(NativeError::invalid("not a directory"));
    }
    let ms = matchers(root, &dir);
    let rd = std::fs::read_dir(&dir).map_err(|e| NativeError::io("directory", &e))?;
    let mut out = Vec::new();
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == ".git" {
            continue;
        }
        let Ok(ft) = entry.file_type() else { continue };
        let path = entry.path();
        let (is_dir, target) = if ft.is_symlink() {
            // Follow links only when they stay inside the project.
            match std::fs::canonicalize(&path) {
                Ok(c) if c.starts_with(root) => (c.is_dir(), c),
                _ => continue,
            }
        } else {
            (ft.is_dir(), path.clone())
        };
        if !is_dir && !target.is_file() {
            continue;
        }
        if is_ignored(&ms, &path, is_dir) {
            continue;
        }
        let Some(dir_rel) = rel_from_root(root, &dir) else {
            continue;
        };
        let rel_path = if dir_rel.is_empty() {
            name.clone()
        } else {
            format!("{dir_rel}/{name}")
        };
        out.push(DirEntry {
            name,
            rel_path,
            kind: if is_dir {
                EntryKind::Dir
            } else {
                EntryKind::File
            },
        });
        if out.len() >= MAX_DIR_ENTRIES {
            break;
        }
    }
    out.sort_by(|a, b| {
        (a.kind != EntryKind::Dir)
            .cmp(&(b.kind != EntryKind::Dir))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(out)
}

/// Reads a project file (≤ 1 MB; binary files return empty content).
pub fn read_file(root: &Path, rel: &str) -> NativeResult<FileContent> {
    let path = resolve_in_root(root, rel)?;
    if !path.is_file() {
        return Err(NativeError::invalid("not a file"));
    }
    let file = std::fs::File::open(&path).map_err(|e| NativeError::io("file", &e))?;
    let mut buf = Vec::new();
    file.take(MAX_FILE_BYTES as u64 + 1)
        .read_to_end(&mut buf)
        .map_err(|e| NativeError::io("file", &e))?;
    let truncated = buf.len() > MAX_FILE_BYTES;
    buf.truncate(MAX_FILE_BYTES);
    let binary = buf[..buf.len().min(BINARY_SNIFF)].contains(&0);
    Ok(FileContent {
        content: if binary {
            String::new()
        } else {
            String::from_utf8_lossy(&buf).into_owned()
        },
        truncated,
        binary,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, PathBuf) {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path().join("proj");
        for d in [
            ".git/info",
            "src/gen",
            "node_modules/x",
            "target",
            "docs",
            ".github",
        ] {
            std::fs::create_dir_all(root.join(d)).expect("mkdir");
        }
        std::fs::write(
            root.join(".gitignore"),
            "node_modules/\n/target\n*.log\n!keep.log\n",
        )
        .expect("w");
        std::fs::write(root.join("src/.gitignore"), "gen/\n").expect("w");
        std::fs::write(root.join(".git/info/exclude"), "secret.txt\n").expect("w");
        for f in [
            "README.md",
            "a.log",
            "keep.log",
            "secret.txt",
            "src/main.rs",
            "Zeta.txt",
            "alpha.txt",
        ] {
            std::fs::write(root.join(f), "hello").expect("w");
        }
        std::fs::write(root.join("bin.dat"), [0u8, 1, 2, 3]).expect("w");
        std::fs::write(root.join("big.txt"), "x".repeat(MAX_FILE_BYTES + 10)).expect("w");
        let root = std::fs::canonicalize(root).expect("canon");
        (tmp, root)
    }

    #[test]
    fn lists_with_gitignore_dirs_first() {
        let (_tmp, root) = setup();
        let names: Vec<(String, EntryKind)> = list_dir(&root, "")
            .expect("list")
            .into_iter()
            .map(|e| (e.name, e.kind))
            .collect();
        let dirs: Vec<&str> = names
            .iter()
            .filter(|(_, k)| *k == EntryKind::Dir)
            .map(|(n, _)| n.as_str())
            .collect();
        assert_eq!(dirs, [".github", "docs", "src"]);
        let files: Vec<&str> = names
            .iter()
            .filter(|(_, k)| *k == EntryKind::File)
            .map(|(n, _)| n.as_str())
            .collect();
        assert_eq!(
            files,
            [
                ".gitignore",
                "alpha.txt",
                "big.txt",
                "bin.dat",
                "keep.log",
                "README.md",
                "Zeta.txt"
            ]
        );
        // Kind of the first entries: dirs before files.
        assert_eq!(names[0].1, EntryKind::Dir);

        let src = list_dir(&root, "src").expect("list");
        let rels: Vec<&str> = src.iter().map(|e| e.rel_path.as_str()).collect();
        assert_eq!(rels, ["src/.gitignore", "src/main.rs"]);
        let json = serde_json::to_value(&src[1]).expect("json");
        assert_eq!(
            json,
            serde_json::json!({"name":"main.rs","relPath":"src/main.rs","kind":"file"})
        );

        assert!(list_dir(&root, "..").is_err());
        assert!(list_dir(&root, "README.md").is_err());
    }

    #[test]
    fn reads_text_binary_and_truncates() {
        let (_tmp, root) = setup();
        let f = read_file(&root, "src/main.rs").expect("read");
        assert_eq!(
            f,
            FileContent {
                content: "hello".into(),
                truncated: false,
                binary: false
            }
        );
        let b = read_file(&root, "bin.dat").expect("read");
        assert!(b.binary && b.content.is_empty());
        let big = read_file(&root, "big.txt").expect("read");
        assert!(big.truncated);
        assert_eq!(big.content.len(), MAX_FILE_BYTES);
        assert!(read_file(&root, "../proj/README.md").is_err());
        assert!(read_file(&root, "src").is_err());
    }
}
