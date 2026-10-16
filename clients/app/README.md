# Synergy desktop

Synergy for Windows, macOS and Linux. It opens the suite's apps from your own server in a
native window, the way the new Outlook and Teams apps wrap Microsoft 365, with a launcher, an
app menu, keyboard shortcuts and links outside the suite opening in your browser.

Built with [Tauri 2](https://tauri.app) (MIT or Apache-2.0), which uses the system webview:
WebView2 on Windows, WKWebView on macOS and WebKitGTK on Linux. Installers are about 2 to 10 MB
instead of the 100 MB or more an Electron app ships.

## Using it

On first launch it asks for your Synergy address: the domain your suite runs on
(`SUITE_DOMAIN`, so `example.com` when Mail is at `mail.example.com`), or the address of any of
its apps. `localhost` points it at a suite running on the same computer with the apps on their
development ports. You sign in on the suite's usual sign-in page; the session is kept between
launches. The next launch opens the last app you used.

| Shortcut | Does |
| --- | --- |
| Ctrl/Cmd+1 to 9 | Mail, Calendar, Chat, Meet, Office, Drive, Contacts, To Do, Planner |
| Ctrl/Cmd+Shift+A | All apps (the launcher) |
| Ctrl/Cmd+N | New window on the same page |
| Ctrl/Cmd+R | Reload |
| Alt+Left, Alt+Right (Cmd+[ and Cmd+] on macOS) | Back and forward |
| Ctrl/Cmd+0, +, - | Actual size, zoom in, zoom out |

Go > More Apps lists the rest. File > Change Server switches to another suite.

How it behaves:

- Pages on your suite's domain and its subdomains stay in the app; every other link (and
  `mailto:`/`tel:`) opens in the system browser or mail app. Pop-ups to suite pages open as
  new windows.
- Downloads go to your Downloads folder, numbered instead of overwriting.
- Only the bundled launcher page can call into the app. Suite pages from the server are treated
  as remote content and get no access to the app's commands (`src-tauri/capabilities`).
- One copy runs at a time; starting it again brings the open window forward. Window size and
  position are remembered.

## Installers

The `desktop` workflow builds them on every pull request and push that touches this folder:
`.exe` and `.msi` for Windows, a universal `.dmg` for macOS, and `.deb`, `.rpm` and `.AppImage`
for Linux, attached to the run as artifacts. Pushing a `desktop-v0.1.0` style tag drafts a
GitHub release with them.

They are not code signed yet, so Windows SmartScreen and macOS Gatekeeper warn on first open
(on macOS, right-click the app and choose Open). Signing needs a Windows code signing
certificate and an Apple Developer ID added as repository secrets.

## Building it yourself

You need Node 22, Rust (stable) and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your system (on Linux:
`libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev`).

```sh
cd clients/app
npm install
npm run dev      # runs it with the launcher page hot reloading
npm run build    # installers in src-tauri/target/release/bundle
```

`npm run icons` regenerates `src-tauri/icons` from `packages/shell/assets/synergy-mark.png`.
The app list comes from `packages/config/apps.json` at build time, so a new suite app shows up
in the launcher and the Go menu after a rebuild.

## Layout

| Path | What |
| --- | --- |
| `index.html`, `src/` | The launcher page: connect to a server, find and open an app |
| `src-tauri/src/suite.rs` | Server address parsing, app addresses, which links stay inside (unit tested) |
| `src-tauri/src/lib.rs` | Windows, navigation and download rules, the launcher's commands |
| `src-tauri/src/menu.rs` | The menu bar and its shortcuts |
| `src-tauri/src/settings.rs` | The saved server and last app, download file names |

## Not yet

- Native notifications for new mail and chat messages, and an unread badge.
- Staying in the system tray when the window is closed.
- `synergy://` links that open a given app from other programs.
- Automatic updates (needs an update signing key and somewhere to publish update manifests).
