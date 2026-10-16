export type Role = "owner" | "edit" | "view";

export type Member = { email: string; role: "edit" | "view" };

/** A diagram in a list: everything but the drawing itself. */
export type DiagramInfo = {
  id: string;
  name: string;
  owner: string;
  role: Role;
  pages: number;
  version: number;
  hasThumbnail: boolean;
  createdAt: string;
  modifiedAt: string;
  modifiedBy: string;
  openedAt: string | null;
  members: Member[];
};

export type Diagram = DiagramInfo & { xml: string };

export type Version = { id: string; version: number; name: string; savedBy: string; savedAt: string };

export type View = "recent" | "mine" | "shared";
