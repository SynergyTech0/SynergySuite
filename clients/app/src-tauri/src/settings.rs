//! What the app remembers between launches: the server and the last app open.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Url};

use crate::suite::Server;

#[derive(Default, Deserialize, Serialize)]
pub struct Settings {
    pub server: Option<Server>,
    pub last_app: Option<String>,
}

fn file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
}

impl Settings {
    pub fn load(app: &AppHandle) -> Settings {
        file(app)
            .and_then(|f| std::fs::read(f).ok())
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, app: &AppHandle) {
        let Some(path) = file(app) else { return };
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_vec_pretty(self) {
            let _ = std::fs::write(path, json);
        }
    }
}

/// Where a download is saved: the Downloads folder, under the name the webview picked (or the
/// last part of the address), numbered so an existing file is never overwritten.
pub fn download_path(app: &AppHandle, url: &Url, suggested: &Path) -> Option<PathBuf> {
    // Linux without XDG user dirs has no download dir; ~/Downloads is what browsers use then.
    let dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().home_dir().map(|h| h.join("Downloads")))
        .ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    let name = suggested
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .or_else(|| url.path_segments()?.next_back().map(str::to_string))
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "download".into());
    Some(unique(&dir, &name))
}

fn unique(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s, format!(".{e}")),
        _ => (name, String::new()),
    };
    (1..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::unique;

    #[test]
    fn numbers_files_that_exist() {
        let dir = std::env::temp_dir().join(format!("synergy-dl-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(unique(&dir, "report.pdf"), dir.join("report.pdf"));
        std::fs::write(dir.join("report.pdf"), b"").unwrap();
        assert_eq!(unique(&dir, "report.pdf"), dir.join("report (1).pdf"));
        std::fs::write(dir.join("README"), b"").unwrap();
        assert_eq!(unique(&dir, "README"), dir.join("README (1)"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
