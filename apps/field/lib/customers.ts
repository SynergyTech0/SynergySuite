import { holdChecker } from "./compliance";
import { q } from "./db";
import { requireDispatcher, requireStaff } from "./staff";
import { UserError, isEmail, text, uuidish } from "./util";

/**
 * Customers and the equipment at their sites. Everyone on the team can look them up (a technician
 * needs the address and the history of the unit in front of them); dispatchers change them.
 */
export type Customer = { id: string; name: string; email: string; phone: string; address: string; notes: string; assetCount: number; openJobs: number };

export type Asset = {
  id: string; customerId: string; customerName: string; name: string; make: string; model: string; serial: string; location: string;
  installedOn: string | null; warrantyUntil: string | null; underWarranty: boolean; opsTag: string | null; notes: string;
};

type CustomerRow = { id: string; name: string; email: string; phone: string; address: string; notes: string; asset_count: number; open_jobs: number };
type AssetRow = {
  id: string; customer_id: string; customer_name: string; name: string; make: string; model: string; serial: string; location: string;
  installed_on: string | null; warranty_until: string | null; under_warranty: boolean; ops_tag: string | null; notes: string;
};

const CUSTOMER_COLS = `c.id, c.name, c.email, c.phone, c.address, c.notes,
  (SELECT count(*)::int FROM assets a WHERE a.customer_id = c.id AND a.held_deleted_at IS NULL) AS asset_count,
  (SELECT count(*)::int FROM work_orders w WHERE w.customer_id = c.id AND w.held_deleted_at IS NULL AND w.status NOT IN ('completed', 'cancelled')) AS open_jobs`;

const ASSET_COLS = `a.id, a.customer_id, c.name AS customer_name, a.name, a.make, a.model, a.serial, a.location,
  to_char(a.installed_on, 'YYYY-MM-DD') AS installed_on, to_char(a.warranty_until, 'YYYY-MM-DD') AS warranty_until,
  COALESCE(a.warranty_until >= CURRENT_DATE, false) AS under_warranty, a.ops_tag, a.notes`;

function toCustomer(r: CustomerRow): Customer {
  return { id: r.id, name: r.name, email: r.email, phone: r.phone, address: r.address, notes: r.notes, assetCount: r.asset_count, openJobs: r.open_jobs };
}

export function toAsset(r: AssetRow): Asset {
  return {
    id: r.id, customerId: r.customer_id, customerName: r.customer_name, name: r.name, make: r.make, model: r.model, serial: r.serial,
    location: r.location, installedOn: r.installed_on, warrantyUntil: r.warranty_until, underWarranty: r.under_warranty, opsTag: r.ops_tag, notes: r.notes,
  };
}

function like(s: string): string {
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function listCustomers(me: string, search = ""): Promise<Customer[]> {
  await requireStaff(me);
  const s = text(search, 200);
  const rows = await q<CustomerRow>(
    `SELECT ${CUSTOMER_COLS} FROM customers c WHERE c.held_deleted_at IS NULL
       AND ($1 = '' OR c.name ILIKE $2 OR c.email ILIKE $2 OR c.address ILIKE $2 OR c.phone ILIKE $2)
     ORDER BY lower(c.name) LIMIT 500`,
    [s, like(s)],
  );
  return rows.map(toCustomer);
}

export async function getCustomer(me: string, id: string): Promise<Customer & { assets: Asset[] }> {
  await requireStaff(me);
  if (!uuidish(id)) throw new UserError("That customer doesn't exist", 404);
  const [r] = await q<CustomerRow>(`SELECT ${CUSTOMER_COLS} FROM customers c WHERE c.id = $1 AND c.held_deleted_at IS NULL`, [id]);
  if (!r) throw new UserError("That customer doesn't exist", 404);
  const assets = await q<AssetRow>(
    `SELECT ${ASSET_COLS} FROM assets a JOIN customers c ON c.id = a.customer_id WHERE a.customer_id = $1 AND a.held_deleted_at IS NULL ORDER BY lower(a.name)`,
    [id],
  );
  return { ...toCustomer(r), assets: assets.map(toAsset) };
}

function customerFields(b: Record<string, unknown>) {
  const name = text(b.name, 200);
  if (!name) throw new UserError("Give the customer a name");
  const email = text(b.email, 200).toLowerCase();
  if (email && !isEmail(email)) throw new UserError("That email address doesn't look right");
  return [name, email, text(b.phone, 60), text(b.address, 500), text(b.notes, 4000)];
}

export async function saveCustomer(me: string, id: string | null, b: Record<string, unknown>): Promise<Customer> {
  await requireDispatcher(me);
  const f = customerFields(b);
  if (!id) {
    const [r] = await q<{ id: string }>(
      "INSERT INTO customers (name, email, phone, address, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
      [...f, me],
    );
    id = r.id;
  } else {
    if (!uuidish(id)) throw new UserError("That customer doesn't exist", 404);
    const rows = await q(
      `UPDATE customers SET name = $2, email = $3, phone = $4, address = $5, notes = $6, modified_at = now()
       WHERE id = $1 AND held_deleted_at IS NULL RETURNING id`,
      [id, ...f],
    );
    if (!rows.length) throw new UserError("That customer doesn't exist", 404);
  }
  return getCustomer(me, id);
}

/** The customer with this email, or a new one made from the name. Used for cases from Desk. */
export async function customerForEmail(me: string, email: string, name: string): Promise<string> {
  const e = email.trim().toLowerCase();
  if (e) {
    const [r] = await q<{ id: string }>(
      "SELECT id FROM customers WHERE lower(email) = $1 AND held_deleted_at IS NULL ORDER BY created_at LIMIT 1",
      [e],
    );
    if (r) return r.id;
  }
  const [r] = await q<{ id: string }>(
    "INSERT INTO customers (name, email, created_by) VALUES ($1, $2, $3) RETURNING id",
    [text(name, 200) || e || "New customer", isEmail(e) ? e : "", me],
  );
  return r.id;
}

/**
 * Deletes a customer with no work orders. Under a legal hold on whoever made it, it is only
 * hidden, so eDiscovery still finds it.
 */
export async function deleteCustomer(me: string, id: string): Promise<void> {
  await requireDispatcher(me);
  if (!uuidish(id)) throw new UserError("That customer doesn't exist", 404);
  const [c] = await q<{ created_by: string; jobs: number }>(
    `SELECT created_by, (SELECT count(*)::int FROM work_orders w WHERE w.customer_id = c.id) AS jobs
     FROM customers c WHERE id = $1 AND held_deleted_at IS NULL`,
    [id],
  );
  if (!c) throw new UserError("That customer doesn't exist", 404);
  if (c.jobs > 0) throw new UserError("This customer has work orders, so it stays on record", 409);
  const held = holdChecker();
  const makers = [c.created_by, ...(await q<{ created_by: string }>("SELECT DISTINCT created_by FROM assets WHERE customer_id = $1", [id])).map((a) => a.created_by)];
  for (const who of makers) {
    if (await held(who)) {
      await q("UPDATE customers SET held_deleted_at = now() WHERE id = $1", [id]);
      await q("UPDATE assets SET held_deleted_at = now() WHERE customer_id = $1 AND held_deleted_at IS NULL", [id]);
      return;
    }
  }
  await q("DELETE FROM customers WHERE id = $1", [id]);
}

function day(v: unknown, what: string): string | null {
  const s = text(v, 10);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new UserError(`${what} must be a date`);
  return s;
}

export async function getAsset(me: string, id: string): Promise<Asset> {
  await requireStaff(me);
  if (!uuidish(id)) throw new UserError("That asset doesn't exist", 404);
  const [r] = await q<AssetRow>(`SELECT ${ASSET_COLS} FROM assets a JOIN customers c ON c.id = a.customer_id WHERE a.id = $1 AND a.held_deleted_at IS NULL`, [id]);
  if (!r) throw new UserError("That asset doesn't exist", 404);
  return toAsset(r);
}

export async function saveAsset(me: string, id: string | null, b: Record<string, unknown>): Promise<Asset> {
  await requireDispatcher(me);
  const name = text(b.name, 200);
  if (!name) throw new UserError("Give the asset a name");
  const f = [name, text(b.make, 120), text(b.model, 120), text(b.serial, 120), text(b.location, 300), day(b.installedOn, "Installed"), day(b.warrantyUntil, "Warranty"), text(b.notes, 4000)];
  if (!id) {
    const customerId = String(b.customerId ?? "");
    if (!uuidish(customerId)) throw new UserError("Pick a customer");
    const [c] = await q("SELECT 1 FROM customers WHERE id = $1 AND held_deleted_at IS NULL", [customerId]);
    if (!c) throw new UserError("That customer doesn't exist", 404);
    const opsTag = text(b.opsTag, 80) || null;
    const [r] = await q<{ id: string }>(
      `INSERT INTO assets (customer_id, name, make, model, serial, location, installed_on, warranty_until, notes, ops_tag, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [customerId, ...f, opsTag, me],
    );
    id = r.id;
  } else {
    if (!uuidish(id)) throw new UserError("That asset doesn't exist", 404);
    const rows = await q(
      `UPDATE assets SET name = $2, make = $3, model = $4, serial = $5, location = $6, installed_on = $7, warranty_until = $8, notes = $9, modified_at = now()
       WHERE id = $1 AND held_deleted_at IS NULL RETURNING id`,
      [id, ...f],
    );
    if (!rows.length) throw new UserError("That asset doesn't exist", 404);
  }
  return getAsset(me, id);
}

export async function deleteAsset(me: string, id: string): Promise<void> {
  await requireDispatcher(me);
  if (!uuidish(id)) throw new UserError("That asset doesn't exist", 404);
  const [a] = await q<{ created_by: string }>("SELECT created_by FROM assets WHERE id = $1 AND held_deleted_at IS NULL", [id]);
  if (!a) throw new UserError("That asset doesn't exist", 404);
  // Work orders keep their history; held_deleted_at hides it everywhere but eDiscovery.
  if (await holdChecker()(a.created_by)) await q("UPDATE assets SET held_deleted_at = now() WHERE id = $1", [id]);
  else await q("DELETE FROM assets WHERE id = $1", [id]);
}
