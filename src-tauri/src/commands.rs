//! IPC commands (docs/NATIVE_API.md). The webview sends ids only; paths and
//! executables are resolved here. Every command is listed in `build.rs`
//! (`APP_COMMANDS`) and granted in `capabilities/default.json`.

use std::path::PathBuf;
use std::time::Duration;

use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::claude::auth::{parse_auth_status, ClaudeInstall, ClaudeStatus};
use crate::claude::cli;
use crate::claude::history::{self, SessionInfo, SubagentTranscript, Transcript};
use crate::claude::locate::{self, Located};
use crate::claude::mcp::{parse_mcp_list, McpServerInfo};
use crate::claude::stream::TurnEvent;
use crate::claude::turn::{self, PermissionMode, TurnSpec};
use crate::config::{self, AgentInfo, SkillInfo};
use crate::error::{join_blocking, NativeError, NativeResult};
use crate::fs::{self as wfs, DirEntry, FileContent};
use crate::projects::{self, ProjectInfo};
use crate::state::{AppState, ClaudeDirs};
use crate::util::display_path;

const STATUS_TIMEOUT: Duration = Duration::from_secs(20);
const MCP_TIMEOUT: Duration = Duration::from_secs(30);

async fn locate_claude() -> NativeResult<Located> {
    join_blocking(|| Ok(locate::locate()))
        .await?
        .ok_or_else(NativeError::claude_not_found)
}

// ---------------------------------------------------------------- Claude Code install / sign-in

#[tauri::command]
pub async fn claude_status(state: State<'_, AppState>) -> NativeResult<ClaudeStatus> {
    let inner = state.0.clone();
    let Some(loc) = join_blocking(|| Ok(locate::locate())).await? else {
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
    let version = version_out
        .ok()
        .and_then(|o| locate::parse_version(&o.stdout))
        .or(loc.dir_version.clone());
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
        install: Some(ClaudeInstall {
            path: display_path(&loc.exe),
            version,
            source: loc.source,
        }),
        logged_in: auth.logged_in,
        auth_method: auth.auth_method,
        subscription: auth.subscription,
        subscription_type: auth.subscription_type,
        email: auth.email,
        org_name: auth.org_name,
    })
}

/// Opens a visible console running `claude auth login --claudeai` (the
/// browser OAuth flow is driven by Claude Code itself). Returns immediately;
/// the UI polls `claude_status`.
#[tauri::command]
pub async fn claude_auth_login() -> NativeResult<()> {
    let loc = locate_claude().await?;
    let mut cmd = std::process::Command::new(&loc.exe);
    cmd.args(["auth", "login", "--claudeai"])
        .current_dir(locate::home_dir().unwrap_or_else(std::env::temp_dir));
    for key in cli::SCRUBBED_ENV {
        cmd.env_remove(key);
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
pub async fn claude_auth_logout() -> NativeResult<()> {
    let loc = locate_claude().await?;
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
    let loc = locate_claude().await?;
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
pub async fn mcp_list() -> NativeResult<Vec<McpServerInfo>> {
    let loc = locate_claude().await?;
    let out = cli::run(&loc.exe, &["mcp", "list"], MCP_TIMEOUT).await?;
    Ok(parse_mcp_list(&out.stdout))
}
