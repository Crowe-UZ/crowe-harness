//! Claude Code agents and skills (`agents/*.md`, `skills/*/SKILL.md`) from
//! the user config dir (through the [`ConfigGuard`]) and the project's
//! `.claude/` folder (inside the project root).

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::NativeResult;
use crate::guard::{resolve_in_root, ConfigGuard};
use crate::util::is_unc_like;

const MAX_DEF_BYTES: u64 = 256 * 1024;
const MAX_DEFS: usize = 500;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    User,
    Project,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub name: String,
    pub description: String,
    pub tools: Vec<String>,
    pub model: Option<String>,
    pub scope: Scope,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
    pub scope: Scope,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FmValue {
    Scalar(String),
    List(Vec<String>),
}

impl FmValue {
    fn as_text(&self) -> String {
        match self {
            FmValue::Scalar(s) => s.clone(),
            FmValue::List(items) => items.join(", "),
        }
    }

    fn as_list(&self) -> Vec<String> {
        match self {
            FmValue::Scalar(s) => s
                .split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .collect(),
            FmValue::List(items) => items.clone(),
        }
    }
}

fn unquote(s: &str) -> String {
    let s = s.trim();
    let quoted = s.len() >= 2
        && ((s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\'')));
    if quoted {
        s[1..s.len() - 1].to_owned()
    } else {
        s.to_owned()
    }
}

/// Minimal YAML front matter parser: `key: value`, quoted scalars, inline
/// `[a, b]` lists, `- item` block lists and `|`/`>` block scalars.
pub fn parse_frontmatter(text: &str) -> Option<HashMap<String, FmValue>> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut lines = text.lines();
    if lines.next()?.trim_end() != "---" {
        return None;
    }
    let mut body: Vec<&str> = Vec::new();
    let mut closed = false;
    for l in lines {
        let t = l.trim_end();
        if t == "---" || t == "..." {
            closed = true;
            break;
        }
        body.push(l);
    }
    if !closed {
        return None;
    }

    let mut out = HashMap::new();
    let mut i = 0;
    while i < body.len() {
        let line = body[i];
        i += 1;
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || line.starts_with([' ', '\t']) {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim().to_owned();
        let value = value.trim();
        // Indented continuation lines belong to this key.
        let mut cont: Vec<&str> = Vec::new();
        while i < body.len() && (body[i].starts_with([' ', '\t']) || body[i].trim().is_empty()) {
            cont.push(body[i]);
            i += 1;
        }
        let parsed = if value.is_empty() || matches!(value, "|" | ">" | "|-" | ">-" | "|+" | ">+") {
            let items: Vec<&str> = cont
                .iter()
                .map(|l| l.trim())
                .filter(|l| !l.is_empty())
                .collect();
            if !items.is_empty() && items.iter().all(|l| l.starts_with("- ") || *l == "-") {
                FmValue::List(
                    items
                        .iter()
                        .map(|l| unquote(l.trim_start_matches('-')))
                        .filter(|s| !s.is_empty())
                        .collect(),
                )
            } else {
                let sep = if value.starts_with('|') { "\n" } else { " " };
                FmValue::Scalar(items.join(sep))
            }
        } else if value.starts_with('[') && value.ends_with(']') {
            FmValue::List(
                value[1..value.len() - 1]
                    .split(',')
                    .map(unquote)
                    .filter(|s| !s.is_empty())
                    .collect(),
            )
        } else {
            let mut s = unquote(value);
            // Plain multi-line scalars fold into one line.
            for c in cont.iter().map(|l| l.trim()).filter(|l| !l.is_empty()) {
                s.push(' ');
                s.push_str(c);
            }
            FmValue::Scalar(s)
        };
        out.insert(key, parsed);
    }
    Some(out)
}

pub fn agent_from(text: &str, fallback_name: &str, scope: Scope) -> AgentInfo {
    let fm = parse_frontmatter(text).unwrap_or_default();
    let get = |k: &str| {
        fm.get(k)
            .map(FmValue::as_text)
            .filter(|s| !s.trim().is_empty())
    };
    AgentInfo {
        name: get("name").unwrap_or_else(|| fallback_name.to_owned()),
        description: get("description").unwrap_or_default(),
        tools: fm.get("tools").map(FmValue::as_list).unwrap_or_default(),
        model: get("model"),
        scope,
    }
}

pub fn skill_from(text: &str, fallback_name: &str, scope: Scope) -> SkillInfo {
    let fm = parse_frontmatter(text).unwrap_or_default();
    let get = |k: &str| {
        fm.get(k)
            .map(FmValue::as_text)
            .filter(|s| !s.trim().is_empty())
    };
    SkillInfo {
        name: get("name").unwrap_or_else(|| fallback_name.to_owned()),
        description: get("description").unwrap_or_default(),
        scope,
    }
}

/// Where definitions are read from, with the matching access check.
enum Source<'a> {
    User(&'a ConfigGuard),
    Project(&'a Path),
}

impl Source<'_> {
    fn read_dir(&self, dir: &Path) -> Vec<std::fs::DirEntry> {
        let rd = match self {
            Source::User(g) => g.read_dir(dir).ok(),
            Source::Project(root) => self
                .check(root, dir)
                .and_then(|d| std::fs::read_dir(d).ok()),
        };
        rd.map(|rd| rd.flatten().take(MAX_DEFS).collect())
            .unwrap_or_default()
    }

    fn check(&self, root: &Path, path: &Path) -> Option<PathBuf> {
        let c = std::fs::canonicalize(path).ok()?;
        (c.starts_with(root) && !is_unc_like(&c)).then_some(c)
    }

    fn read(&self, path: &Path) -> Option<String> {
        let file = match self {
            Source::User(g) => g.open(path).ok()?,
            Source::Project(root) => std::fs::File::open(self.check(root, path)?).ok()?,
        };
        let mut buf = Vec::new();
        file.take(MAX_DEF_BYTES).read_to_end(&mut buf).ok()?;
        Some(String::from_utf8_lossy(&buf).into_owned())
    }
}

fn agents_in(src: &Source, dir: &Path, scope: Scope) -> Vec<AgentInfo> {
    src.read_dir(dir)
        .into_iter()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let stem = name.strip_suffix(".md")?;
            let text = src.read(&e.path())?;
            Some(agent_from(&text, stem, scope))
        })
        .collect()
}

fn skills_in(src: &Source, dir: &Path, scope: Scope) -> Vec<SkillInfo> {
    src.read_dir(dir)
        .into_iter()
        .filter_map(|e| {
            let dir_name = e.file_name().to_string_lossy().into_owned();
            let text = src.read(&e.path().join("SKILL.md"))?;
            Some(skill_from(&text, &dir_name, scope))
        })
        .collect()
}

fn project_claude_dir(root: &Path, sub: &str) -> Option<PathBuf> {
    resolve_in_root(root, &format!(".claude/{sub}")).ok()
}

pub fn list_agents(
    guard: Option<&ConfigGuard>,
    project_root: Option<&Path>,
) -> NativeResult<Vec<AgentInfo>> {
    let mut out = Vec::new();
    if let Some(g) = guard {
        out.extend(agents_in(&Source::User(g), &g.agents_dir(), Scope::User));
    }
    if let Some(root) = project_root {
        if let Some(dir) = project_claude_dir(root, "agents") {
            out.extend(agents_in(&Source::Project(root), &dir, Scope::Project));
        }
    }
    out.sort_by_key(|a| a.name.to_lowercase());
    Ok(out)
}

pub fn list_skills(
    guard: Option<&ConfigGuard>,
    project_root: Option<&Path>,
) -> NativeResult<Vec<SkillInfo>> {
    let mut out = Vec::new();
    if let Some(g) = guard {
        out.extend(skills_in(&Source::User(g), &g.skills_dir(), Scope::User));
    }
    if let Some(root) = project_root {
        if let Some(dir) = project_claude_dir(root, "skills") {
            out.extend(skills_in(&Source::Project(root), &dir, Scope::Project));
        }
    }
    out.sort_by_key(|a| a.name.to_lowercase());
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontmatter_variants() {
        let text = "---\nname: code-reviewer\ndescription: \"Reviews code: carefully\"\ntools: Read, Grep,  Glob\nmodel: sonnet\n# comment\n---\nBody: not parsed\n";
        let a = agent_from(text, "fallback", Scope::User);
        assert_eq!(a.name, "code-reviewer");
        assert_eq!(a.description, "Reviews code: carefully");
        assert_eq!(a.tools, ["Read", "Grep", "Glob"]);
        assert_eq!(a.model.as_deref(), Some("sonnet"));

        let text = "---\ndescription: >\n  Folded\n  text\ntools:\n  - Read\n  - 'Bash'\n---\n";
        let a = agent_from(text, "file-stem", Scope::Project);
        assert_eq!(a.name, "file-stem");
        assert_eq!(a.description, "Folded text");
        assert_eq!(a.tools, ["Read", "Bash"]);
        assert_eq!(a.model, None);

        let text = "---\nname: x\ntools: [Read, \"Edit\"]\ndescription: one\n  two\n---";
        let a = agent_from(text, "f", Scope::User);
        assert_eq!(a.tools, ["Read", "Edit"]);
        assert_eq!(a.description, "one two");

        assert!(parse_frontmatter("no frontmatter").is_none());
        assert!(parse_frontmatter("---\nname: unclosed\n").is_none());
        let a = agent_from("plain markdown", "stem", Scope::User);
        assert_eq!((a.name.as_str(), a.description.as_str()), ("stem", ""));

        let s = skill_from(
            "\u{feff}---\nname: pdf\ndescription: |\n  Line one\n  Line two\n---\n",
            "dir",
            Scope::User,
        );
        assert_eq!(s.name, "pdf");
        assert_eq!(s.description, "Line one\nLine two");
    }

    #[test]
    fn lists_user_and_project_definitions() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let cfg = tmp.path().join(".claude");
        std::fs::create_dir_all(cfg.join("agents")).expect("mkdir");
        std::fs::create_dir_all(cfg.join("skills/pdf")).expect("mkdir");
        std::fs::write(cfg.join("agents/reviewer.md"), "---\ndescription: d\n---\n").expect("w");
        std::fs::write(cfg.join("agents/notes.txt"), "ignored").expect("w");
        std::fs::write(
            cfg.join("skills/pdf/SKILL.md"),
            "---\nname: pdf\ndescription: PDFs\n---\n",
        )
        .expect("w");
        let proj = tmp.path().join("proj");
        std::fs::create_dir_all(proj.join(".claude/agents")).expect("mkdir");
        std::fs::create_dir_all(proj.join(".claude/skills/deploy")).expect("mkdir");
        std::fs::write(
            proj.join(".claude/agents/builder.md"),
            "---\nname: builder\n---\n",
        )
        .expect("w");
        std::fs::write(
            proj.join(".claude/skills/deploy/SKILL.md"),
            "---\ndescription: Ship\n---\n",
        )
        .expect("w");
        let root = std::fs::canonicalize(&proj).expect("canon");
        let guard = ConfigGuard::new(&cfg, None).expect("guard");

        let agents = list_agents(Some(&guard), Some(&root)).expect("agents");
        let got: Vec<(&str, Scope)> = agents.iter().map(|a| (a.name.as_str(), a.scope)).collect();
        assert_eq!(
            got,
            [("builder", Scope::Project), ("reviewer", Scope::User)]
        );

        let skills = list_skills(Some(&guard), Some(&root)).expect("skills");
        let got: Vec<(&str, Scope)> = skills.iter().map(|s| (s.name.as_str(), s.scope)).collect();
        assert_eq!(got, [("deploy", Scope::Project), ("pdf", Scope::User)]);
        let json = serde_json::to_value(&skills[0]).expect("json");
        assert_eq!(
            json,
            serde_json::json!({"name":"deploy","description":"Ship","scope":"project"})
        );

        assert!(list_agents(None, None).expect("empty").is_empty());
    }
}
