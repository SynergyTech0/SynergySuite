# Security

## Reporting a vulnerability

Please report security problems privately, not in a public issue. Use **Report a vulnerability** under this repository's **Security** tab. Include what you found, which app or package it is in, and how to reproduce it.

We aim to acknowledge reports within a few days and will keep you updated until a fix ships. We are happy to credit you in the release notes unless you would rather stay anonymous.

## Supported versions

Only the latest release and the `main` branch receive security fixes until the project reaches 1.0.

## How the suite is meant to be deployed

Most security assumptions live in the gateway described in [deploy/README.md](deploy/README.md):

- Only Caddy has open web ports. It strips identity headers from incoming requests and asks oauth2-proxy who is signed in.
- Apps trust identity headers only when the request also carries `PROXY_SHARED_SECRET`, so exposing an app port directly, or leaking that secret, bypasses sign-in.
- Mail's service login can open any mailbox. Keep `MAIL_MASTER_PASSWORD` and `STALWART_ADMIN_PASSWORD` secret, and keep Stalwart's admin port (8080) off the internet.

Reports about deployments that break these assumptions are still welcome when the docs make the unsafe setup look safe.
