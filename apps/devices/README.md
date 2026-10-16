# Synergy Devices

Device management and endpoint security for the Synergy suite, the equivalent of Microsoft
Intune and Defender for Endpoint. Each Windows, macOS or Linux computer runs
[osquery](https://osquery.io), the open source endpoint agent (Apache-2.0 / GPL-2.0), and
Devices is its server over osquery's TLS remote API. osquery is installed from its own
releases; this app does not bundle or modify it.

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

## Not yet

osquery only reads, so there is no remote lock or wipe, no pushing settings or apps, and no
blocking of sign-in from non-compliant devices. Those need an MDM channel (Apple MDM,
Windows MDM) and are planned for a later milestone. Retiring a device stops it reporting;
it doesn't uninstall osquery.

## Development

```sh
npm run dev --workspace apps/devices     # http://localhost:3760
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/devices_test npm test --workspace apps/devices
```
