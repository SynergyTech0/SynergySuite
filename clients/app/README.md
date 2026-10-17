# Synergy app

Synergy for Windows, macOS, Linux, Android and iOS. It opens the suite's apps from your own
server in a native window, the way the new Outlook and Teams apps wrap Microsoft 365, with a
launcher, links outside the suite opening in your browser, and on desktop an app menu with
keyboard shortcuts.

One codebase for all five, built with [Tauri 2](https://tauri.app) (MIT or Apache-2.0), which
uses the system webview: WebView2 on Windows, WKWebView on macOS and iOS, WebKitGTK on Linux
and Android System WebView. Desktop installers are about 2 to 10 MB instead of the 100 MB or
more an Electron app ships.

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

On phones and tablets there is no menu bar: switch apps with the app launcher in each app's
header, or tap the round grid button in the bottom-left corner to get back to the Synergy
launcher (and from there, Change server). Android's back button goes back a page.

How it behaves:

- Pages on your suite's domain and its subdomains stay in the app; every other link (and
  `mailto:`/`tel:`) opens in the system browser or mail app. Pop-ups to suite pages open as
  new windows.
- Downloads go to your Downloads folder, numbered instead of overwriting.
- Only the bundled launcher page can call into the app. Suite pages from the server are treated
  as remote content and get no access to the app's commands (`src-tauri/capabilities`).
- On desktop, one copy runs at a time; starting it again brings the open window forward.
  Window size and position are remembered.

## Installers

### Desktop

The `desktop` workflow builds them on every pull request and push that touches this folder:
`.exe` and `.msi` for Windows, a universal `.dmg` for macOS, and `.deb`, `.rpm` and `.AppImage`
for Linux, attached to the run as artifacts. These test builds are not signed, so Windows
SmartScreen and macOS Gatekeeper warn on first open (on macOS, right-click the app and choose
Open).

Pushing an `app-v0.1.0` style tag builds signed Windows installers and a signed, notarized
macOS app, drafts a GitHub release with them, and sends the mobile builds to Google Play and
TestFlight. [RELEASING.md](RELEASING.md) lists the accounts and secrets each store needs.

### Mobile

The `mobile` workflow builds an Android debug APK (artifact `synergy-android`) that installs
on any Android 7 or later phone once "install unknown apps" is allowed for your browser or
file manager. It also builds the iOS app for the simulator to prove it compiles; iOS 15 or
later is supported. Store builds come from an `app-v*` tag, as described above.

The Android and Xcode projects are not checked in. `tauri android init` and `tauri ios init`
generate them under `src-tauri/gen/` from `tauri.conf.json` (`npm run android:init` also puts in
`src-tauri/android/MainActivity.kt`, which handles the back button), and `npm run icons` fills in
their icons.

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

For Android, also install Android Studio with an NDK and set `ANDROID_HOME` and `NDK_HOME`;
for iOS, Xcode on a Mac. Then:

```sh
npm run android:init && npm run icons
npx tauri android dev            # on a connected phone or emulator
npx tauri android build --apk    # release APK, to sign with your own key

npx tauri ios init && npm run icons
npx tauri ios dev                # on the simulator or a phone
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
| `src-tauri/src/menu.rs` | The menu bar and its shortcuts (desktop only) |
| `src-tauri/src/launcher-button.js` | The button back to the launcher on suite pages (mobile only) |
| `src-tauri/src/settings.rs` | The saved server and last app, download file names |

## Not yet

- Downloads on Android and iOS (the system webview drops them; opening files from Drive and
  Mail in the phone's own viewer is next).
- Store builds for Google Play and the App Store, and push notifications through them.
- Native notifications for new mail and chat messages, and an unread badge.
- Staying in the system tray when the window is closed.
- `synergy://` links that open a given app from other programs.
- Automatic updates (needs an update signing key and somewhere to publish update manifests).
