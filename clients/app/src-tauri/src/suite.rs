//! Which server the app talks to, where each suite app lives on it, and which links stay
//! inside the window. Kept free of Tauri types so it can be unit tested.

use serde::{Deserialize, Serialize};
use url::Url;

/// The suite's app registry, the same file the app bar and the deploy read.
const APPS_JSON: &str = include_str!("../../../../packages/config/apps.json");

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct App {
    pub id: String,
    pub name: String,
    pub m365: String,
    pub port: u16,
    pub icon: String,
    pub core: bool,
    #[serde(default)]
    pub planned: bool,
}

/// The everyday apps, in the order of the M365 app rail. They lead the launcher and get
/// Ctrl/Cmd+1..9 in the Go menu.
pub const PRIMARY: [&str; 9] = [
    "mail", "calendar", "chat", "meet", "office", "drive", "contacts", "todo", "planner",
];

/// Apps a person can open: the core apps that are built, minus Home, which only exists in the
/// prototype and is replaced here by the launcher page. Everyday apps first, then the registry order.
pub fn launchable_apps() -> Vec<App> {
    let apps: Vec<App> = serde_json::from_str(APPS_JSON).expect("apps.json is valid");
    let mut apps: Vec<App> = apps
        .into_iter()
        .filter(|a| a.core && !a.planned && a.id != "home")
        .collect();
    apps.sort_by_key(|a| PRIMARY.iter().position(|p| *p == a.id).unwrap_or(PRIMARY.len()));
    apps
}

/// The suite a window points at. A real deployment serves every app on its own subdomain of
/// `SUITE_DOMAIN` (`mail.example.com`); a developer machine serves them on localhost ports.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Server {
    Domain { domain: String },
    Local,
}

impl Server {
    /// Reads what a person typed into the connect box. Accepts the suite domain on its own
    /// (`example.com`), any app's address (`https://mail.example.com/inbox`, which is reduced to
    /// `example.com`), or `localhost`.
    pub fn parse(input: &str, apps: &[App]) -> Result<Server, String> {
        let trimmed = input.trim().trim_end_matches('/');
        if trimmed.is_empty() {
            return Err("Enter your Synergy address, for example example.com.".into());
        }
        let with_scheme = if trimmed.contains("://") {
            trimmed.to_string()
        } else {
            format!("https://{trimmed}")
        };
        let url = Url::parse(&with_scheme).map_err(|_| format!("\"{trimmed}\" is not an address."))?;
        let host = url
            .host_str()
            .ok_or_else(|| format!("\"{trimmed}\" is not an address."))?
            .to_ascii_lowercase();
        if host == "localhost" || host == "127.0.0.1" {
            return Ok(Server::Local);
        }
        if !host.contains('.') || host.parse::<std::net::IpAddr>().is_ok() {
            return Err("Use the domain your Synergy runs on, for example example.com.".into());
        }
        // `mail.example.com` and `sso.example.com` both mean the suite at `example.com`.
        let first = host.split('.').next().unwrap_or_default();
        let is_suite_host = apps.iter().any(|a| a.id == first) || matches!(first, "sso" | "auth");
        let domain = match host.split_once('.') {
            Some((_, rest)) if is_suite_host && rest.contains('.') => rest.to_string(),
            _ => host,
        };
        Ok(Server::Domain { domain })
    }

    /// Where an app lives, matching `urlFor` in the app bar (packages/shell).
    pub fn app_url(&self, app: &App) -> Url {
        let s = match self {
            Server::Domain { domain } => format!("https://{}.{domain}/", app.id),
            Server::Local => format!("http://localhost:{}/", app.port),
        };
        Url::parse(&s).expect("app urls are valid")
    }

    /// Whether a link belongs to this suite and should open inside the app. Everything else
    /// (a link in an email, a shared YouTube video) goes to the system browser.
    pub fn owns(&self, url: &Url) -> bool {
        let Some(host) = url.host_str() else { return false };
        match self {
            Server::Domain { domain } => {
                url.scheme() == "https" && (host == domain || host.ends_with(&format!(".{domain}")))
            }
            Server::Local => {
                matches!(url.scheme(), "http" | "https") && matches!(host, "localhost" | "127.0.0.1")
            }
        }
    }

    /// The suite app a suite address belongs to, so the app can reopen it next time.
    pub fn app_for<'a>(&self, url: &Url, apps: &'a [App]) -> Option<&'a App> {
        if !self.owns(url) {
            return None;
        }
        match self {
            Server::Domain { domain } => {
                let host = url.host_str()?;
                let sub = host.strip_suffix(&format!(".{domain}"))?;
                apps.iter().find(|a| a.id == sub)
            }
            Server::Local => {
                let port = url.port_or_known_default()?;
                apps.iter().find(|a| a.port == port)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn apps() -> Vec<App> {
        launchable_apps()
    }

    fn domain(d: &str) -> Server {
        Server::Domain { domain: d.into() }
    }

    #[test]
    fn registry_loads_without_home() {
        let apps = apps();
        assert!(apps.iter().any(|a| a.id == "mail"));
        assert!(!apps.iter().any(|a| a.id == "home"));
        assert!(apps.iter().all(|a| a.core));
        assert_eq!(apps[0].id, "mail");
        assert_eq!(
            apps.iter()
                .take(PRIMARY.len())
                .map(|a| a.id.as_str())
                .collect::<Vec<_>>(),
            PRIMARY
        );
    }

    #[test]
    fn parses_what_people_type() {
        let apps = apps();
        assert_eq!(Server::parse("example.com", &apps), Ok(domain("example.com")));
        assert_eq!(Server::parse(" Example.COM/ ", &apps), Ok(domain("example.com")));
        assert_eq!(
            Server::parse("https://mail.example.com/inbox", &apps),
            Ok(domain("example.com"))
        );
        assert_eq!(
            Server::parse("sso.suite.acme.co.uk", &apps),
            Ok(domain("suite.acme.co.uk"))
        );
        assert_eq!(
            Server::parse("suite.acme.com", &apps),
            Ok(domain("suite.acme.com"))
        );
        // `mail.com` is a domain of its own, not the Mail app of `com`.
        assert_eq!(Server::parse("mail.com", &apps), Ok(domain("mail.com")));
        assert_eq!(Server::parse("localhost", &apps), Ok(Server::Local));
        assert_eq!(Server::parse("http://localhost:3200", &apps), Ok(Server::Local));
        assert!(Server::parse("", &apps).is_err());
        assert!(Server::parse("intranet", &apps).is_err());
        assert!(Server::parse("10.0.0.5", &apps).is_err());
    }

    #[test]
    fn app_urls_match_the_app_bar() {
        let apps = apps();
        let mail = apps.iter().find(|a| a.id == "mail").unwrap();
        assert_eq!(
            domain("example.com").app_url(mail).as_str(),
            "https://mail.example.com/"
        );
        assert_eq!(Server::Local.app_url(mail).as_str(), "http://localhost:3200/");
    }

    #[test]
    fn only_suite_links_stay_inside() {
        let s = domain("example.com");
        let u = |x: &str| Url::parse(x).unwrap();
        assert!(s.owns(&u("https://mail.example.com/inbox")));
        assert!(s.owns(&u("https://sso.example.com/oauth2/start")));
        assert!(s.owns(&u("https://example.com/")));
        assert!(!s.owns(&u("http://mail.example.com/")));
        assert!(!s.owns(&u("https://mail.example.com.evil.net/")));
        assert!(!s.owns(&u("https://notexample.com/")));
        assert!(!s.owns(&u("https://www.youtube.com/watch?v=1")));
        assert!(Server::Local.owns(&u("http://localhost:3200/")));
        assert!(!Server::Local.owns(&u("https://github.com/")));
    }

    #[test]
    fn finds_the_app_behind_an_address() {
        let apps = apps();
        let u = |x: &str| Url::parse(x).unwrap();
        let s = domain("example.com");
        assert_eq!(
            s.app_for(&u("https://chat.example.com/c/1"), &apps)
                .map(|a| a.id.as_str()),
            Some("chat")
        );
        assert_eq!(
            s.app_for(&u("https://sso.example.com/"), &apps)
                .map(|a| a.id.as_str()),
            None
        );
        assert_eq!(
            Server::Local
                .app_for(&u("http://localhost:3080/"), &apps)
                .map(|a| a.id.as_str()),
            Some("chat")
        );
    }
}
