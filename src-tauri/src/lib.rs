use tauri::webview::NewWindowResponse;
use tauri::{Manager, Runtime, Url, Webview};

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
        .setup(|app| {
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
        .run(tauri::generate_context!())
        .expect("error while running Crowe Harness");
}
