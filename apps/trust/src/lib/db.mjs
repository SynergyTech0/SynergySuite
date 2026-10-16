// Database connections.
//
// Two distinct roles, deliberately:
//
//   adminSql() - connects as the owner (superuser in the local container). Runs DDL and
//                tenant provisioning. BYPASSES row-level security.
//   appSql()   - what request handling must use. Non-owner, non-superuser, so RLS applies.
//
// Using adminSql() to serve a request would silently disable tenant isolation while every
// query still returned rows - no error, just more data than the caller should see. That is
// the failure mode RLS exists to prevent, so the two are kept separate at the module level
// rather than being one configurable connection.

import postgres from 'postgres';

// Read when a connection is made, not at import: `next build` imports this module to
// collect page data and must not need a database to do so.
export function adminSql(opts = {}) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. See .env.example.');
    process.exit(1);
  }
  return postgres(url, { onnotice: () => {}, ...opts });
}

// Opens a transaction pinned to one tenant. Every statement runs as strust_app with
// app.tenant_id set, so a query that forgets its tenant predicate returns nothing
// rather than everything.
//
// `readOnly` is for auditor and viewer seats, and is enforced twice: a Postgres role holding
// only SELECT grants, plus a read-only transaction. Neither depends on the application
// remembering to disable a button. An auditor's seat being read-only is a claim we make to
// our customers' auditors, so it is worth more than one layer.
//
// SET LOCAL reverts at COMMIT or ROLLBACK, so a pooled connection never carries a role or a
// tenant id into the next request.
export async function withTenant(sql, tenantId, fn, opts = {}) {
  return sql.begin(async (tx) => {
    // Role names cannot be parameterised; both branches are compile-time literals.
    if (opts.readOnly) {
      await tx`SET LOCAL ROLE strust_app_ro`;
      await tx`SET TRANSACTION READ ONLY`;
    } else {
      await tx`SET LOCAL ROLE strust_app`;
    }
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}
