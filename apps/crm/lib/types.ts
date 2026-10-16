// Shapes and choice lists shared by the server and the browser.

export const ROLES = ["admin", "manager", "rep"] as const;
export type Role = (typeof ROLES)[number];

export const ACCOUNT_TYPES = ["prospect", "customer", "partner", "competitor", "other"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const LEAD_STATUSES = ["new", "working", "nurturing", "qualified", "unqualified", "converted"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_SOURCES = ["web", "referral", "event", "cold_outreach", "partner", "other"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const STAGES = ["prospecting", "qualification", "proposal", "negotiation", "closed_won", "closed_lost"] as const;
export type Stage = (typeof STAGES)[number];

export const ACTIVITY_TYPES = ["task", "event", "call", "note"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_STATUSES = ["open", "completed", "canceled"] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export const RECORD_TYPES = ["account", "contact", "lead", "opportunity"] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export const LABELS: Record<string, string> = {
  admin: "Admin", manager: "Manager", rep: "Rep",
  prospect: "Prospect", customer: "Customer", partner: "Partner", competitor: "Competitor", other: "Other",
  new: "New", working: "Working", nurturing: "Nurturing", qualified: "Qualified", unqualified: "Unqualified", converted: "Converted",
  web: "Web", referral: "Referral", event: "Event", cold_outreach: "Cold outreach",
  prospecting: "Prospecting", qualification: "Qualification", proposal: "Proposal", negotiation: "Negotiation",
  closed_won: "Closed won", closed_lost: "Closed lost",
  task: "Task", call: "Call", note: "Note",
  open: "Open", completed: "Completed", canceled: "Canceled",
  account: "Account", contact: "Contact", lead: "Lead", opportunity: "Opportunity",
};

export function label(v: string): string {
  return LABELS[v] ?? v;
}

/** The signed-in person as the CRM knows them. */
export type Ctx = { email: string; name: string; role: Role };

export type Member = { email: string; name: string; role: Role; lastSeen: string };

type Audit = { owner: string; ownerName: string; createdAt: string; updatedAt: string; editable: boolean };

export type Account = Audit & {
  id: string;
  name: string;
  industry: string;
  website: string;
  phone: string;
  address: string;
  type: AccountType;
};

export type Contact = Audit & {
  id: string;
  accountId: string;
  accountName: string;
  name: string;
  email: string;
  phone: string;
  title: string;
};

export type Lead = Audit & {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  status: LeadStatus;
  source: LeadSource;
  score: number | null;
  scoreRationale: string;
  scoreModel: string;
  scoreUpdatedAt: string | null;
  scoreIsOverride: boolean;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  landingPath: string;
  convertedAt: string | null;
  convertedAccountId: string | null;
  convertedContactId: string | null;
  convertedOpportunityId: string | null;
  convertedAccountName: string;
};

export type Opportunity = Audit & {
  id: string;
  accountId: string;
  accountName: string;
  name: string;
  /** numeric(14,2) as text, so cents never pass through a float; null when unknown. */
  amount: string | null;
  stage: Stage;
  closeDate: string | null; // YYYY-MM-DD
  probability: number | null;
};

export type Activity = {
  id: string;
  type: ActivityType;
  subject: string;
  body: string;
  dueAt: string | null;
  status: ActivityStatus;
  assignee: string;
  assigneeName: string;
  relatedType: RecordType;
  relatedId: string;
  relatedName: string;
  createdBy: string | null;
  createdAt: string;
  editable: boolean;
};

export type ConvertInput = {
  accountName: string;
  accountType?: AccountType;
  contactName: string;
  contactEmail?: string;
  contactPhone?: string;
  contactTitle?: string;
  createOpportunity?: boolean;
  opportunityName?: string;
  amount?: string;
  stage?: Stage;
  closeDate?: string;
  owner?: string;
};

export type ConvertResult = { accountId: string; contactId: string; opportunityId: string | null };
