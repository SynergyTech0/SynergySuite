// Shapes shared by the server and the browser. Money is whole cents, time is whole minutes.

export type Status = "planning" | "active" | "on_hold" | "done" | "cancelled";
export const STATUSES: Status[] = ["planning", "active", "on_hold", "done", "cancelled"];
export const STATUS_LABELS: Record<Status, string> = {
  planning: "Planning", active: "Active", on_hold: "On hold", done: "Done", cancelled: "Cancelled",
};

/** Time and materials, a fixed fee, or not billed to a client at all. */
export type Billing = "time" | "fixed" | "none";
export const BILLINGS: Billing[] = ["time", "fixed", "none"];
export const BILLING_LABELS: Record<Billing, string> = { time: "Time and materials", fixed: "Fixed fee", none: "Not billed" };

export type Role = "manager" | "member";

export type EntryStatus = "draft" | "submitted" | "approved" | "rejected";

export const EXPENSE_CATEGORIES = ["Travel", "Lodging", "Meals", "Mileage", "Supplies", "Software", "Subcontractor", "Other"] as const;

export type Member = {
  email: string;
  role: Role;
  /** Rates are shown to managers only. */
  billRateCents?: number | null;
  costRateCents?: number | null;
  weeklyMinutes: number;
};

export type Project = {
  id: string;
  code: string;
  name: string;
  description: string;
  clientName: string;
  clientEmail: string;
  status: Status;
  billing: Billing;
  currency: string;
  start: string | null;
  finish: string | null;
  budgetMinutes: number | null;
  budgetCents: number | null;
  fixedFeeCents: number | null;
  defaultRateCents: number | null;
  plannerBoardId: string | null;
  myRole: Role;
  members: Member[];
  createdBy: string;
  createdAt: string;
};

export type ProjectSummary = {
  id: string;
  code: string;
  name: string;
  clientName: string;
  status: Status;
  myRole: Role;
  start: string | null;
  finish: string | null;
  percentDone: number;
  loggedMinutes: number;
  budgetMinutes: number | null;
  openTasks: number;
  lateTasks: number;
};

export type Task = {
  id: string;
  parentId: string | null;
  /** Outline number, e.g. "2.1". */
  wbs: string;
  depth: number;
  title: string;
  notes: string;
  start: string | null;
  finish: string | null;
  estimateMinutes: number | null;
  percentDone: number;
  assignedTo: string | null;
  milestone: boolean;
  billable: boolean;
  dependsOn: string[];
  plannerCardId: string | null;
  /** Has subtasks: its dates, estimate and progress roll up from them. */
  summary: boolean;
  loggedMinutes: number;
};

export type TimeEntry = {
  id: string;
  projectId: string;
  projectName: string;
  projectCode: string;
  taskId: string | null;
  taskTitle: string | null;
  person: string;
  day: string;
  minutes: number;
  notes: string;
  billable: boolean;
  status: EntryStatus;
  invoiced: boolean;
  rejectReason: string | null;
};

export type Expense = {
  id: string;
  projectId: string;
  projectName: string;
  projectCode: string;
  person: string;
  day: string;
  category: string;
  description: string;
  amountCents: number;
  currency: string;
  billable: boolean;
  status: EntryStatus;
  invoiced: boolean;
  rejectReason: string | null;
  receiptName: string | null;
};

export type Timer = {
  projectId: string;
  projectName: string;
  taskId: string | null;
  taskTitle: string | null;
  notes: string;
  startedAt: string;
};

/** A row of the week grid: one project and task, seven days. */
export type SheetRow = {
  projectId: string;
  projectName: string;
  projectCode: string;
  taskId: string | null;
  taskTitle: string | null;
  cells: (TimeEntry | null)[];
};

export type Timesheet = {
  week: string;
  days: string[];
  rows: SheetRow[];
  totalMinutes: number;
  /** Projects this person can log time on, with their tasks. */
  choices: { id: string; code: string; name: string; tasks: { id: string; title: string }[] }[];
};

export type InvoiceLine = { description: string; quantity: number; unitCents: number; amountCents: number; kind: "time" | "expense" | "fee" };

export type InvoiceRecord = {
  id: string;
  status: "pending" | "sent" | "recorded";
  booksNumber: string | null;
  booksUrl: string | null;
  throughDay: string;
  totalCents: number;
  currency: string;
  lines: InvoiceLine[];
  createdBy: string;
  createdAt: string;
};
