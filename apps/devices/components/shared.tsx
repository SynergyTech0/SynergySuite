"use client";
// Pieces several Devices screens use.
import type { Route, View } from "./client";

export type Me = { email: string; name: string; role: "admin" | "user"; ai: boolean };

export type AppCtx = {
  me: Me;
  go: (r: Partial<Route> & { view: View }) => void;
  say: (text: string) => void;
};

export const PLATFORM: Record<string, string> = { windows: "Windows", darwin: "macOS", linux: "Linux", ios: "iPhone and iPad" };

export function Badge({ tone = "", children }: { tone?: string; children: React.ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Severity({ level }: { level: string }) {
  return <span className={`sev ${level}`}>{level}</span>;
}

const COMPLIANCE: Record<string, [string, string]> = {
  compliant: ["green", "Compliant"],
  noncompliant: ["red", "Not compliant"],
  unknown: ["gray", "Not evaluated"],
};

export function ComplianceBadge({ state }: { state: string }) {
  const [tone, label] = COMPLIANCE[state] ?? ["gray", state];
  return <Badge tone={tone}>{label}</Badge>;
}

export const STATUS_LABEL: Record<string, string> = { new: "New", investigating: "Investigating", resolved: "Resolved", dismissed: "Dismissed" };
const STATUS_TONE: Record<string, string> = { new: "red", investigating: "amber", resolved: "green", dismissed: "gray" };
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status] ?? status}</Badge>;
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

export function OnOff({ v }: { v: boolean | null | undefined }) {
  if (v === true) return <Badge tone="green">On</Badge>;
  if (v === false) return <Badge tone="red">Off</Badge>;
  return <span className="muted">Not reported</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}
