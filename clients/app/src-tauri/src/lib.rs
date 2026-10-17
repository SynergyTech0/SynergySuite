//! Synergy for desktop and mobile: each suite app in a native window, with a launcher, an app
//! menu (desktop) and links outside the suite sent to the system browser.

#[cfg(desktop)]
mod menu;
mod settings;
mod suite;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

use settings::Settings;
use suite::{App, Server};

pub struct State {
    apps: Vec<App>,
    settings: Mutex<Settings>,
    windows: AtomicUsize,
}

impl State {
    fn server(&self) -> Option<Server> {
        self.settings.lock().unwrap().server.clone()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LauncherState {
    server: Option<Server>,
    apps: Vec<App>,
    last_app: Option<String>,
    version: String,
}

#[tauri::command]
fn get_state(app: AppHandle, state: tauri::State<State>) -> LauncherState {
    let settings = state.settings.lock().unwrap();
    LauncherState {
        server: settings.server.clone(),
        apps: state.apps.clone(),
        last_app: settings.last_app.clone(),
        version: app.package_info().version.to_string(),
    }
}

#[tauri::command]
fn set_server(app: AppHandle, state: tauri::State<State>, input: String) -> Result<Server, String> {
    let server = Server::parse(&input, &state.apps)?;
    let mut settings = state.settings.lock().unwrap();
    if settings.server.as_ref() != Some(&server) {
        settings.last_app = None;
    }
    settings.server = Some(server.clone());
    settings.save(&app);
    Ok(server)
}

#[tauri::command]
fn open_app(window: WebviewWindow, state: tauri::State<State>, id: String) -> Result<(), String> {
    let server = state.server().ok_or("Connect to your Synergy first.")?;
    let app = state.apps.iter().find(|a| a.id == id).ok_or("No such app.")?;
    window.navigate(server.app_url(app)).map_err(|e| e.to_string())
}

/// The bundled launcher page, which differs by platform and in development.
pub(crate) fn launcher_url(app: &AppHandle) -> Url {
    if tauri::is_dev() {
        if let Some(dev) = &app.config().build.dev_url {
            return dev.clone();
        }
    }
    let s = if cfg!(any(windows, target_os = "android")) {
        "http://tauri.localhost/"
    } else {
        "tauri://localhost/"
    };
    Url::parse(s).unwrap()
}

fn is_launcher(app: &AppHandle, url: &Url) -> bool {
    // Compared by parts: `tauri://localhost` has an opaque origin, which never equals another.
    let launcher = launcher_url(app);
    url.scheme() == launcher.scheme()
        && url.host_str() == launcher.host_str()
        && url.port_or_known_default() == launcher.port_or_known_default()
}

/// Opens a suite window. Every window gets the same rules: suite pages stay inside, other
/// links open in the browser, downloads go to the Downloads folder.
pub(crate) fn open_window(app: &AppHandle, url: WebviewUrl) -> tauri::Result<WebviewWindow> {
    let state = app.state::<State>();
    let n = state.windows.fetch_add(1, Ordering::Relaxed);
    let label = if n == 0 {
        "main".to_string()
    } else {
        format!("window-{n}")
    };

    let nav_app = app.clone();
    let popup_app = app.clone();
    let download_app = app.clone();
    #[cfg(mobile)]
    let popup_label = label.clone();

    let builder = WebviewWindowBuilder::new(app, label, url)
        .title("Synergy")
        .inner_size(1280.0, 820.0)
        .min_inner_size(720.0, 520.0)
        .on_document_title_changed(|window, title| {
            let _ = window.set_title(if title.is_empty() { "Synergy" } else { &title });
        })
        .on_navigation(move |url| allow_navigation(&nav_app, url))
        .on_new_window(move |url, _features| {
            if allow_navigation(&popup_app, &url) {
                // Phones have one window, so a suite link meant for a new window opens in place.
                #[cfg(mobile)]
                if let Some(window) = popup_app.get_webview_window(&popup_label) {
                    let _ = window.navigate(url);
                }
                #[cfg(desktop)]
                {
                    let app = popup_app.clone();
                    // Window creation must not block the webview's event handler.
                    let _ = popup_app.run_on_main_thread(move || {
                        let _ = open_window(&app, WebviewUrl::External(url));
                    });
                }
            }
            NewWindowResponse::Deny
        })
        .on_download(move |_webview, event| {
            if let DownloadEvent::Requested { url, destination } = event {
                if let Some(path) = settings::download_path(&download_app, &url, destination) {
                    *destination = path;
                }
            }
            true
        });
    // Phones have no menu bar, so suite pages get a small button back to the launcher.
    #[cfg(mobile)]
    let builder = builder.initialization_script(mobile_launcher_button(&launcher_url(app)));
    builder.build()
}

/// A round "All apps" button in the bottom-left corner of every suite page, above the
/// home indicator. The launcher page itself doesn't get one.
#[cfg_attr(desktop, allow(dead_code))]
fn mobile_launcher_button(launcher: &Url) -> String {
    include_str!("launcher-button.js").replace("__LAUNCHER__", launcher.as_str())
}

/// Decides whether a page may load in the window. Called for every top-level navigation.
fn allow_navigation(app: &AppHandle, url: &Url) -> bool {
    if is_launcher(app, url) || matches!(url.scheme(), "about" | "data" | "blob") {
        return true;
    }
    let state = app.state::<State>();
    let Some(server) = state.server() else {
        return false;
    };
    if server.owns(url) {
        if let Some(found) = server.app_for(url, &state.apps) {
            let mut settings = state.settings.lock().unwrap();
            if settings.last_app.as_deref() != Some(&found.id) {
                settings.last_app = Some(found.id.clone());
                settings.save(app);
            }
        }
        return true;
    }
    if matches!(url.scheme(), "http" | "https" | "mailto" | "tel") {
        // On Android this handler runs on the UI thread, and the opener waits for an answer
        // from that same thread, so calling it here would freeze the app. Hand it off instead.
        let app = app.clone();
        let url = url.to_string();
        std::thread::spawn(move || {
            let _ = app.opener().open_url(url, None::<&str>);
        });
    }
    false
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .menu(menu::build)
        .on_menu_event(menu::handle);
    builder
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_state, set_server, open_app])
        .setup(|app| {
            let handle = app.handle().clone();
            let mut settings = Settings::load(&handle);
            let apps = suite::launchable_apps();
            // A build made for one company's suite (SYNERGY_SERVER at build time) starts on it.
            // People can still connect elsewhere from the launcher.
            if settings.server.is_none() {
                settings.server = option_env!("SYNERGY_SERVER")
                    .filter(|s| !s.is_empty())
                    .and_then(|s| Server::parse(s, &apps).ok());
            }
            // Reopen the app the person was last in; otherwise start on the launcher.
            let start = match (&settings.server, &settings.last_app) {
                (Some(server), Some(id)) => apps
                    .iter()
                    .find(|a| &a.id == id)
                    .map(|a| WebviewUrl::External(server.app_url(a))),
                _ => None,
            };
            app.manage(State {
                apps,
                settings: Mutex::new(settings),
                windows: AtomicUsize::new(0),
            });
            open_window(
                &handle,
                start.unwrap_or_else(|| WebviewUrl::App("index.html".into())),
            )?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Synergy");
}
