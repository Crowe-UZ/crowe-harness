//! Managed application state shared by the IPC commands.

use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use crate::claude::history::HistoryCache;
use crate::claude::locate::home_dir;
use crate::claude::turn::TurnRegistry;
use crate::error::NativeResult;
use crate::guard::ConfigGuard;
use crate::installer::InstallRegistry;
use crate::projects::{self, CwdCache, OpenedRegistry, ResolvedProject};

/// Claude Code directories reported by `claude auth status`.
#[derive(Debug, Clone, Default)]
pub struct ClaudeDirs {
    pub config_dir: Option<PathBuf>,
    pub projects_dir: Option<PathBuf>,
}

pub struct Inner {
    dirs: RwLock<ClaudeDirs>,
    pub history: HistoryCache,
    pub cwd_cache: CwdCache,
    pub registry: OpenedRegistry,
    pub turns: Arc<TurnRegistry>,
    pub installs: Arc<InstallRegistry>,
}

#[derive(Clone)]
pub struct AppState(pub Arc<Inner>);

impl AppState {
    pub fn new(registry_file: Option<PathBuf>) -> Self {
        AppState(Arc::new(Inner {
            dirs: RwLock::new(ClaudeDirs::default()),
            history: HistoryCache::default(),
            cwd_cache: CwdCache::default(),
            registry: OpenedRegistry::new(registry_file),
            turns: Arc::new(TurnRegistry::default()),
            installs: Arc::new(InstallRegistry::default()),
        }))
    }
}

impl Inner {
    pub fn set_dirs(&self, dirs: ClaudeDirs) {
        if let Ok(mut d) = self.dirs.write() {
            *d = dirs;
        }
    }

    /// Config dir: CLI-reported → `CLAUDE_CONFIG_DIR` → `~/.claude`.
    pub fn config_dir(&self) -> Option<PathBuf> {
        let reported = self.dirs.read().ok().and_then(|d| d.config_dir.clone());
        reported
            .or_else(|| {
                std::env::var_os("CLAUDE_CONFIG_DIR")
                    .filter(|v| !v.is_empty())
                    .map(PathBuf::from)
            })
            .or_else(|| home_dir().map(|h| h.join(".claude")))
    }

    /// Guard over the config dir; `None` when it does not exist (fresh install).
    pub fn guard(&self) -> Option<ConfigGuard> {
        let config = self.config_dir()?;
        let projects = self.dirs.read().ok().and_then(|d| d.projects_dir.clone());
        ConfigGuard::new(&config, projects.as_deref()).ok()
    }

    pub fn resolve(&self, project_id: &str) -> NativeResult<ResolvedProject> {
        let guard = self.guard();
        projects::resolve(
            guard.as_ref(),
            &self.history,
            &self.cwd_cache,
            &self.registry,
            project_id,
        )
    }
}
