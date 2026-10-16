# Contributing

Thanks for helping build an open, self-hosted alternative to Microsoft 365. Bug reports, fixes, docs and new features are all welcome.

## Find something to work on

- Issues labelled **good first issue** are small and well described.
- For anything bigger than a bug fix, open an issue or a discussion first so we can agree on the approach before you write code.
- Report security problems privately as described in [SECURITY.md](SECURITY.md).

## Repository layout

| Path | What lives there |
|---|---|
| `apps/` | The core apps (mail, calendar, chat, meet, office, drive, forms, planner, photo, sites, notes) and the identity provider (`auth`) |
| `addons/` | Optional apps: sign, campaigns, portal, people |
| `packages/` | Shared code: `identity` (who is signed in), `db`, `server` (Express helpers), `config` (ports and app list), `shell` (the suite's top bar), `ai` (the bring-your-own-model setting) |
| `deploy/` | One-command self-hosting with Docker Compose, Caddy and oauth2-proxy |

New and migrated apps use the shared packages instead of their own auth, database setup or headers. Each app's README explains how to run it on its own and lists the settings it reads.

## Development setup

You need Node 22 and Docker.

```
npm install
npm run build:packages
npm run test:packages
```

Most apps need Postgres. The quickest way to get one is `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=dev postgres:16-alpine`; then pass it to each app as `DATABASE_URL`. Outside production, apps accept `DEV_USER_EMAIL` as the signed-in user, so you don't need the gateway locally.

## Pull requests

- Branch from `main` and keep each pull request to one change.
- Write TypeScript for new code.
- Run the checks CI runs for the parts you touched (`npm run test:packages`, and the app's own typecheck and tests).
- Explain what a user would notice before and after your change, and how you tested it.
- Don't commit secrets, `.env` files, personal hostnames or IP addresses. Configuration comes from environment variables, with examples in `.env.example` files.

## License

By contributing, you agree that your contributions are licensed under the [GNU Affero General Public License v3.0](LICENSE), the same license as the project.
