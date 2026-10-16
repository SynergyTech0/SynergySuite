// Shapes shared by the server and the browser.

export type Repeat = "daily" | "weekdays" | "weekly" | "monthly" | "yearly";
export const REPEATS: Repeat[] = ["daily", "weekdays", "weekly", "monthly", "yearly"];
export const COLORS = ["blue", "green", "red", "orange", "purple", "teal", "pink", "gray"] as const;
export type Color = (typeof COLORS)[number];

export type Step = { id: string; title: string; done: boolean };

export type Task = {
  id: string;
  listId: string;
  listName: string;
  title: string;
  notes: string;
  important: boolean;
  due: string | null; // YYYY-MM-DD
  reminderAt: string | null;
  repeat: Repeat | null;
  assignedTo: string | null;
  myDay: boolean;
  completedAt: string | null;
  completedBy: string | null;
  createdBy: string;
  createdAt: string;
  steps: Step[];
};

export type List = {
  id: string;
  name: string;
  color: Color;
  isDefault: boolean;
  owner: string;
  members: string[];
  open: number;
};

export type SmartView = "myday" | "important" | "planned" | "assigned" | "all";
export type Counts = Record<SmartView, number>;
