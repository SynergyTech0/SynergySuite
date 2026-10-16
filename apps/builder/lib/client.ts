"use client";
/**
 * The browser side of the Builder API, and the data adapter a running app uses: its records
 * come from Base through /api/apps/<id>/data/<tableId>, as the person using the app.
 */
import type { AppDetail, AppSummary, Member } from "./apps";
import { FxObject, type Rec, type Value } from "./fx";
import type { DataSource } from "./model";
import type { BaseRow } from "./records";
import type { DataAdapter } from "./runtime";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: init.body === undefined ? undefined : { "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError((data as { error?: string } | null)?.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export type { AppDetail, AppSummary, Member };

/** Converts a formula value for JSON (dates as ISO text, tables and records as they are). */
function plain(v: Value): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (v instanceof FxObject) return v.name;
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Rec).map(([k, x]) => [k, plain(x)]));
  }
  return v;
}

/** A JSON value from a flow as a formula value: objects become records, arrays tables. */
function fromJson(v: unknown): Value {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map((x) => {
    const y = fromJson(x);
    return y && typeof y === "object" && !Array.isArray(y) && !(y instanceof Date) ? y : { Value: y };
  });
  if (typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, fromJson(x)]));
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  return String(v);
}

export function browserAdapter(appId: string): DataAdapter & { truncated: Set<string> } {
  const url = (ds: DataSource) => `/api/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(ds.tableId)}`;
  const truncated = new Set<string>();
  return {
    truncated,
    async list(ds) {
      const r = await api<{ rows: BaseRow[]; more: boolean }>(url(ds));
      if (r.more) truncated.add(ds.name);
      else truncated.delete(ds.name);
      return r.rows;
    },
    async create(ds, values) {
      return (await api<{ row: BaseRow }>(url(ds), { method: "POST", body: { values } })).row;
    },
    async update(ds, id, values) {
      return (await api<{ row: BaseRow }>(url(ds), { method: "PATCH", body: { id, values } })).row;
    },
    async remove(ds, ids) {
      await api(url(ds), { method: "DELETE", body: { ids } });
    },
    async runFlow(flow, inputs) {
      const r = await api<{ runId: string; status: string; outputs: Record<string, unknown> | null }>(`/api/apps/${encodeURIComponent(appId)}/flows`, {
        body: { flow, inputs: plain(inputs) },
      });
      return { RunId: r.runId, Status: r.status, ...((fromJson(r.outputs ?? {}) as Rec) ?? {}) };
    },
  };
}
