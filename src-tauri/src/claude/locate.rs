//! Discovering `claude` executables (docs/NATIVE_API.md, "Locating `claude`").
//!
//! [`locations`] lists, in priority order, every place Claude Code may live for
//! an OS and an environment snapshot ([`LocateEnv`]) without touching the
//! filesystem. [`discover`] resolves them to existing files, deduplicated by
//! canonical path, with bounded work (no recursive scans, capped wildcard
//! matches and candidates). Validation (`claude --version`), caching and the
//! manual override live in [`super::finder`].
//!
//! Executables only: `.cmd` / `.bat` / `.ps1` shims are never returned (they
//! need a shell); for an npm shim on Windows the native binary shipped inside
//! the package is used. Relative directories are never resolved.

use std::collections::{BTreeMap, HashSet};
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::util::path_key;

#[cfg(windows)]
pub const EXE_NAME: &str = "claude.exe";
#[cfg(not(windows))]
pub const EXE_NAME: &str = "claude";

/// Upper bound of existing candidates returned by [`discover`].
pub const MAX_CANDIDATES: usize = 40;
/// Upper bound of files taken from one location with wildcards.
const MAX_MATCHES_PER_LOCATION: usize = 3;
/// Upper bound of directory entries read for one wildcard.
const MAX_DIR_ENTRIES: usize = 512;
/// Upper bound of children followed for one wildcard (highest version first).
const MAX_WILDCARD_CHILDREN: usize = 8;
/// `.npmrc` files larger than this are ignored.
const MAX_NPMRC_BYTES: u64 = 64 * 1024;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum InstallSource {
    /// Chosen by the user (`claude_pick_executable`).
    Custom,
    Path,
    Local,
    Package,
    Desktop,
}

impl InstallSource {
    pub const ALL: [InstallSource; 5] = [
        InstallSource::Custom,
        InstallSource::Path,
        InstallSource::Local,
        InstallSource::Package,
        InstallSource::Desktop,
    ];
}

/// Target OS of a location list (a parameter so every list is testable on any host).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Windows,
    MacOs,
    Linux,
}

impl Os {
    pub const fn current() -> Os {
        if cfg!(windows) {
            Os::Windows
        } else if cfg!(target_os = "macos") {
            Os::MacOs
        } else {
            Os::Linux
        }
    }

    pub const fn exe_name(self) -> &'static str {
        match self {
            Os::Windows => "claude.exe",
            _ => "claude",
        }
    }
}

pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
}

/// Directory the native installer puts its launcher in (`~/.local/bin`).
pub fn native_bin_dir(home: &Path) -> PathBuf {
    home.join(".local").join("bin")
}

/// The native installer's launcher (`~/.local/bin/claude[.exe]`), if present.
pub fn native_launcher(home: &Path) -> Option<PathBuf> {
    let p = native_bin_dir(home).join(EXE_NAME);
    if p.is_file() {
        std::fs::canonicalize(p).ok()
    } else {
        None
    }
}

/// Parses `claude --version` output (`"2.1.284 (Claude Code)"`) loosely: the
/// first token must look like a version. Used by the installer check.
pub fn parse_version(stdout: &str) -> Option<String> {
    let token = stdout.split_whitespace().next()?;
    let ok = token.chars().next()?.is_ascii_digit()
        && token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+'));
    ok.then(|| token.to_owned())
}

/// Strict check used to validate a candidate: the first token is a semantic
/// version and the output mentions "Claude Code" (any case). Returns the version.
pub fn parse_claude_version(stdout: &str) -> Option<String> {
    let token = stdout.split_whitespace().next()?;
    semver::Version::parse(token).ok()?;
    stdout
        .to_ascii_lowercase()
        .contains("claude code")
        .then(|| token.to_owned())
}

/// `true` when `path` may be run directly: on Windows an `.exe`; on Unix a
/// file with an execute bit. Shell shims (`.cmd`, `.bat`, `.ps1`) never are.
pub fn is_executable(path: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    if matches!(ext.as_deref(), Some("cmd" | "bat" | "ps1")) {
        return false;
    }
    #[cfg(windows)]
    {
        ext.as_deref() == Some("exe")
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(any(windows, unix)))]
    {
        true
    }
}

// ---------------------------------------------------------------- environment snapshot

/// Inputs of [`locations`]: the real environment ([`LocateEnv::from_process`]) or fakes in tests.
#[derive(Debug, Clone, Default)]
pub struct LocateEnv {
    pub home: Option<PathBuf>,
    /// The user's manual override (`claude_pick_executable`).
    pub custom: Option<PathBuf>,
    /// `PATH` of this process.
    pub process_path: Option<OsString>,
    /// `PATH` read fresh: the registry (Windows) or the login shell (macOS/Linux).
    pub fresh_path: Option<OsString>,
    /// Contents of `~/.npmrc` (for `prefix=`).
    pub npmrc: Option<String>,
    pub(crate) vars: BTreeMap<String, OsString>,
}

/// Environment variable names are case-insensitive on Windows.
fn var_key(name: &str) -> String {
    if cfg!(windows) {
        name.to_ascii_uppercase()
    } else {
        name.to_owned()
    }
}

impl LocateEnv {
    pub fn set_var(&mut self, name: &str, value: impl Into<OsString>) {
        self.vars.insert(var_key(name), value.into());
    }

    fn set_var_if_missing(&mut self, name: &str, value: impl Into<OsString>) {
        self.vars
            .entry(var_key(name))
            .or_insert_with(|| value.into());
    }

    pub fn var(&self, name: &str) -> Option<&OsString> {
        self.vars.get(&var_key(name)).filter(|v| !v.is_empty())
    }

    /// An absolute directory from an environment variable.
    pub fn var_path(&self, name: &str) -> Option<PathBuf> {
        self.var(name)
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
    }

    /// Snapshot of the real environment. Blocking: reads the registry
    /// (Windows) or the cached login-shell `PATH` (macOS/Linux, up to 5 s the
    /// first time) and `~/.npmrc`.
    pub fn from_process(custom: Option<PathBuf>) -> Self {
        let mut env = LocateEnv {
            home: home_dir(),
            custom,
            process_path: std::env::var_os("PATH"),
            ..LocateEnv::default()
        };
        for (key, value) in std::env::vars_os() {
            if let Some(key) = key.to_str() {
                env.set_var(key, value);
            }
        }
        #[cfg(windows)]
        {
            // Variables defined after the app (or Explorer) started are only in the registry.
            let reg = super::win_env::read_registry_env();
            env.fresh_path = reg.path.map(OsString::from);
            for (key, value) in reg.vars {
                env.set_var_if_missing(&key, value);
            }
        }
        #[cfg(unix)]
        {
            env.fresh_path = super::shell_env::login_shell_path();
        }
        env.npmrc = env
            .home
            .as_deref()
            .and_then(|h| read_small(&h.join(".npmrc")));
        env
    }

    /// npm's global prefix from `~/.npmrc` (`prefix=`), absolute only.
    pub fn npm_prefix(&self) -> Option<PathBuf> {
        npmrc_prefix(self.npmrc.as_deref()?, self)
    }
}

fn read_small(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_NPMRC_BYTES {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

/// The last `prefix=` of an `.npmrc` (comments, quotes, `~` and `${VAR}` handled).
pub fn npmrc_prefix(npmrc: &str, env: &LocateEnv) -> Option<PathBuf> {
    let raw = npmrc
        .lines()
        .map(str::trim)
        .filter(|l| !l.starts_with('#') && !l.starts_with(';'))
        .filter_map(|l| {
            let (key, value) = l.split_once('=')?;
            (key.trim() == "prefix").then(|| value.trim())
        })
        .next_back()?;
    let unquoted = raw.trim_matches(|c| c == '"' || c == '\'');
    let expanded = expand_npm_vars(unquoted, env);
    let path = match (
        expanded
            .strip_prefix("~/")
            .or_else(|| expanded.strip_prefix("~\\")),
        &env.home,
    ) {
        (Some(rest), Some(home)) => home.join(rest),
        _ => PathBuf::from(expanded),
    };
    path.is_absolute().then_some(path)
}

/// `${NAME}` → the variable's value (unknown variables become empty, like npm).
fn expand_npm_vars(s: &str, env: &LocateEnv) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(start) = rest.find("${") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let Some(end) = after.find('}') else {
            out.push_str(&rest[start..]);
            return out;
        };
        if let Some(value) = env.var(&after[..end]) {
            out.push_str(&value.to_string_lossy());
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    out
}

// ---------------------------------------------------------------- locations

/// One path segment of a [`Pattern::Glob`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Seg {
    Lit(String),
    /// Any child whose name starts with `prefix` (ASCII case-insensitive);
    /// followed in descending semantic-version order of the rest of the name
    /// (a leading `v` is ignored), then descending name order.
    Any(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Pattern {
    /// An exact file.
    File(PathBuf),
    /// `<dir>/claude[.exe]`. On Windows an npm shim (`claude.cmd` …) in `dir`
    /// maps to the package's native binary `node_modules/@anthropic-ai/claude-code/bin/claude.exe`.
    Dir(PathBuf),
    /// `base` followed by literal / wildcard segments.
    Glob { base: PathBuf, segs: Vec<Seg> },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Location {
    pub source: InstallSource,
    pub pattern: Pattern,
}

impl Location {
    /// The location as shown in diagnostics (wildcards as `prefix*`).
    pub fn display(&self, os: Os) -> PathBuf {
        match &self.pattern {
            Pattern::File(p) => p.clone(),
            Pattern::Dir(d) => d.join(os.exe_name()),
            Pattern::Glob { base, segs } => segs.iter().fold(base.clone(), |p, s| match s {
                Seg::Lit(l) => p.join(l),
                Seg::Any(prefix) => p.join(format!("{prefix}*")),
            }),
        }
    }

    fn base(&self) -> &Path {
        match &self.pattern {
            Pattern::File(p) | Pattern::Dir(p) => p,
            Pattern::Glob { base, .. } => base,
        }
    }
}

struct Builder {
    os: Os,
    out: Vec<Location>,
    seen: HashSet<String>,
}

impl Builder {
    fn push(&mut self, source: InstallSource, pattern: Pattern) {
        let loc = Location { source, pattern };
        // Never resolve relative locations (cwd hijacking).
        if !loc.base().is_absolute() {
            return;
        }
        if self.seen.insert(path_key(&loc.display(self.os))) {
            self.out.push(loc);
        }
    }

    fn file(&mut self, source: InstallSource, path: PathBuf) {
        self.push(source, Pattern::File(path));
    }

    fn dir(&mut self, source: InstallSource, dir: PathBuf) {
        self.push(source, Pattern::Dir(dir));
    }

    fn glob(&mut self, source: InstallSource, base: PathBuf, segs: &[Seg]) {
        self.push(
            source,
            Pattern::Glob {
                base,
                segs: segs.to_vec(),
            },
        );
    }
}

fn lit(s: &str) -> Seg {
    Seg::Lit(s.to_owned())
}

fn any(prefix: &str) -> Seg {
    Seg::Any(prefix.to_owned())
}

/// `<prefix>/node_modules/@anthropic-ai/claude-code/bin` (npm package layout on Windows).
fn npm_package_bin(prefix: &Path) -> PathBuf {
    prefix
        .join("node_modules")
        .join("@anthropic-ai")
        .join("claude-code")
        .join("bin")
}

/// Every location to check, highest priority first (docs/NATIVE_API.md):
/// custom → process `PATH` → fresh `PATH` → native installer → package
/// managers → Claude desktop app bundle. Duplicates and relative locations are dropped.
pub fn locations(os: Os, env: &LocateEnv) -> Vec<Location> {
    let mut b = Builder {
        os,
        out: Vec::new(),
        seen: HashSet::new(),
    };
    if let Some(custom) = &env.custom {
        b.file(InstallSource::Custom, custom.clone());
    }
    for list in [&env.process_path, &env.fresh_path].into_iter().flatten() {
        for dir in std::env::split_paths(list) {
            b.dir(InstallSource::Path, dir);
        }
    }
    let exe = os.exe_name();
    if let Some(home) = &env.home {
        b.file(InstallSource::Local, native_bin_dir(home).join(exe));
        if os != Os::Windows {
            b.file(
                InstallSource::Local,
                home.join(".claude").join("local").join("claude"),
            );
        }
    }
    match os {
        Os::Windows => windows_packages(&mut b, env),
        Os::MacOs | Os::Linux => unix_packages(&mut b, env),
    }
    desktop_bundles(&mut b, env);
    b.out
}

fn windows_packages(b: &mut Builder, env: &LocateEnv) {
    use InstallSource::Package;
    let exe = Os::Windows.exe_name();
    let lad = env.var_path("LOCALAPPDATA");
    let home = env.home.clone();

    if let Some(lad) = &lad {
        let winget = lad.join("Microsoft").join("WinGet");
        b.file(Package, winget.join("Links").join(exe));
        let packages = winget.join("Packages");
        b.glob(
            Package,
            packages.clone(),
            &[any("Anthropic.ClaudeCode_"), lit(exe)],
        );
        b.glob(
            Package,
            packages,
            &[any("Anthropic.ClaudeCode_"), any(""), lit(exe)],
        );
    }
    if let Some(scoop) = env
        .var_path("SCOOP")
        .or_else(|| home.as_ref().map(|h| h.join("scoop")))
    {
        b.file(Package, scoop.join("shims").join(exe));
        b.file(
            Package,
            scoop
                .join("apps")
                .join("claude-code")
                .join("current")
                .join(exe),
        );
    }
    let choco = env.var_path("ChocolateyInstall").or_else(|| {
        env.var_path("ProgramData")
            .or_else(|| Some(PathBuf::from(r"C:\ProgramData")))
            .map(|p| p.join("chocolatey"))
    });
    if let Some(choco) = choco {
        b.file(Package, choco.join("bin").join(exe));
    }
    if let Some(appdata) = env.var_path("APPDATA") {
        b.file(Package, npm_package_bin(&appdata.join("npm")).join(exe));
    }
    if let Some(prefix) = env.npm_prefix() {
        b.file(Package, npm_package_bin(&prefix).join(exe));
    }
    if let Some(pnpm) = env
        .var_path("PNPM_HOME")
        .or_else(|| lad.as_ref().map(|l| l.join("pnpm")))
    {
        b.glob(
            Package,
            pnpm.join("global"),
            &[
                any(""),
                lit("node_modules"),
                lit("@anthropic-ai"),
                lit("claude-code"),
                lit("bin"),
                lit(exe),
            ],
        );
    }
    if let Some(lad) = &lad {
        b.file(Package, lad.join("Volta").join("bin").join(exe));
    }
    if let Some(home) = &home {
        b.file(Package, home.join(".volta").join("bin").join(exe));
    }
    if let Some(symlink) = env.var_path("NVM_SYMLINK") {
        b.file(Package, npm_package_bin(&symlink).join(exe));
    }
    if let Some(home) = &home {
        b.file(Package, home.join(".bun").join("bin").join(exe));
    }
}

fn unix_packages(b: &mut Builder, env: &LocateEnv) {
    use InstallSource::Package;
    let mac = b.os == Os::MacOs;
    let linux = b.os == Os::Linux;
    let home = env.home.clone();
    let in_home = |rel: &[&str]| {
        home.as_ref()
            .map(|h| rel.iter().fold(h.clone(), |p, s| p.join(s)))
    };

    if mac {
        b.dir(Package, PathBuf::from("/opt/homebrew/bin"));
    }
    b.dir(Package, PathBuf::from("/usr/local/bin"));
    if linux {
        b.dir(Package, PathBuf::from("/home/linuxbrew/.linuxbrew/bin"));
        if let Some(d) = in_home(&[".linuxbrew", "bin"]) {
            b.dir(Package, d);
        }
    }
    b.dir(Package, PathBuf::from("/usr/bin"));
    if linux {
        b.dir(Package, PathBuf::from("/snap/bin"));
    }
    if let Some(d) = in_home(&[".npm-global", "bin"]) {
        b.dir(Package, d);
    }
    if let Some(prefix) = env.npm_prefix() {
        b.dir(Package, prefix.join("bin"));
    }
    for rel in [[".volta", "bin"], [".bun", "bin"]] {
        if let Some(d) = in_home(&rel) {
            b.dir(Package, d);
        }
    }
    if let Some(nvm) = in_home(&[".nvm", "versions", "node"]) {
        b.glob(Package, nvm, &[any("v"), lit("bin"), lit("claude")]);
    }
    if let Some(pnpm) = env.var_path("PNPM_HOME") {
        b.dir(Package, pnpm);
    }
    if mac {
        if let Some(d) = in_home(&["Library", "pnpm"]) {
            b.dir(Package, d);
        }
    }
    if let Some(d) = in_home(&[".local", "share", "pnpm"]) {
        b.dir(Package, d);
    }
}

fn desktop_bundles(b: &mut Builder, env: &LocateEnv) {
    use InstallSource::Desktop;
    let exe = b.os.exe_name();
    match b.os {
        Os::Windows => {
            if let Some(appdata) = env.var_path("APPDATA") {
                b.glob(
                    Desktop,
                    appdata.join("Claude").join("claude-code"),
                    &[any(""), lit(exe)],
                );
            }
            // MSIX (Microsoft Store) package: AppData is redirected into the package.
            if let Some(lad) = env.var_path("LOCALAPPDATA") {
                b.glob(
                    Desktop,
                    lad.join("Packages"),
                    &[
                        any("Claude_"),
                        lit("LocalCache"),
                        lit("Roaming"),
                        lit("Claude"),
                        lit("claude-code"),
                        any(""),
                        lit(exe),
                    ],
                );
            }
        }
        Os::MacOs => {
            // UNCONFIRMED layout (mirrors the Windows bundle).
            if let Some(home) = &env.home {
                b.glob(
                    Desktop,
                    home.join("Library")
                        .join("Application Support")
                        .join("Claude")
                        .join("claude-code"),
                    &[any(""), lit(exe)],
                );
            }
        }
        Os::Linux => {}
    }
}

// ---------------------------------------------------------------- resolution

/// An existing file that may be Claude Code (not validated yet).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    /// Path to run: the canonical path on Windows, the path as found (e.g. a
    /// launcher symlink that survives updates) on macOS/Linux.
    pub exe: PathBuf,
    pub source: InstallSource,
}

/// One checked location, in priority order: an existing candidate or a miss.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finding {
    pub source: InstallSource,
    /// The candidate's path, or the location that was checked (wildcards as `*`).
    pub path: PathBuf,
    pub candidate: Option<Candidate>,
}

/// Resolves [`locations`] to existing files: ordered, deduplicated by
/// canonical path, at most [`MAX_CANDIDATES`] candidates.
pub fn discover(os: Os, env: &LocateEnv) -> Vec<Finding> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let mut found = 0usize;
    for loc in locations(os, env) {
        if found >= MAX_CANDIDATES {
            break;
        }
        let files = resolve(os, &loc.pattern);
        if files.is_empty() {
            out.push(Finding {
                source: loc.source,
                path: loc.display(os),
                candidate: None,
            });
            continue;
        }
        for file in files {
            let Ok(canonical) = std::fs::canonicalize(&file) else {
                continue;
            };
            if !seen.insert(path_key(&canonical)) {
                continue; // the same binary reached through another location
            }
            let exe = if os == Os::Windows { canonical } else { file };
            out.push(Finding {
                source: loc.source,
                path: exe.clone(),
                candidate: Some(Candidate {
                    exe,
                    source: loc.source,
                }),
            });
            found += 1;
            if found >= MAX_CANDIDATES {
                break;
            }
        }
    }
    out
}

fn resolve(os: Os, pattern: &Pattern) -> Vec<PathBuf> {
    match pattern {
        Pattern::File(p) => {
            if p.is_file() {
                vec![p.clone()]
            } else {
                Vec::new()
            }
        }
        Pattern::Dir(dir) => {
            let exe = dir.join(os.exe_name());
            if exe.is_file() {
                return vec![exe];
            }
            let npm_shim = ["claude.cmd", "claude.ps1", "claude"]
                .iter()
                .any(|n| dir.join(n).is_file());
            if os == Os::Windows && npm_shim {
                // npm global install: use the package's native binary, not the shim.
                let native = npm_package_bin(dir).join(os.exe_name());
                if native.is_file() {
                    return vec![native];
                }
            }
            Vec::new()
        }
        Pattern::Glob { base, segs } => {
            let mut out = Vec::new();
            expand(base, segs, &mut out);
            out
        }
    }
}

fn expand(dir: &Path, segs: &[Seg], out: &mut Vec<PathBuf>) {
    let Some((first, rest)) = segs.split_first() else {
        return;
    };
    let next: Vec<PathBuf> = match first {
        Seg::Lit(name) => vec![dir.join(name)],
        Seg::Any(prefix) => matching_children(dir, prefix),
    };
    for path in next {
        if out.len() >= MAX_MATCHES_PER_LOCATION {
            return;
        }
        if rest.is_empty() {
            if path.is_file() {
                out.push(path);
            }
        } else if path.is_dir() {
            expand(&path, rest, out);
        }
    }
}

/// Children of `dir` whose name starts with `prefix`, highest version first.
fn matching_children(dir: &Path, prefix: &str) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut matches: Vec<(Option<semver::Version>, String, PathBuf)> = entries
        .take(MAX_DIR_ENTRIES)
        .filter_map(Result::ok)
        .filter_map(|e| {
            let name = e.file_name().to_str()?.to_owned();
            let head = name.get(..prefix.len())?;
            if !head.eq_ignore_ascii_case(prefix) {
                return None;
            }
            let rest = &name[prefix.len()..];
            let version = semver::Version::parse(rest.strip_prefix('v').unwrap_or(rest)).ok();
            Some((version, name, e.path()))
        })
        .collect();
    // Versions (descending) before other names (descending).
    matches.sort_by(|a, b| match (&a.0, &b.0) {
        (Some(x), Some(y)) => y.cmp(x),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => b.1.cmp(&a.1),
    });
    matches
        .into_iter()
        .take(MAX_WILDCARD_CHILDREN)
        .map(|(_, _, p)| p)
        .collect()
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

    fn found(findings: &[Finding]) -> Vec<(InstallSource, PathBuf)> {
        findings
            .iter()
            .filter_map(|f| f.candidate.as_ref())
            .map(|c| (c.source, c.exe.clone()))
            .collect()
    }

    /// Canonical form as `discover` reports it for `os`.
    fn exe_of(os: Os, p: &Path) -> PathBuf {
        if os == Os::Windows {
            std::fs::canonicalize(p).expect("canonical")
        } else {
            p.to_path_buf()
        }
    }

    fn first_found(os: Os, env: &LocateEnv) -> Option<(InstallSource, PathBuf)> {
        found(&discover(os, env)).into_iter().next()
    }

    struct Fixture {
        _tmp: tempfile::TempDir,
        root: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let tmp = tempfile::tempdir().expect("tempdir");
            let root = tmp.path().to_path_buf();
            Fixture { _tmp: tmp, root }
        }

        fn p(&self, rel: &str) -> PathBuf {
            rel.split('/').fold(self.root.clone(), |p, s| p.join(s))
        }

        /// A Windows-style environment rooted in the temp dir.
        fn windows_env(&self) -> LocateEnv {
            let mut env = LocateEnv {
                home: Some(self.p("home")),
                ..LocateEnv::default()
            };
            env.set_var("LOCALAPPDATA", self.p("home/AppData/Local"));
            env.set_var("APPDATA", self.p("home/AppData/Roaming"));
            env.set_var("ProgramData", self.p("ProgramData"));
            env
        }

        fn unix_env(&self) -> LocateEnv {
            LocateEnv {
                home: Some(self.p("home")),
                ..LocateEnv::default()
            }
        }
    }

    #[test]
    fn windows_package_families() {
        let cases: &[(&str, Option<(&str, &str)>)] = &[
            ("home/AppData/Local/Microsoft/WinGet/Links/claude.exe", None),
            (
                "home/AppData/Local/Microsoft/WinGet/Packages/Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe/claude.exe",
                None,
            ),
            (
                "home/AppData/Local/Microsoft/WinGet/Packages/Anthropic.ClaudeCode_x/sub/claude.exe",
                None,
            ),
            ("home/scoop/shims/claude.exe", None),
            ("custom-scoop/apps/claude-code/current/claude.exe", Some(("SCOOP", "custom-scoop"))),
            ("ProgramData/chocolatey/bin/claude.exe", None),
            ("choco/bin/claude.exe", Some(("ChocolateyInstall", "choco"))),
            (
                "home/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe",
                None,
            ),
            (
                "home/AppData/Local/pnpm/global/5/node_modules/@anthropic-ai/claude-code/bin/claude.exe",
                None,
            ),
            (
                "pnpm-home/global/5/node_modules/@anthropic-ai/claude-code/bin/claude.exe",
                Some(("PNPM_HOME", "pnpm-home")),
            ),
            ("home/AppData/Local/Volta/bin/claude.exe", None),
            ("home/.volta/bin/claude.exe", None),
            (
                "nodejs/node_modules/@anthropic-ai/claude-code/bin/claude.exe",
                Some(("NVM_SYMLINK", "nodejs")),
            ),
            ("home/.bun/bin/claude.exe", None),
        ];
        for (rel, var) in cases {
            let fx = Fixture::new();
            let mut env = fx.windows_env();
            if let Some((name, value)) = var {
                env.set_var(name, fx.p(value));
            }
            assert_eq!(first_found(Os::Windows, &env), None, "{rel}: empty");
            touch(&fx.p(rel));
            assert_eq!(
                first_found(Os::Windows, &env),
                Some((InstallSource::Package, exe_of(Os::Windows, &fx.p(rel)))),
                "{rel}"
            );
        }
    }

    #[test]
    fn npmrc_prefix_family() {
        let fx = Fixture::new();
        let mut env = fx.windows_env();
        env.set_var("NPM_ROOT", fx.p("tools"));
        env.npmrc = Some("; comment\nprefix=${NPM_ROOT}/npm-global\n".to_owned());
        let exe = fx.p("tools/npm-global/node_modules/@anthropic-ai/claude-code/bin/claude.exe");
        touch(&exe);
        assert_eq!(
            first_found(Os::Windows, &env),
            Some((InstallSource::Package, exe_of(Os::Windows, &exe)))
        );

        let mut unix = fx.unix_env();
        unix.npmrc = Some("prefix = \"~/.npm-packages\"\n".to_owned());
        let bin = fx.p("home/.npm-packages/bin/claude");
        touch(&bin);
        assert_eq!(
            first_found(Os::Linux, &unix),
            Some((InstallSource::Package, bin))
        );
    }

    #[test]
    fn npmrc_parsing() {
        let mut env = LocateEnv::default();
        env.set_var("X", if cfg!(windows) { r"C:\x" } else { "/x" });
        let abs = if cfg!(windows) { r"C:\x\p" } else { "/x/p" };
        assert_eq!(
            npmrc_prefix("prefix=${X}/p", &env).map(|p| p.components().count()),
            Some(PathBuf::from(abs).components().count())
        );
        assert_eq!(npmrc_prefix("# prefix=/nope\n", &env), None);
        assert_eq!(npmrc_prefix("prefix=relative/dir", &env), None);
        assert_eq!(npmrc_prefix("registry=https://x", &env), None);
        // last one wins
        let two = format!("prefix={abs}\nprefix=${{X}}/q");
        assert!(npmrc_prefix(&two, &env).expect("prefix").ends_with("q"));
    }

    #[test]
    fn unix_home_families() {
        type Case = (
            Os,
            &'static str,
            InstallSource,
            Option<(&'static str, &'static str)>,
        );
        let cases: &[Case] = &[
            (
                Os::Linux,
                "home/.local/bin/claude",
                InstallSource::Local,
                None,
            ),
            (
                Os::MacOs,
                "home/.claude/local/claude",
                InstallSource::Local,
                None,
            ),
            (
                Os::Linux,
                "home/.linuxbrew/bin/claude",
                InstallSource::Package,
                None,
            ),
            (
                Os::Linux,
                "home/.npm-global/bin/claude",
                InstallSource::Package,
                None,
            ),
            (
                Os::MacOs,
                "home/.volta/bin/claude",
                InstallSource::Package,
                None,
            ),
            (
                Os::Linux,
                "home/.bun/bin/claude",
                InstallSource::Package,
                None,
            ),
            (
                Os::Linux,
                "home/.nvm/versions/node/v20.11.1/bin/claude",
                InstallSource::Package,
                None,
            ),
            (
                Os::Linux,
                "pnpm/claude",
                InstallSource::Package,
                Some(("PNPM_HOME", "pnpm")),
            ),
            (
                Os::MacOs,
                "home/Library/pnpm/claude",
                InstallSource::Package,
                None,
            ),
            (
                Os::Linux,
                "home/.local/share/pnpm/claude",
                InstallSource::Package,
                None,
            ),
            (
                Os::MacOs,
                "home/Library/Application Support/Claude/claude-code/2.1.284/claude",
                InstallSource::Desktop,
                None,
            ),
        ];
        for (os, rel, source, var) in cases {
            let fx = Fixture::new();
            let mut env = fx.unix_env();
            if let Some((name, value)) = var {
                env.set_var(name, fx.p(value));
            }
            assert_eq!(first_found(*os, &env), None, "{rel}: empty");
            touch(&fx.p(rel));
            assert_eq!(first_found(*os, &env), Some((*source, fx.p(rel))), "{rel}");
        }
    }

    #[test]
    fn unix_system_dirs_per_os() {
        let dirs = |os: Os| -> Vec<PathBuf> {
            locations(os, &LocateEnv::default())
                .into_iter()
                .filter_map(|l| match l.pattern {
                    Pattern::Dir(d) => Some(d),
                    _ => None,
                })
                .collect()
        };
        if cfg!(windows) {
            // "/usr/bin" is not absolute on Windows: never resolved here.
            assert!(dirs(Os::Linux).is_empty());
            return;
        }
        let mac = dirs(Os::MacOs);
        assert_eq!(mac.first(), Some(&PathBuf::from("/opt/homebrew/bin")));
        assert!(mac.contains(&PathBuf::from("/usr/local/bin")));
        assert!(!mac.contains(&PathBuf::from("/snap/bin")));
        let linux = dirs(Os::Linux);
        for d in [
            "/usr/local/bin",
            "/home/linuxbrew/.linuxbrew/bin",
            "/usr/bin",
            "/snap/bin",
        ] {
            assert!(linux.contains(&PathBuf::from(d)), "{d}");
        }
        assert!(!linux.contains(&PathBuf::from("/opt/homebrew/bin")));
    }

    #[test]
    fn desktop_bundles_pick_highest_semver() {
        let fx = Fixture::new();
        let env = fx.windows_env();
        let base = fx.p("home/AppData/Roaming/Claude/claude-code");
        touch(&base.join("2.1.281").join("claude.exe"));
        touch(&base.join("2.1.284").join("claude.exe"));
        touch(&base.join("2.1.9").join("claude.exe"));
        touch(&base.join("10.0.0-beta").join("readme.txt")); // no binary
        std::fs::create_dir_all(base.join("not-a-version")).expect("mkdir");
        let all = found(&discover(Os::Windows, &env));
        let versions: Vec<String> = all
            .iter()
            .map(|(s, p)| {
                assert_eq!(*s, InstallSource::Desktop);
                p.parent()
                    .and_then(Path::file_name)
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default()
            })
            .collect();
        assert_eq!(versions, ["2.1.284", "2.1.281", "2.1.9"]);
    }

    #[test]
    fn msix_desktop_bundle() {
        let fx = Fixture::new();
        let env = fx.windows_env();
        let exe = fx.p(
            "home/AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/Claude/claude-code/2.1.284/claude.exe",
        );
        touch(&exe);
        touch(&fx.p("home/AppData/Local/Packages/Other_x/LocalCache/Roaming/Claude/claude-code/9.9.9/claude.exe"));
        assert_eq!(
            found(&discover(Os::Windows, &env)),
            vec![(InstallSource::Desktop, exe_of(Os::Windows, &exe))]
        );
    }

    #[test]
    fn order_and_dedup() {
        let fx = Fixture::new();
        let mut env = fx.windows_env();
        let bin = fx.p("bin");
        let fresh = fx.p("fresh");
        env.process_path = Some(std::env::join_paths([&bin, &bin]).expect("join"));
        env.fresh_path = Some(std::env::join_paths([&bin, &fresh]).expect("join"));
        let custom = fx.p("custom/claude.exe");
        env.custom = Some(custom.clone());

        let desktop = fx.p("home/AppData/Roaming/Claude/claude-code/2.1.284/claude.exe");
        let package = fx.p("home/.bun/bin/claude.exe");
        let local = fx.p("home/.local/bin/claude.exe");
        let fresh_exe = fresh.join("claude.exe");
        let path_exe = bin.join("claude.exe");
        for p in [&desktop, &package, &local, &fresh_exe, &path_exe, &custom] {
            touch(p);
        }
        let all = found(&discover(Os::Windows, &env));
        let w = |p: &Path| exe_of(Os::Windows, p);
        assert_eq!(
            all,
            vec![
                (InstallSource::Custom, w(&custom)),
                (InstallSource::Path, w(&path_exe)),
                (InstallSource::Path, w(&fresh_exe)),
                (InstallSource::Local, w(&local)),
                (InstallSource::Package, w(&package)),
                (InstallSource::Desktop, w(&desktop)),
            ]
        );

        // The same binary reached twice (custom == PATH entry) is listed once, first source wins.
        env.custom = Some(path_exe.clone());
        let all = found(&discover(Os::Windows, &env));
        assert_eq!(all.first(), Some(&(InstallSource::Custom, w(&path_exe))));
        assert_eq!(all.iter().filter(|(_, p)| *p == w(&path_exe)).count(), 1);

        // A directory on both PATHs (and twice on one) is checked once.
        std::fs::remove_file(&path_exe).expect("rm");
        let findings = discover(
            Os::Windows,
            &LocateEnv {
                process_path: env.process_path.clone(),
                fresh_path: Some(std::env::join_paths([&bin]).expect("join")),
                ..LocateEnv::default()
            },
        );
        let path_entries: Vec<&Finding> = findings
            .iter()
            .filter(|f| f.source == InstallSource::Path)
            .collect();
        assert_eq!(path_entries.len(), 1);
        assert_eq!(path_entries[0].path, bin.join("claude.exe"));
        assert_eq!(path_entries[0].candidate, None);
    }

    #[test]
    fn relative_entries_are_ignored() {
        let fx = Fixture::new();
        touch(&fx.p("rel/claude.exe"));
        let env = LocateEnv {
            process_path: Some(OsString::from("rel")),
            custom: Some(PathBuf::from("rel/claude.exe")),
            home: Some(PathBuf::from("relhome")),
            ..LocateEnv::default()
        };
        assert!(found(&discover(Os::Windows, &env)).is_empty());
        assert!(discover(Os::Windows, &env)
            .iter()
            .all(|f| f.path.is_absolute()));
        assert!(locations(Os::Linux, &env)
            .iter()
            .all(|l| l.base().is_absolute()));
    }

    #[test]
    fn cmd_shims_are_never_used() {
        let fx = Fixture::new();
        let npm = fx.p("npm");
        touch(&npm.join("claude.cmd"));
        touch(&npm.join("claude.ps1"));
        let env = LocateEnv {
            process_path: Some(std::env::join_paths([&npm]).expect("join")),
            ..LocateEnv::default()
        };
        assert!(found(&discover(Os::Windows, &env)).is_empty());
        let native = npm.join("node_modules/@anthropic-ai/claude-code/bin/claude.exe");
        touch(&native);
        assert_eq!(
            found(&discover(Os::Windows, &env)),
            vec![(InstallSource::Path, exe_of(Os::Windows, &native))]
        );
        // On macOS/Linux the npm `bin` entry itself is the launcher; no shim mapping.
        assert!(found(&discover(Os::Linux, &env)).is_empty());
    }

    #[test]
    fn candidates_are_capped() {
        let fx = Fixture::new();
        let dirs: Vec<PathBuf> = (0..MAX_CANDIDATES + 5)
            .map(|i| fx.p(&format!("d{i}")))
            .collect();
        for d in &dirs {
            touch(&d.join("claude.exe"));
        }
        let env = LocateEnv {
            process_path: Some(std::env::join_paths(&dirs).expect("join")),
            ..LocateEnv::default()
        };
        assert_eq!(found(&discover(Os::Windows, &env)).len(), MAX_CANDIDATES);
    }

    #[test]
    fn display_marks_wildcards() {
        let loc = Location {
            source: InstallSource::Desktop,
            pattern: Pattern::Glob {
                base: PathBuf::from("base"),
                segs: vec![any("Claude_"), lit("x"), any(""), lit("claude.exe")],
            },
        };
        assert_eq!(
            loc.display(Os::Windows),
            PathBuf::from("base")
                .join("Claude_*")
                .join("x")
                .join("*")
                .join("claude.exe")
        );
    }

    #[test]
    fn source_serializes_lowercase() {
        for (s, want) in [
            (InstallSource::Custom, "\"custom\""),
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

        assert_eq!(
            parse_claude_version("2.1.284 (Claude Code)\n").as_deref(),
            Some("2.1.284")
        );
        assert_eq!(
            parse_claude_version("2.2.0-beta.1 (claude code) extra").as_deref(),
            Some("2.2.0-beta.1")
        );
        assert_eq!(parse_claude_version("2.1.284\n"), None); // no "Claude Code"
        assert_eq!(parse_claude_version("v2.1 (Claude Code)"), None);
        assert_eq!(parse_claude_version("Claude Code 2.1.284"), None);
        assert_eq!(parse_claude_version("10.2.4 (npm)"), None);
    }

    #[test]
    fn executables_only() {
        let fx = Fixture::new();
        for name in ["claude.cmd", "claude.bat", "claude.ps1"] {
            let p = fx.p(name);
            touch(&p);
            assert!(!is_executable(&p), "{name}");
        }
        assert!(!is_executable(&fx.p("missing.exe")));
        assert!(!is_executable(&fx.root));
        let exe = fx.p("claude.exe");
        touch(&exe);
        if cfg!(windows) {
            assert!(is_executable(&exe));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let bin = fx.p("claude");
            touch(&bin);
            assert!(!is_executable(&bin));
            std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).expect("chmod");
            assert!(is_executable(&bin));
        }
    }
}
