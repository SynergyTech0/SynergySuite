# Synergy Devices

Device management and endpoint security for the Synergy suite, the equivalent of Microsoft
Intune and Defender for Endpoint. Each Windows, macOS or Linux computer runs
[osquery](https://osquery.io), the open source endpoint agent (Apache-2.0 / GPL-2.0), and
Devices is its server over osquery's TLS remote API. osquery is installed from its own
releases; this app does not bundle or modify it.

iPhones, iPads and Macs can also be put under Apple device management, through
[NanoMDM](https://github.com/micromdm/nanomdm) and [micromdm/scep](https://github.com/micromdm/scep)
(both MIT, by the MicroMDM project), which run unmodified beside Devices as the
`devices-mdm` and `devices-scep` services.

## What it does

- **Inventory**: hardware, serial, OS and version, installed software, who signs in, last check-in.
- **Compliance policies**: disk encryption, firewall, antivirus, screen lock, system protection
  (SIP and Gatekeeper on macOS, UAC on Windows), automatic updates, minimum OS version, recent check-in, number
  of administrators, vulnerabilities and open threats. Every device gets compliant,
  non-compliant or unknown; a rule a platform can't report is not applicable.
- **Threat detections**: new listening ports, new persistence (services, launch agents, run
  keys, cron), programs running from temporary folders or deleted from disk, new SSH keys,
  new administrators, security settings turned off, and running programs matching your
  SHA-256 indicators. Alerts can be triaged, assigned, noted and (optionally) explained by
  the suite's AI model.
- **Vulnerabilities**: installed Ubuntu, Debian, Rocky and Alma packages checked against
  [OSV](https://osv.dev) every 12 hours, scored with CVSS v3.1.
- **Live queries**: run osquery SQL on chosen devices and see the answers as they arrive.
- **Apple device management**: remote lock (owners can lock their own lost device), erase,
  restart and shut down; configuration profiles (passcode, FileVault, firewall, software updates,
  Wi-Fi, restrictions, or an unsigned `.mobileconfig` of your own) kept current on every managed
  device; App Store apps and Mac `.pkg` installers, installed by admins or by people on their own
  devices, and optionally on every new device. iPhones and iPads report their passcode and data
  protection for compliance; a Mac that also runs osquery is one device, matched by serial number.
- **Android management** through Google's
  [Android Management API](https://developers.google.com/android/management): a work profile on
  personal phones (the organization never sees personal apps or data) or full management of
  company phones; remote lock, erase (on a personal phone only the work profile goes) and restart;
  passcode, Wi-Fi and restriction profiles; managed Google Play apps installed by admins or by
  people on their own phones. Phones report encryption, screen lock and Play Integrity for
  compliance.
- **Suite links**: search results and eDiscovery (devices and alerts per person) through the
  Admin center, and the `endpoint_compliance` and `endpoint_threats` evidence collectors in Trust.

People see and enroll their own computers. `DEVICES_ADMIN_EMAILS` (default `ADMIN_EMAILS`)
manage every device, policies, indicators, live queries and organization enrollment keys.

## Enrolling a computer

Open Devices, make a key and run the script it gives you after installing osquery. An
organization key is for rolling out with Intune, Jamf, Ansible or a login script; those devices
start without an owner and an admin assigns them.

The agent needs to reach `https://devices.<SUITE_DOMAIN>` (or `DEVICES_PUBLIC_HOST`). The
Caddyfile lets `/api/osquery/*` through without a suite sign-in; the agent authenticates with
its enrollment key and node key instead. If your certificates come from a private CA (the
quickstart's `local_certs`), put the CA certificate in `DEVICES_TLS_CA` so the scripts install it.

## Apple devices

1. Set `DEVICES_MDM_API_KEY`, `DEVICES_MDM_WEBHOOK_KEY` and `DEVICES_SCEP_CHALLENGE`
   (`openssl rand -hex 32` each; the quickstart fills them in). Until they are set the
   `devices-mdm` and `devices-scep` containers stay idle.
2. Get an Apple MDM push certificate: have a certificate signing request signed by an MDM vendor
   ([mdmcert.download](https://mdmcert.download) does this for free), upload it at
   [identity.apple.com](https://identity.apple.com) with a company Apple ID, and upload the
   certificate with its unencrypted private key in Devices › Apple devices. Renew it there
   every year with the same Apple ID; a new certificate means every device enrolls again.
3. People download an enrollment profile from My devices and install it on their iPhone, iPad
   or Mac. Admins can download an organization profile (devices start without an owner).

Devices must reach `https://devices.<SUITE_DOMAIN>` with a certificate they trust. The Caddyfile
sends `/mdm/apple/mdm` to NanoMDM and `/scep` to the SCEP server; NanoMDM's API and its webhook
to Devices (`/api/svc/apple/webhook`, signed with `DEVICES_MDM_WEBHOOK_KEY`) stay on the compose
network. Restart and shut down on iPhones and iPads need supervised devices; App Store installs
without an Apple ID prompt need Apple Business Manager licenses, which aren't supported yet.

## Android devices

1. In a Google Cloud project, turn on the Android Management API and make a service account
   with the Android Management User role. Download its JSON key and give it to Devices as
   `DEVICES_ANDROID_SERVICE_ACCOUNT` (the JSON on one line, or base64 of it).
2. In Devices › Android devices, choose Connect to Google and sign up with a Google account for
   the organization (it doesn't need Google Workspace). Google sends you back to Devices, which
   creates the organization's policy.
3. People get a one-time work profile link from My devices and open it on their phone. Admins
   enroll company phones from Android devices: factory reset the phone, tap its welcome screen six
   times and scan the QR code.

Commands and state go through Google, so phones need nothing installed and Devices needs no
public port for them. Devices reads phones back every 15 minutes (or on Sync now). Each phone
that has an app of its own gets its own policy; everything else comes from the shared one.

## Settings

| Variable | |
|---|---|
| `DATABASE_URL` | Postgres database (existing installs: `CREATE DATABASE devices;`) |
| `DEVICES_ADMIN_EMAILS` | Comma-separated admins; defaults to `ADMIN_EMAILS` |
| `DEVICES_PUBLIC_HOST` | Host agents connect to; default `devices.<SUITE_DOMAIN>` |
| `DEVICES_TLS_CA` | PEM CA certificate installed on agents for a private CA |
| `DEVICES_OSV_URL` | OSV API base (default `https://api.osv.dev`); `off` turns scanning off |
| `DEVICES_SVC_TOKEN` | Bearer token for `/api/svc/posture`, read by Trust |
| `DEVICES_AI_*` | Own AI model for alert explanations; defaults to the suite's `AI_*` |
| `DEVICES_MDM_URL` | NanoMDM's address (compose sets `http://devices-mdm:9000`) |
| `DEVICES_MDM_API_KEY` | NanoMDM's API key, shared with `devices-mdm` |
| `DEVICES_MDM_WEBHOOK_KEY` | Key NanoMDM signs its webhook with, shared with `devices-mdm` |
| `DEVICES_SCEP_CHALLENGE` | SCEP challenge put in enrollment profiles, shared with `devices-scep` |
| `DEVICES_ORG_NAME` | Organization name on management profiles and managed Google Play (default `Synergy`) |
| `DEVICES_ANDROID_SERVICE_ACCOUNT` | Google Cloud service account key (JSON or base64) for the Android Management API |

## Not yet

Windows device management (lock, wipe, settings and apps on Windows) and blocking sign-in from
non-compliant devices are the next milestones. Android zero-touch enrollment and private Play
apps aren't supported yet. Apple Business Manager
(automated enrollment and app licenses) isn't supported yet. Retiring a computer stops it
reporting; it doesn't uninstall osquery.

## Development

```sh
npm run dev --workspace apps/devices     # http://localhost:3810
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/devices_test npm test --workspace apps/devices
```
