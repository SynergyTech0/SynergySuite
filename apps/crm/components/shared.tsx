"use client";
// Pieces several CRM screens use: badges, avatars, the owner picker.
import { label, type Ctx, type Member } from "@/lib/types";
import { hue, initials } from "./client";

/** What every screen gets from the app: who you are, who else is here, and how to move around. */
export type AppCtx = {
  me: Ctx;
  members: Member[];
  ai: boolean;
  go: (view: import("./client").View, id?: string | null) => void;
  say: (text: string) => void;
  /** Bumped when something changed that other screens show (counts, lists). */
  changed: () => void;
  version: number;
};

const TONE: Record<string, string> = {
  new: "blue", working: "amber", nurturing: "purple", qualified: "green", unqualified: "", converted: "green",
  prospect: "blue", customer: "green", partner: "purple", competitor: "red", other: "",
  prospecting: "", qualification: "blue", proposal: "purple", negotiation: "amber", closed_won: "green", closed_lost: "red",
  admin: "purple", manager: "blue", rep: "",
};

export function Badge({ value }: { value: string }) {
  return <span className={`badge ${TONE[value] ?? ""}`}>{label(value)}</span>;
}

export function Score({ value }: { value: number | null }) {
  if (value === null) return null;
  const tone = value >= 70 ? "hot" : value >= 40 ? "warm" : "cold";
  return <span className={`score ${tone}`} title={`Lead score ${value} of 100`}>{value}</span>;
}

export function Avatar({ name, square, big }: { name: string; square?: boolean; big?: boolean }) {
  const h = hue(name);
  return (
    <span className={`avatar${square ? " square" : ""}${big ? " big" : ""}`} style={{ background: `hsl(${h} 70% 92%)`, color: `hsl(${h} 55% 32%)` }} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function canReassign(me: Ctx): boolean {
  return me.role === "admin" || me.role === "manager";
}

/** Owner choice; only managers and admins see it, since reps always own what they create. */
export function OwnerField({ app, value, name = "owner", text = "Owner" }: { app: AppCtx; value: string; name?: string; text?: string }) {
  if (!canReassign(app.me)) return null;
  const list = app.members.some((m) => m.email === value) ? app.members : [...app.members, { email: value, name: value, role: "rep" as const, lastSeen: "" }];
  return (
    <label>
      <span>{text}</span>
      <select name={name} defaultValue={value} aria-label={text}>
        {list.map((m) => (
          <option key={m.email} value={m.email}>
            {m.name || m.email}{m.email === app.me.email ? " (you)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="facts">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v === "" || v === null || v === undefined ? <span className="muted">—</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Reads a form into a plain object of strings (and booleans for checkboxes). */
export function formData(form: HTMLFormElement): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const el of Array.from(form.elements) as HTMLInputElement[]) {
    if (!el.name) continue;
    out[el.name] = el.type === "checkbox" ? el.checked : el.value;
  }
  return out;
}
