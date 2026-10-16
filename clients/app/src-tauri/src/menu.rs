//! The menu bar: switch apps from the keyboard, move back and forward, zoom, change server.
//! One menu for the whole app; commands act on the focused window.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, Runtime, Url, WebviewUrl, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

use crate::suite::{launchable_apps, PRIMARY};
use crate::State;

const REPO: &str = "https://github.com/SynergyTech0/SynergySuite";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, text: &str, accel: Option<&str>| MenuItem::with_id(app, id, text, true, accel);
    let sep = || PredefinedMenuItem::separator(app);

    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &item("new-window", "New Window", Some("CmdOrCtrl+N"))?,
            &item("change-server", "Change Server…", None)?,
            &sep()?,
            &PredefinedMenuItem::close_window(app, None)?,
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &sep()?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &item("reload", "Reload", Some("CmdOrCtrl+R"))?,
            &sep()?,
            &item("zoom-reset", "Actual Size", Some("CmdOrCtrl+0"))?,
            &item("zoom-in", "Zoom In", Some("CmdOrCtrl+="))?,
            &item("zoom-out", "Zoom Out", Some("CmdOrCtrl+-"))?,
            &sep()?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    let back = if cfg!(target_os = "macos") {
        "Cmd+["
    } else {
        "Alt+Left"
    };
    let forward = if cfg!(target_os = "macos") {
        "Cmd+]"
    } else {
        "Alt+Right"
    };
    let go = Submenu::with_id(app, "go", "Go", true)?;
    go.append(&item("back", "Back", Some(back))?)?;
    go.append(&item("forward", "Forward", Some(forward))?)?;
    go.append(&sep()?)?;
    go.append(&item("launcher", "All Apps", Some("CmdOrCtrl+Shift+A"))?)?;
    go.append(&sep()?)?;
    let apps = launchable_apps();
    for (n, id) in PRIMARY.iter().enumerate() {
        if let Some(a) = apps.iter().find(|a| a.id == *id) {
            go.append(&item(
                &format!("app:{}", a.id),
                &a.name,
                Some(&format!("CmdOrCtrl+{}", n + 1)),
            )?)?;
        }
    }
    let more = Submenu::with_id(app, "more-apps", "More Apps", true)?;
    for a in apps.iter().filter(|a| !PRIMARY.contains(&a.id.as_str())) {
        more.append(&item(&format!("app:{}", a.id), &a.name, None)?)?;
    }
    go.append(&more)?;

    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
        ],
    )?;
    let help = Submenu::with_items(app, "Help", true, &[&item("github", "Synergy on GitHub", None)?])?;

    let menu = Menu::with_items(app, &[&file, &edit, &view, &go, &window, &help])?;
    #[cfg(target_os = "macos")]
    {
        // macOS puts the first submenu under the app's name.
        let name = Submenu::with_items(
            app,
            "Synergy",
            true,
            &[
                &PredefinedMenuItem::about(app, None, None)?,
                &sep()?,
                &PredefinedMenuItem::services(app, None)?,
                &sep()?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::show_all(app, None)?,
                &sep()?,
                &PredefinedMenuItem::quit(app, None)?,
            ],
        )?;
        menu.prepend(&name)?;
    }
    Ok(menu)
}

fn focused(app: &AppHandle) -> Option<WebviewWindow> {
    let windows = app.webview_windows();
    windows
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
        .or_else(|| windows.get("main"))
        .or_else(|| windows.values().next())
        .cloned()
}

fn zoom_levels() -> &'static Mutex<HashMap<String, f64>> {
    static LEVELS: OnceLock<Mutex<HashMap<String, f64>>> = OnceLock::new();
    LEVELS.get_or_init(Default::default)
}

fn zoom(window: &WebviewWindow, change: Option<f64>) {
    let mut levels = zoom_levels().lock().unwrap();
    let level = levels.entry(window.label().to_string()).or_insert(1.0);
    *level = match change {
        Some(step) => (*level + step).clamp(0.5, 3.0),
        None => 1.0,
    };
    let _ = window.set_zoom(*level);
}

pub fn handle(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    if id == "github" {
        let _ = app.opener().open_url(REPO, None::<&str>);
        return;
    }
    if id == "new-window" {
        let start = focused(app).and_then(|w| w.url().ok());
        let url = start
            .map(WebviewUrl::External)
            .unwrap_or_else(|| WebviewUrl::App("index.html".into()));
        let _ = crate::open_window(app, url);
        return;
    }
    let Some(window) = focused(app) else { return };
    match id {
        "reload" => {
            let _ = window.reload();
        }
        "back" => {
            let _ = window.eval("history.back()");
        }
        "forward" => {
            let _ = window.eval("history.forward()");
        }
        "zoom-in" => zoom(&window, Some(0.1)),
        "zoom-out" => zoom(&window, Some(-0.1)),
        "zoom-reset" => zoom(&window, None),
        "launcher" | "change-server" => {
            let mut url: Url = crate::launcher_url(app);
            if id == "change-server" {
                url.set_fragment(Some("connect"));
            }
            let _ = window.navigate(url);
        }
        _ => {
            if let Some(app_id) = id.strip_prefix("app:") {
                let state = app.state::<State>();
                let target = state
                    .server()
                    .zip(state.apps.iter().find(|a| a.id == app_id))
                    .map(|(server, a)| server.app_url(a));
                match target {
                    Some(url) => {
                        let _ = window.navigate(url);
                    }
                    // Not connected yet: the launcher asks for the server.
                    None => {
                        let _ = window.navigate(crate::launcher_url(app));
                    }
                }
            }
        }
    }
}
