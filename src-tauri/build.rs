//! Build script: generates the Tauri context and the ACL (capabilities) schema.
//!
//! The app's own IPC commands are declared explicitly in an `AppManifest` so
//! that tauri-build generates `allow-<command>` / `deny-<command>` permissions
//! for each one and the runtime enforces the capability ACL for app commands.
//!
//! SECURITY RULE: every `#[tauri::command]` registered in
//! `tauri::generate_handler![...]` (e.g. `claude_status`, `sessions_list`,
//! `turn_start`, ...) MUST be added to `APP_COMMANDS` below AND granted
//! explicitly (`allow-<command>`) in the capability file(s) under
//! `capabilities/` for the window(s) that need it. A command missing from a
//! capability is not callable from the webview - that is the intended default.

/// Explicit allow-list of app IPC commands (docs/NATIVE_API.md; keep in sync
/// with `NATIVE_COMMANDS` in src/features/native/contract.ts).
const APP_COMMANDS: &[&str] = &[
    "claude_status",
    "claude_auth_login",
    "claude_auth_logout",
    "claude_install_plan",
    "claude_install_start",
    "claude_install_cancel",
    "projects_list",
    "projects_open_folder",
    "sessions_list",
    "session_read",
    "subagent_read",
    "turn_start",
    "turn_cancel",
    "fs_list_dir",
    "fs_read_file",
    "agents_list",
    "skills_list",
    "mcp_list",
];

fn main() {
    let attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS));

    if let Err(error) = tauri_build::try_build(attributes) {
        // Build scripts report failures by panicking; keep the error chain.
        panic!("tauri-build failed: {error:#}");
    }
}
