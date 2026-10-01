//! Build script: generates the Tauri context and the ACL (capabilities) schema.
//!
//! The app's own IPC commands are declared explicitly in an `AppManifest` so
//! that tauri-build generates `allow-<command>` / `deny-<command>` permissions
//! for each one and the runtime enforces the capability ACL for app commands.
//!
//! SECURITY RULE: every `#[tauri::command]` registered in
//! `tauri::generate_handler![...]` (e.g. `claude_detect`, `claude_auth_status`,
//! `session_start`, ...) MUST be added to `APP_COMMANDS` below AND granted
//! explicitly (`allow-<command>`) in the capability file(s) under
//! `capabilities/` for the window(s) that need it. A command missing from a
//! capability is not callable from the webview - that is the intended default.

/// Explicit allow-list of app IPC commands. Empty until M2 (no native
/// commands are exposed yet).
const APP_COMMANDS: &[&str] = &[];

fn main() {
    let attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS));

    if let Err(error) = tauri_build::try_build(attributes) {
        // Build scripts report failures by panicking; keep the error chain.
        panic!("tauri-build failed: {error:#}");
    }
}
