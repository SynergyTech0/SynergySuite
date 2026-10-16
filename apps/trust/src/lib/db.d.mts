// Type declarations for db.mjs.
//
// The runtime module stays plain ESM because the migration, seed, collection and
// verification scripts import it directly under bare `node`, and that code path is already
// proven. Declaring its shape here lets the TypeScript app consume the same module rather
// than keeping a second copy of the connection logic - duplicating the RLS helper would mean
// two places to get tenant isolation wrong.

import type { Sql, TransactionSql } from 'postgres';

/**
 * Owner connection. Runs DDL and tenant provisioning, and BYPASSES row-level security.
 * Never use this to serve a request: every query would still return rows, just more of
 * them than the caller is entitled to.
 */
export function adminSql(opts?: Record<string, unknown>): Sql;

/**
 * Runs `fn` in a transaction pinned to one tenant: role `strust_app` with `app.tenant_id`
 * set, so RLS applies and a query missing its tenant predicate returns nothing.
 */
export function withTenant<T>(
  sql: Sql,
  tenantId: string,
  fn: (tx: TransactionSql) => Promise<T>,
  opts?: { readOnly?: boolean },
): Promise<T>;
