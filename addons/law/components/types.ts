export type Me = { email: string; name: string };

export type Jurisdiction = {
  code: string; name: string; depositDays: number; reconcileDays: number; retentionYears: number; writtenFeeOver: number | null;
  maxContingencyPct: number | null; contingencyInWriting: boolean; citation: string; url: string;
};

export type Preset = { id: string; label: string; days: number; count: "calendar" | "court"; basis: string };

export type AppInfo = {
  email: string; name: string; admin: boolean; trustKeeper: boolean; ai: boolean; books: boolean; practiceAreas: string[];
  feeTypes: string[]; partyRoles: string[]; teamRoles: string[]; jurisdictions: Jurisdiction[]; presets: Preset[];
};

export type MatterSummary = {
  id: string; number: string; title: string; client_id: string; client_name: string; practice_area: string; jurisdiction: string;
  court: string; case_number: string; status: string; fee_type: string; responsible: string; opened_on: string;
  next_deadline: string | null; unbilled_cents: string; trust_cents: string;
};

export type Check = { level: "warn" | "ok"; rule: string; message: string; citation: string; url: string };

export type Brief = {
  caseName: string; caseNumber: string; court: string; judge: string; parties: { name: string; role: string }[]; claims: string[];
  status: string; keyIssues: string[]; summary: string; timeline: { date: string; event: string }[]; nextSteps: string[]; at?: string; documents?: number;
};

export type Matter = MatterSummary & {
  description: string; rate_cents: string | null; flat_cents: string | null; contingency_pct: string | null; currency: string;
  engagement_signed_on: string | null; closed_on: string | null; created_by: string; role: string;
  people: { email: string; role: string; rate_cents: string | null; added_by: string; added_at: string }[];
  parties: { id: string; name: string; kind: string; role: string; notes: string; added_by: string }[];
  events: { kind: string; detail: string; actor: string; at: string }[];
  conflictChecks: { id: string; names: string[]; hits: number; decision: string; note: string; checked_by: string; checked_at: string }[];
  billedCents: number; trustCents: number; rules: Check[]; brief: Brief | null;
};

export type Deadline = {
  id: string; matter_id: string; number: string; matter_title: string; title: string; due_day: string; basis: string;
  assignee: string | null; done_at: string | null; done_by: string | null; days_left: number;
};

export type Hit = {
  query: string; name: string; score: number; source: "client" | "party"; role: string; clientId: string; clientName: string;
  matterId: string | null; matterNumber: string | null; matterTitle: string | null; matterStatus: string | null; responsible: string | null;
};

export type CheckResult = {
  id: string; names: string[]; decision: string; threshold: number; hits: Hit[];
  clientMatters: Record<string, { id: string; number: string; title: string; status: string; responsible: string }[]>;
};
