use tauri::webview::NewWindowResponse;
use tauri::{Manager, Runtime, Url, Webview};

pub mod claude;
pub mod commands;
pub mod config;
pub mod error;
pub mod fs;
pub mod guard;
pub mod installer;
pub mod projects;
pub mod state;
pub mod util;

/// File (in the app data dir) holding the folders opened by the user.
const REGISTRY_FILE: &str = "projects.json";

/// Origin of the bundled frontend on Windows/Android (wry custom-protocol
/// workaround). We run with `useHttpsScheme: false`, so this is
/// `http://tauri.localhost`; `https` is accepted too so that flipping the
/// option does not silently break navigation.
const APP_HOST_WINDOWS: &str = "tauri.localhost";

/// Returns `true` if `url` points at the app's own frontend.
///
/// Allowed:
/// - `tauri://localhost/...` (macOS / Linux packaged builds)
/// - `http(s)://tauri.localhost/...` (Windows packaged builds)
/// - the configured `build.devUrl` origin (`http://localhost:1420`), only in
///   `tauri dev` builds
/// - `about:blank` (harmless, no origin of its own; used internally by some
///   webview engines)
///
/// Everything else (external sites, `file:`, `data:`, `javascript:` ...) is
/// blocked. Opening external links must go through an explicit, validated
/// native command (e.g. a future opener allow-list), never through webview
/// navigation.
fn is_app_url<R: Runtime>(webview: &Webview<R>, url: &Url) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" if url.host_str() == Some(APP_HOST_WINDOWS) => url.port().is_none(),
        "http" if cfg!(dev) => webview
            .config()
            .build
            .dev_url
            .as_ref()
            .is_some_and(|dev| dev.origin() == url.origin()),
        "about" => url.as_str() == "about:blank",
        _ => false,
    }
}

/// App-wide webview hardening hooks, applied to every webview (including
/// any created later) via the plugin system.
fn navigation_guard<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("crowe-navigation-guard")
        .on_navigation(|webview, url| {
            let allowed = is_app_url(webview, url);
            if !allowed {
                eprintln!(
                    "[security] blocked navigation of webview '{}' to {}",
                    webview.label(),
                    url
                );
            }
            allowed
        })
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(navigation_guard())
        // Used from Rust only (native pickers in `projects_open_folder` and
        // `claude_pick_executable`);
        // the capability grants the webview no `dialog:*` permission.
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::claude_status,
            commands::claude_auth_login,
            commands::claude_auth_logout,
            commands::claude_pick_executable,
            commands::claude_clear_executable,
            commands::claude_locate_report,
            commands::claude_install_plan,
            commands::claude_install_start,
            commands::claude_install_cancel,
            commands::projects_list,
            commands::projects_open_folder,
            commands::sessions_list,
            commands::session_read,
            commands::subagent_read,
            commands::turn_start,
            commands::turn_cancel,
            commands::fs_list_dir,
            commands::fs_read_file,
            commands::agents_list,
            commands::skills_list,
            commands::mcp_list,
        ])
        .setup(|app| {
            let registry_file = app
                .path()
                .app_data_dir()
                .ok()
                .map(|dir| dir.join(REGISTRY_FILE));
            let override_file = app
                .path()
                .app_config_dir()
                .ok()
                .map(|dir| dir.join(claude::finder::OVERRIDE_FILE));
            app.manage(state::AppState::new(registry_file, override_file));

            // Resolve the login-shell PATH early (≤ 5 s, cached) so the first
            // Claude Code check does not wait for the user's shell start-up.
            #[cfg(unix)]
            std::thread::spawn(|| {
                let _ = claude::shell_env::login_shell_path();
            });

            // The main window is declared in tauri.conf.json with
            // `"create": false` and built here, because `on_new_window` is only
            // available on the builder (not on config-created windows).
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .cloned()
                .ok_or("missing `main` window in tauri.conf.json")?;

            tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?
                // Block `window.open` / `target="_blank"` popups: never spawn
                // a second, unguarded webview window.
                .on_new_window(|url, _features| {
                    eprintln!("[security] blocked new window request for {url}");
                    NewWindowResponse::Deny
                })
                .build()?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Crowe Harness")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Closing every job handle kills each turn's process tree;
                // a running install is cancelled (its installer process tree
                // dies with its Job Object when the app exits).
                if let Some(state) = app.try_state::<state::AppState>() {
                    state.0.turns.kill_all();
                    state.0.installs.cancel_all();
                }
            }
        });
}
