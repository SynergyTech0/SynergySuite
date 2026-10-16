# Releasing the Synergy app

One tag releases every platform. Set `version` in `src-tauri/tauri.conf.json`, merge it, then
push a matching tag:

```sh
git tag app-v0.2.0 && git push origin app-v0.2.0
```

| Workflow | What the tag does |
| --- | --- |
| `desktop` | Signs the Windows installers, signs and notarizes the macOS app, builds the Linux packages and drafts a GitHub release with all of them |
| `mobile` | Signs an Android App Bundle and APK and sends the bundle to Google Play's internal testing track; builds the iOS app and sends it to TestFlight |

Each platform is skipped with a warning until its secrets below are set, so you can set up one
store at a time. Pull requests and pushes to `main` keep building unsigned test builds.

Promoting a build from internal testing or TestFlight to the public store is done by hand in
Play Console and App Store Connect, after their review.

Secrets go in GitHub under **Settings > Secrets and variables > Actions**. Use the
**Secrets** tab for everything except the three `AZURE_SIGNING_*` values, which go on the
**Variables** tab.

## Apple: macOS signing, iPhone and iPad (TestFlight, App Store)

1. **Join the Apple Developer Program** at developer.apple.com/programs ($99 a year). Enroll as
   an organization so the stores show "Synergy Technologies"; that needs a D-U-N-S number for
   the company (free from Dun & Bradstreet, takes a few days).
2. **Register the app ID.** In Certificates, Identifiers & Profiles > Identifiers, add an App ID
   with bundle ID `cloud.synergytech.suite`.
3. **Create the app in App Store Connect** (My Apps > +): platform iOS, name Synergy, bundle ID
   `cloud.synergytech.suite`.
4. **Create an App Store Connect API key**: Users and Access > Integrations > App Store Connect
   API > Team Keys, access **App Manager**. Download the `.p8` file (it can be downloaded once).
   This one key signs the iOS app, uploads it to TestFlight and notarizes the macOS app.
5. **Create a Developer ID Application certificate** for the macOS app: Certificates > + >
   Developer ID Application. On a Mac, open it in Keychain Access and export it with its private
   key as a `.p12` with a password.

| Secret | Value |
| --- | --- |
| `APPLE_TEAM_ID` | Your 10-character team ID (Membership details) |
| `APPLE_API_KEY_ID` | The key ID shown next to the API key |
| `APPLE_API_ISSUER` | The issuer ID shown above the keys list |
| `APPLE_API_KEY_P8` | The whole text of the `.p8` file, including the BEGIN and END lines |
| `APPLE_CERTIFICATE` | The `.p12` as base64: `base64 -i cert.p12 \| tr -d '\n'` |
| `APPLE_CERTIFICATE_PASSWORD` | The password you exported the `.p12` with |

Before the first App Store review, fill in the listing in App Store Connect: privacy policy
URL, screenshots and a **demo server and sign-in** in App Review Information. The app needs a
Synergy server to connect to, so without one review cannot get past the first screen.

## Google Play: Android

1. **Create a Play Console developer account** at play.google.com/console ($25 once). Register
   as an organization (same D-U-N-S number). New personal accounts have to run a closed test
   with 12 testers for 14 days before they can publish; organization accounts don't.
2. **Create the app** (All apps > Create app), name Synergy, then open it once so its package
   name can be claimed by the first upload.
3. **Make an upload key.** On any computer with Java:

   ```sh
   keytool -genkeypair -v -keystore synergy-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
   ```

   Keep `synergy-upload.jks` and its passwords somewhere safe, outside the repository. Google
   holds the real app signing key (Play App Signing); this one only proves uploads come from you,
   and Google can reset it if it is lost.
4. **Add the four Android secrets** below, then push the first `app-v*` tag. Download
   `synergy-android-release` from that run, and upload the `.aab` by hand to Testing > Internal
   testing > Create new release. Play only accepts uploads from the API after this first one.
5. **Let CI upload from then on.** In Google Cloud console, create a service account in any
   project, enable the Google Play Android Developer API there, and create a JSON key for it.
   In Play Console > Users and permissions, invite the service account's email with **Release
   to testing tracks** for the Synergy app. Add the JSON as the last secret.

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | The keystore as base64: `base64 -w0 synergy-upload.jks` (macOS: `base64 -i synergy-upload.jks \| tr -d '\n'`) |
| `ANDROID_KEYSTORE_PASSWORD` | The keystore password |
| `ANDROID_KEY_ALIAS` | `upload` |
| `ANDROID_KEY_PASSWORD` | The key password (the same as the keystore password unless you set another) |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | The whole service account JSON key |

The store listing needs a privacy policy URL, screenshots and the Data safety form. In App
access, give reviewers a demo server and sign-in, as for Apple.

## Windows: signing (and the Microsoft Store)

Windows signing uses **Azure Trusted Signing** (also called Artifact Signing), Microsoft's
signing service. Signed installers don't trigger the SmartScreen "unknown publisher" warning.
At the time of writing it is open to organizations in the US, Canada, the EU and the UK, and to
individuals in the US and Canada. Elsewhere, use a code signing certificate from a CA that
offers cloud signing, and change the `signCommand` in `.github/workflows/desktop.yml` to that
CA's tool.

1. In the Azure portal, create a **Trusted Signing account** and note its region's endpoint
   (for example `https://eus.codesigning.azure.net`).
2. Complete **identity validation** for Synergy Technologies (Public), then create a
   **certificate profile** of type Public Trust.
3. In Microsoft Entra ID > App registrations, create an app registration and a client secret.
   On the Trusted Signing account, give it the **Trusted Signing Certificate Profile Signer**
   role.

| Secret | Value |
| --- | --- |
| `AZURE_TENANT_ID` | Directory (tenant) ID of the app registration |
| `AZURE_CLIENT_ID` | Application (client) ID of the app registration |
| `AZURE_CLIENT_SECRET` | The client secret's value |

| Variable | Value |
| --- | --- |
| `AZURE_SIGNING_ENDPOINT` | The account's endpoint URL |
| `AZURE_SIGNING_ACCOUNT` | The Trusted Signing account name |
| `AZURE_SIGNING_PROFILE` | The certificate profile name |

**Microsoft Store (optional).** With a Partner Center developer account
(partner.microsoft.com), create an app and submit it as an EXE/MSI app. The Store installs from
a URL: publish the drafted GitHub release, and give Partner Center the address of the
`Synergy_<version>_x64-setup.exe` asset. Each new version is a new submission with the new URL.

## Not covered yet

- **Mac App Store.** The macOS app ships as a notarized download (Developer ID). The Mac App
  Store also needs App Sandbox entitlements and a separate provisioning profile.
- **Linux stores** (Flathub, Snap Store). The `.deb`, `.rpm` and `.AppImage` on the GitHub
  release are not signed.
- **Automatic updates** for the desktop app, which need a separate update signing key.
