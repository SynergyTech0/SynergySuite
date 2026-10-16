"use client";
// Browser-side helpers and types shared by the HR screens.

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

export type Roles = { hrAdmin: boolean; payrollAdmin: boolean; manager: boolean };

export type Employee = {
  id: string; email: string; name: string; title?: string; department?: string; location?: string; manager_email: string; phone?: string;
  pronouns?: string; active?: boolean; start_date?: string | null; end_date?: string | null; employment_type?: string; pto_days_per_year?: number;
  sick_days_per_year?: number; emergency_contact?: string; personal_email?: string; home_address?: string; notes?: string;
  tier: "directory" | "team" | "self" | "hr";
};

export type Balance = { kind: "vacation" | "sick"; allowance: number; used: number; pending: number; remaining: number };

export type MeInfo = {
  email: string; name: string; roles: Roles; teamSize: number; employee: Employee | null; balances: Balance[] | null; openTasks: number;
  booksConnected: boolean;
};

export type TimeOff = {
  id: string; employee_email: string; employee_name: string; kind: string | null; start_date: string; end_date: string; days: number;
  note: string; status: string; decided_by: string | null; decided_at: string | null; decision_note: string; created_at: string;
};

export type Task = {
  id: string; checklist_id: string; title: string; owner: "employee" | "manager" | "hr"; assignee: string; due: string | null;
  done_at: string | null; done_by: string | null; employee_id: string; employee_name: string; kind: string;
};

export type Ctx = {
  me: MeInfo;
  people: Employee[];
  reloadMe: () => Promise<void>;
  reloadPeople: () => Promise<void>;
  openPerson: (id: string) => void;
  go: (tab: string) => void;
  toast: (msg: string) => void;
};

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
}

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const x = new Date(y, m - 1, d + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

/** "Oct 16" or "Oct 16, 2027" for another year. */
export function dayLabel(day: string | null | undefined): string {
  if (!day) return "";
  const [y, m, d] = day.split("-").map(Number);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (y !== new Date().getFullYear()) opts.year = "numeric";
  return new Date(y, m - 1, d).toLocaleDateString([], opts);
}

export function rangeLabel(a: string, b: string): string {
  return a === b ? dayLabel(a) : `${dayLabel(a)} to ${dayLabel(b)}`;
}

export function money(cents: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Math.round(cents ?? 0) / 100);
}

/** Cents as the plain dollars a form field shows. */
export function dollars(cents: number | null | undefined): string {
  return cents ? (cents / 100).toFixed(2) : "";
}

export const KIND_LABELS: Record<string, string> = { vacation: "Vacation", sick: "Sick", personal: "Personal", other: "Unpaid / other" };

export const EMPLOYMENT_LABELS: Record<string, string> = {
  full_time: "Full time", part_time: "Part time", contractor: "Contractor", intern: "Intern", temporary: "Temporary",
};

/** Reads a form into a plain object; checkboxes become booleans. */
export function formData(form: HTMLFormElement): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const el of Array.from(form.elements) as HTMLInputElement[]) {
    if (!el.name || el.disabled) continue;
    out[el.name] = el.type === "checkbox" ? el.checked : el.value;
  }
  return out;
}
