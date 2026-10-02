//! IPC commands (docs/NATIVE_API.md). The webview sends ids only; paths and
//! executables are resolved here. Every command is listed in `build.rs`
//! (`APP_COMMANDS`) and granted in `capabilities/default.json`.

use std::path::PathBuf;
use std::time::Duration;

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

use crate::claude::auth::{parse_auth_status, ClaudeInstall, ClaudeStatus};
use crate::claude::cli;
use crate::claude::finder::{LocateReport, Located};
use crate::claude::history::{self, SessionInfo, SubagentTranscript, Transcript};
use crate::claude::locate;
use crate::claude::mcp::{parse_mcp_list, McpServerInfo};
use crate::claude::stream::TurnEvent;
use crate::claude::turn::{self, PermissionMode, TurnSpec};
use crate::config::{self, AgentInfo, SkillInfo};
use crate::error::{join_blocking, NativeError, NativeResult};
use crate::fs::{self as wfs, DirEntry, FileContent};
use crate::installer::{self, Cancel, InstallChannel, InstallDirs, InstallEvent, InstallPlan};
use crate::projects::{self, ProjectInfo};
use crate::state::{AppState, ClaudeDirs, Inner};
use crate::util::display_path;

const STATUS_TIMEOUT: Duration = Duration::from_secs(20);
const MCP_TIMEOUT: Duration = Duration::from_secs(30);

/// The `claude` to run (cached; discovered when nothing usable is cached).
async fn locate_claude(inner: &Inner) -> NativeResult<Located> {
    inner
        .claude
        .find(false)
        .await?
        .ok_or_else(NativeError::claude_not_found)
}

// ---------------------------------------------------------------- Claude Code install / sign-in

/// `ClaudeStatus` for a located install (`None` = not found).
async fn status_for(inner: &Inner, loc: Option<Located>) -> NativeResult<ClaudeStatus> {
    let Some(loc) = loc else {
        return Ok(ClaudeStatus {
            install: None,
            logged_in: false,
            auth_method: None,
            subscription: false,
            subscription_type: None,
            email: None,
            org_name: None,
        });
    };
    let (version_out, auth_out) = tokio::join!(
        cli::run(&loc.exe, &["--version"], STATUS_TIMEOUT),
        cli::run(&loc.exe, &["auth", "status", "--json"], STATUS_TIMEOUT),
    );
    // Fresh version (Claude Code updates itself); the validated one as fallback.
    let mut install = loc.install();
    if let Some(v) = version_out
        .ok()
        .and_then(|o| locate::parse_version(&o.stdout))
    {
        install.version = Some(v);
    }
    let auth_out = auth_out?;
    let auth = parse_auth_status(&auth_out.stdout).ok_or_else(|| {
        NativeError::new(
            "cli_failed",
            format!(
                "could not read the sign-in status from Claude Code: {}",
                cli::tail(&auth_out.stderr, 300)
            ),
        )
    })?;
    inner.set_dirs(ClaudeDirs {
        config_dir: auth.config_dir.clone(),
        projects_dir: auth.projects_dir.clone(),
    });
    Ok(ClaudeStatus {
        install: Some(install),
        logged_in: auth.logged_in,
        auth_method: auth.auth_method,
        subscription: auth.subscription,
        subscription_type: auth.subscription_type,
        email: auth.email,
        org_name: auth.org_name,
    })
}

/// `forceRefresh: true` ("Check again") re-discovers Claude Code instead of
/// using the cached location.
#[tauri::command]
pub async fn claude_status(
    state: State<'_, AppState>,
    force_refresh: Option<bool>,
) -> NativeResult<ClaudeStatus> {
    let inner = state.0.clone();
    let loc = inner.claude.find(force_refresh.unwrap_or(false)).await?;
    status_for(&inner, loc).await
}

/// Native file picker (Rust side: the webview never supplies the path) to
/// choose the Claude Code executable by hand. `null` when the user cancels;
/// rejects with `invalid_executable` when the file is not a working Claude Code.
#[tauri::command]
pub async fn claude_pick_executable(
    app: AppHandle,
    state: State<'_, AppState>,
) -> NativeResult<Option<ClaudeStatus>> {
    use tauri_plugin_dialog::DialogExt;
    let inner = state.0.clone();
    let picked = join_blocking(move || {
        let mut dialog = app.dialog().file().set_title("Locate Claude Code");
        if cfg!(windows) {
            dialog = dialog.add_filter("Claude Code (claude.exe)", &["exe"]);
        }
        if let Some(dir) = locate::home_dir() {
            dialog = dialog.set_directory(dir);
        }
        let Some(file) = dialog.blocking_pick_file() else {
            return Ok(None);
        };
        file.into_path()
            .map(Some)
            .map_err(|_| NativeError::new("invalid_executable", "Unsupported file location."))
    })
    .await?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let loc = inner.claude.set_override(&picked).await?;
    status_for(&inner, Some(loc)).await.map(Some)
}

/// Forgets the manual location and detects Claude Code automatically again.
#[tauri::command]
pub async fn claude_clear_executable(state: State<'_, AppState>) -> NativeResult<ClaudeStatus> {
    let inner = state.0.clone();
    let loc = inner.claude.clear_override().await?;
    status_for(&inner, loc).await
}

/// Diagnostics: every location checked and why candidates were rejected.
#[tauri::command]
pub async fn claude_locate_report(state: State<'_, AppState>) -> NativeResult<LocateReport> {
    state.0.claude.report().await
}

/// Opens a visible console running `claude auth login --claudeai` (the
/// browser OAuth flow is driven by Claude Code itself). Returns immediately;
/// the UI polls `claude_status`.
#[tauri::command]
pub async fn claude_auth_login(state: State<'_, AppState>) -> NativeResult<()> {
    let loc = locate_claude(&state.0).await?;
    let mut cmd = std::process::Command::new(&loc.exe);
    cmd.args(["auth", "login", "--claudeai"])
        .current_dir(locate::home_dir().unwrap_or_else(std::env::temp_dir));
    for key in cli::SCRUBBED_ENV {
        cmd.env_remove(key);
    }
    if let Some(path) = cli::child_path(&loc.exe) {
        cmd.env("PATH", path);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(cli::CREATE_NEW_CONSOLE);
    }
    // Detached on purpose: the console window belongs to the user.
    cmd.spawn()
        .map(drop)
        .map_err(|e| NativeError::new("spawn_failed", format!("could not start Claude Code: {e}")))
}

#[tauri::command]
pub async fn claude_auth_logout(state: State<'_, AppState>) -> NativeResult<()> {
    let loc = locate_claude(&state.0).await?;
    let out = cli::run(&loc.exe, &["auth", "logout"], STATUS_TIMEOUT).await?;
    if out.code == Some(0) {
        Ok(())
    } else {
        Err(NativeError::new(
            "cli_failed",
            format!(
                "sign out failed: {}",
                cli::tail(&format!("{}\n{}", out.stdout, out.stderr), 300)
            ),
        ))
    }
}

// ---------------------------------------------------------------- Claude Code installer

/// Current install (if any) with its version, for `InstallPlan.alreadyInstalled`.
async fn current_install(inner: &Inner) -> Option<ClaudeInstall> {
    inner
        .claude
        .find(false)
        .await
        .ok()
        .flatten()
        .map(|loc| loc.install())
}

fn home_or_err() -> NativeResult<PathBuf> {
    locate::home_dir()
        .filter(|h| h.is_absolute())
        .ok_or_else(|| NativeError::internal("the home directory is unknown"))
}

/// Resolves the channel and verifies the signed manifest (no binary download).
#[tauri::command]
pub async fn claude_install_plan(
    state: State<'_, AppState>,
    channel: InstallChannel,
) -> NativeResult<InstallPlan> {
    let home = home_or_err()?;
    let cancel = Cancel::never();
    let (release, already_installed) = tokio::join!(
        installer::plan_release(channel, &cancel),
        current_install(&state.0)
    );
    let release = release?;
    Ok(InstallPlan {
        version: release.version,
        channel,
        platform: release.platform.to_owned(),
        size_bytes: release.entry.size,
        source_host: installer::release::HOST,
        install_dir: display_path(&locate::native_bin_dir(&home)),
        auto_updates: true,
        already_installed,
    })
}

/// Starts the install; events (exactly one terminal event last) flow through
/// `on_event`. Rejects with `busy` while another install runs.
#[tauri::command]
pub async fn claude_install_start(
    app: AppHandle,
    state: State<'_, AppState>,
    channel: InstallChannel,
    on_event: Channel<InstallEvent>,
) -> NativeResult<String> {
    let home = home_or_err()?;
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|_| NativeError::internal("the app cache directory is unavailable"))?
        .join("installer");
    let registry = state.0.installs.clone();
    let finder = state.0.claude.clone();
    let (install_id, cancel) = registry.begin()?;
    let dirs = InstallDirs { cache_dir, home };
    let id = install_id.clone();
    tauri::async_runtime::spawn(async move {
        let events = on_event.clone();
        // Inner task: a panic becomes an `error` event instead of a stuck slot.
        let work = tauri::async_runtime::spawn(async move {
            let emit = move |ev: InstallEvent| {
                let _ = events.send(ev); // the webview may be gone; keep going
            };
            installer::install(channel, &dirs, &cancel, &emit).await
        });
        let result = work
            .await
            .unwrap_or_else(|_| Err(NativeError::internal("the installer task failed")));
        registry.finish(&id);
        if result.is_ok() {
            finder.invalidate(); // the next check finds the fresh native install
        }
        let _ = on_event.send(InstallEvent::terminal(result));
    });
    Ok(install_id)
}

#[tauri::command]
pub fn claude_install_cancel(state: State<'_, AppState>, install_id: String) -> NativeResult<()> {
    if !crate::util::is_uuid(&install_id) {
        return Err(NativeError::invalid("invalid install id"));
    }
    // Unknown/finished installs are a no-op.
    state.0.installs.cancel(&install_id);
    Ok(())
}

// ---------------------------------------------------------------- projects and history

#[tauri::command]
pub async fn projects_list(state: State<'_, AppState>) -> NativeResult<Vec<ProjectInfo>> {
    let inner = state.0.clone();
    join_blocking(move || {
        let history = inner
            .guard()
            .map(|g| projects::scan_history(&g, &inner.history, &inner.cwd_cache))
            .unwrap_or_default();
        Ok(projects::merge_projects(&history, &inner.registry.load()))
    })
    .await
}

#[tauri::command]
pub async fn projects_open_folder(
    app: AppHandle,
    state: State<'_, AppState>,
) -> NativeResult<Option<ProjectInfo>> {
    use tauri_plugin_dialog::DialogExt;
    let inner = state.0.clone();
    join_blocking(move || {
        let picked = app
            .dialog()
            .file()
            .set_title("Open project folder")
            .blocking_pick_folder();
        let Some(picked) = picked else {
            return Ok(None);
        };
        let path: PathBuf = picked
            .into_path()
            .map_err(|_| NativeError::invalid("unsupported folder location"))?;
        let canonical = projects::validate_opened_folder(&path)?;
        inner.registry.add(&canonical)?;
        let history = inner
            .guard()
            .map(|g| projects::scan_history(&g, &inner.history, &inner.cwd_cache))
            .unwrap_or_default();
        let merged = projects::merge_projects(&history, &inner.registry.load());
        let key = crate::util::path_key(&canonical);
        Ok(merged.into_iter().find(|p| {
            p.path
                .as_deref()
                .map(|s| crate::util::path_key(std::path::Path::new(s)))
                == Some(key.clone())
        }))
    })
    .await
}

#[tauri::command]
pub async fn sessions_list(
    state: State<'_, AppState>,
    project_id: String,
) -> NativeResult<Vec<SessionInfo>> {
    let inner = state.0.clone();
    join_blocking(move || {
        let resolved = inner.resolve(&project_id)?;
        let Some(guard) = inner.guard() else {
            return Ok(Vec::new());
        };
        history::sessions_list(&guard, &inner.history, &project_id, &resolved.history_dirs)
    })
    .await
}

#[tauri::command]
pub async fn session_read(
    state: State<'_, AppState>,
    project_id: String,
    session_id: String,
) -> NativeResult<Transcript> {
    let inner = state.0.clone();
    join_blocking(move || {
        let resolved = inner.resolve(&project_id)?;
        let guard = inner
            .guard()
            .ok_or_else(|| NativeError::not_found("session not found"))?;
        history::session_read(
            &guard,
            &inner.history,
            &project_id,
            &resolved.history_dirs,
            &session_id,
        )
    })
    .await
}

#[tauri::command]
pub async fn subagent_read(
    state: State<'_, AppState>,
    project_id: String,
    session_id: String,
    agent_id: String,
) -> NativeResult<SubagentTranscript> {
    let inner = state.0.clone();
    join_blocking(move || {
        let resolved = inner.resolve(&project_id)?;
        let guard = inner
            .guard()
            .ok_or_else(|| NativeError::not_found("subagent not found"))?;
        history::subagent_read(
            &guard,
            &inner.history,
            &resolved.history_dirs,
            &session_id,
            &agent_id,
        )
    })
    .await
}

// ---------------------------------------------------------------- live turns

#[tauri::command]
pub async fn turn_start(
    state: State<'_, AppState>,
    project_id: String,
    session_id: Option<String>,
    prompt: String,
    permission_mode: PermissionMode,
    on_event: Channel<TurnEvent>,
) -> NativeResult<String> {
    turn::validate_prompt(&prompt)?;
    turn::validate_session_id(session_id.as_deref())?;
    let inner = state.0.clone();
    let lookup = inner.clone();
    let cwd = join_blocking(move || {
        let resolved = lookup.resolve(&project_id)?;
        resolved.require_root().map(std::path::Path::to_path_buf)
    })
    .await?;
    let loc = locate_claude(&inner).await?;
    turn::start(
        inner.turns.clone(),
        TurnSpec {
            exe: loc.exe,
            cwd,
            session_id,
            prompt,
            permission_mode,
        },
        on_event,
    )
    .await
}

#[tauri::command]
pub fn turn_cancel(state: State<'_, AppState>, turn_id: String) -> NativeResult<()> {
    if !crate::util::is_uuid(&turn_id) {
        return Err(NativeError::invalid("invalid turn id"));
    }
    // Unknown/finished turns are a no-op so cancel can be called repeatedly.
    state.0.turns.cancel(&turn_id);
    Ok(())
}

// ---------------------------------------------------------------- workspace and configuration

#[tauri::command]
pub async fn fs_list_dir(
    state: State<'_, AppState>,
    project_id: String,
    rel_path: String,
) -> NativeResult<Vec<DirEntry>> {
    let inner = state.0.clone();
    join_blocking(move || {
        let resolved = inner.resolve(&project_id)?;
        wfs::list_dir(resolved.require_root()?, &rel_path)
    })
    .await
}

#[tauri::command]
pub async fn fs_read_file(
    state: State<'_, AppState>,
    project_id: String,
    rel_path: String,
) -> NativeResult<FileContent> {
    let inner = state.0.clone();
    join_blocking(move || {
        let resolved = inner.resolve(&project_id)?;
        wfs::read_file(resolved.require_root()?, &rel_path)
    })
    .await
}

fn project_root(
    inner: &crate::state::Inner,
    project_id: Option<&str>,
) -> NativeResult<Option<PathBuf>> {
    match project_id {
        None => Ok(None),
        Some(id) => Ok(inner.resolve(id)?.root),
    }
}

#[tauri::command]
pub async fn agents_list(
    state: State<'_, AppState>,
    project_id: Option<String>,
) -> NativeResult<Vec<AgentInfo>> {
    let inner = state.0.clone();
    join_blocking(move || {
        let root = project_root(&inner, project_id.as_deref())?;
        config::list_agents(inner.guard().as_ref(), root.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn skills_list(
    state: State<'_, AppState>,
    project_id: Option<String>,
) -> NativeResult<Vec<SkillInfo>> {
    let inner = state.0.clone();
    join_blocking(move || {
        let root = project_root(&inner, project_id.as_deref())?;
        config::list_skills(inner.guard().as_ref(), root.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn mcp_list(state: State<'_, AppState>) -> NativeResult<Vec<McpServerInfo>> {
    let loc = locate_claude(&state.0).await?;
    let out = cli::run(&loc.exe, &["mcp", "list"], MCP_TIMEOUT).await?;
    Ok(parse_mcp_list(&out.stdout))
}
