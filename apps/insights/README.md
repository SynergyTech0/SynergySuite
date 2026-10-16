# Synergy Insights

The suite's Power BI equivalent: dashboards and reports over the business data in Books, CRM, Desk, Base and the other apps.

Insights is a thin Next.js app around [Metabase](https://github.com/metabase/metabase), the open source business intelligence tool (AGPL edition, unmodified). Metabase is the report designer and draws the charts; Insights adds the suite around it:

- **Sign-in bridge** (`lib/bridge.ts`, `app/api/studio/*`). Metabase's open source edition can't take the suite's sign-in, so Insights makes each person's Metabase account, signs them in with a password derived from `INSIGHTS_SECRET` that nobody types, and sets Metabase's session cookie. Caddy asks `/api/studio/check` before every designer request whether that session belongs to the person signed in to the suite.
- **Read-only sources** (`lib/sources.ts`). One Postgres role gets `SELECT` on each source table, column by column where a table has columns named like secrets, and is read-only by default. Metabase connects as that role.
- **Dashboards in the suite** (`app/page.tsx`, `app/d/[id]`). The dashboards a person can open in Metabase, shown with Metabase's static embedding, signed only after Metabase confirms they can open the dashboard.
- **Suite search** (`app/api/search`): dashboards and saved questions by name, description and collection.

See "Insights" in `deploy/README.md` for settings.

## Develop

Run Metabase (`docker run -p 3000:3000 metabase/metabase:v0.64.2.7`) and Postgres, then:

```
METABASE_INTERNAL_URL=http://localhost:3000 INSIGHTS_SECRET=dev INSIGHTS_PG_URL=postgres://postgres:postgres@localhost:5432 \
  INSIGHTS_PG_HOST=host.docker.internal DEV_USER_EMAIL=you@example.com ADMIN_EMAILS=you@example.com npm run dev
```

Tests: `npm test`. With `TEST_DATABASE_URL` the source grants are checked against Postgres; with `METABASE_TEST_URL` too (a fresh Metabase, and `books` and `crm` databases holding an `"Invoice"` and a `"User"` table) the whole flow runs against Metabase (`test/metabase.live.test.ts`).
