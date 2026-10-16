import { record } from "./audit";
import { configuredAdmins, type Role } from "./access";
import { q, tx } from "./db";
import type { Me } from "./types";
import { UserError, cleanEmail } from "./util";

/** Roles granted here. Admins themselves come from ADMIN_EMAILS and aren't stored. */

export type Grant = { email: string; role: Role; grantedBy: string; grantedAt: string };

export async function list(): Promise<{ admins: ReturnType<typeof configuredAdmins>; grants: Grant[] }> {
  const rows = await q<{ email: string; role: Role; granted_by: string; granted_at: Date }>(`SELECT * FROM roles ORDER BY email`);
  return {
    admins: configuredAdmins(),
    grants: rows.map((r) => ({ email: r.email, role: r.role, grantedBy: r.granted_by, grantedAt: r.granted_at.toISOString() })),
  };
}

export async function grant(me: Me, v: { email?: unknown; role?: unknown }): Promise<Grant> {
  const email = cleanEmail(v.email);
  if ((v.role ?? "ediscovery") !== "ediscovery") throw new UserError("Admins are set with ADMIN_EMAILS; here you can make someone an eDiscovery manager");
  if (configuredAdmins().emails.includes(email)) throw new UserError("That person is already an admin");
  return tx(async (tq) => {
    const [r] = await tq<{ email: string; role: Role; granted_by: string; granted_at: Date }>(
      `INSERT INTO roles (email, role, granted_by) VALUES ($1, 'ediscovery', $2)
       ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role RETURNING *`,
      [email, me.email],
    );
    await record(me.email, "role.grant", email, { role: "ediscovery" }, tq);
    return { email: r.email, role: r.role, grantedBy: r.granted_by, grantedAt: r.granted_at.toISOString() };
  });
}

export async function revoke(me: Me, emailIn: string): Promise<void> {
  const email = cleanEmail(emailIn);
  await tx(async (tq) => {
    const rows = await tq(`DELETE FROM roles WHERE email = $1 RETURNING role`, [email]);
    if (!rows.length) throw new UserError("That person has no role here", 404);
    await record(me.email, "role.revoke", email, { role: "ediscovery" }, tq);
  });
}
