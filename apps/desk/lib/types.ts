// Shapes shared by the server routes and the browser.

export const STATUSES = ["open", "pending", "solved", "closed"] as const;
export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export type Status = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Source = "manual" | "email" | "api";

export type Ticket = {
  id: number;
  number: string;
  subject: string;
  requesterEmail: string;
  requesterName: string;
  status: Status;
  priority: Priority;
  assignee: string;
  source: Source;
  createdAt: string;
  updatedAt: string;
  solvedAt: string | null;
  messageCount: number;
  /** The latest message the requester can see, cut short. */
  preview: string;
  lastDirection: Message["direction"] | null;
};

export type Message = {
  id: number;
  direction: "inbound" | "outbound" | "note";
  author: string;
  body: string;
  /** For outbound replies: whether it actually went out by email. */
  emailed: boolean;
  createdAt: string;
};

export type TicketDetail = Ticket & { messages: Message[] };

export type Canned = { id: number; title: string; body: string; createdBy: string };

export type Article = {
  id: number;
  slug: string;
  title: string;
  body: string;
  published: boolean;
  updatedBy: string;
  updatedAt: string;
};
