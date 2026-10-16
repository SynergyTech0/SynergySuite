import { audit, q } from "./db";
import type { AlertDraft } from "./detections";
import { cleanEmail, text, UserError, uuid } from "./util";

export type AlertStatus = "new" | "investigating" | "resolved" | "dismissed";
export const STATUSES: AlertStatus[] = ["new", "investigating", "resolved", "dismissed"];
const OPEN = `('new', 'investigating')`;

/** Opens an alert per draft, or counts another occurrence of one already open. Returns how many are new. */
export async function raise(deviceId: string, drafts: AlertDraft[]): Promise<number> {
  let opened = 0;
  for (const d of drafts) {
    const [row] = await q<{ id: string; fresh: boolean }>(
      `INSERT INTO alerts (device_id, detection, severity, title, detail, fingerprint)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (device_id, fingerprint) WHERE status IN ${OPEN}
       DO UPDATE SET occurrences = alerts.occurrences + 1, last_seen = now()
       RETURNING id, (xmax = 0) AS fresh`,
      [deviceId, d.detection, d.severity, d.title.slice(0, 300), JSON.stringify(d.detail), d.fingerprint],
    );
    if (row?.fresh) {
      opened++;
      await q(`INSERT INTO alert_events (alert_id, actor, action) VALUES ($1, 'Devices', 'raised')`, [row.id]);
    }
  }
  return opened;
}

export type AlertRow = {
  id: string; device_id: string; hostname: string; owner: string | null; detection: string; severity: string; title: string;
  detail: Record<string, unknown>; status: AlertStatus; assigned_to: string | null; occurrences: number;
  created_at: Date; last_seen: Date; closed_at: Date | null; closed_by: string | null;
};

const SELECT = `SELECT a.id, a.device_id, d.hostname, d.owner, a.detection, a.severity, a.title, a.detail, a.status, a.assigned_to,
  a.occurrences, a.created_at, a.last_seen, a.closed_at, a.closed_by FROM alerts a JOIN devices d ON d.id = a.device_id`;

export async function listAlerts(f: { status?: string; severity?: string; device?: string; owner?: string; limit?: number }): Promise<AlertRow[]> {
  const status = f.status === "open" || !f.status ? null : f.status;
  if (status && status !== "all" && !STATUSES.includes(status as AlertStatus)) throw new UserError("Unknown status");
  return q<AlertRow>(
    `${SELECT}
     WHERE ($1::text IS NULL AND a.status IN ${OPEN} OR $1 = 'all' OR a.status = $1)
       AND ($2::text IS NULL OR a.severity = $2)
       AND ($3::uuid IS NULL OR a.device_id = $3)
       AND ($4::text IS NULL OR d.owner = $4)
     ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, a.last_seen DESC
     LIMIT $5`,
    [status, f.severity || null, f.device ? uuid(f.device, "device") : null, f.owner ?? null, Math.min(f.limit ?? 200, 500)],
  );
}

export async function getAlert(id: string): Promise<AlertRow & { events: { actor: string; action: string; note: string; at: Date }[] }> {
  const [a] = await q<AlertRow>(`${SELECT} WHERE a.id = $1`, [uuid(id, "alert")]);
  if (!a) throw new UserError("No such alert", 404);
  const events = await q<{ actor: string; action: string; note: string; at: Date }>(
    `SELECT actor, action, note, at FROM alert_events WHERE alert_id = $1 ORDER BY at, id`,
    [a.id],
  );
  return { ...a, events };
}

export async function updateAlert(actor: string, id: string, v: { status?: unknown; assignedTo?: unknown; note?: unknown }): Promise<void> {
  const a = await getAlert(id);
  const note = text(v.note, 4000);
  if (v.status !== undefined) {
    const status = String(v.status) as AlertStatus;
    if (!STATUSES.includes(status)) throw new UserError("Unknown status");
    if (status !== a.status) {
      const closing = status === "resolved" || status === "dismissed";
      try {
        await q(
          `UPDATE alerts SET status = $2, updated_at = now(), closed_at = CASE WHEN $3 THEN now() ELSE NULL END, closed_by = CASE WHEN $3 THEN $4 ELSE NULL END WHERE id = $1`,
          [a.id, status, closing, actor],
        );
      } catch (err) {
        // Reopening while the same thing has been raised again since: that one is the open alert now.
        if ((err as { code?: string }).code === "23505") throw new UserError("The same alert is already open again on this device; work on that one", 409);
        throw err;
      }
      await q(`INSERT INTO alert_events (alert_id, actor, action, note) VALUES ($1, $2, $3, $4)`, [a.id, actor, `status:${status}`, note]);
    }
  }
  if (v.assignedTo !== undefined) {
    const to = v.assignedTo === null || v.assignedTo === "" ? null : cleanEmail(v.assignedTo);
    if (to !== a.assigned_to) {
      await q(`UPDATE alerts SET assigned_to = $2, updated_at = now() WHERE id = $1`, [a.id, to]);
      await q(`INSERT INTO alert_events (alert_id, actor, action, note) VALUES ($1, $2, $3, '')`, [a.id, actor, to ? `assigned:${to}` : "unassigned"]);
    }
  }
  if (v.status === undefined && note) {
    await q(`INSERT INTO alert_events (alert_id, actor, action, note) VALUES ($1, $2, 'comment', $3)`, [a.id, actor, note]);
  }
  await audit(actor, "alert.update", a.id, { status: v.status, assignedTo: v.assignedTo });
}
