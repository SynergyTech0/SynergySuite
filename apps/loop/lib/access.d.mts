export type Role = "owner" | "editor" | "viewer";
export type Query = (text: string, params?: unknown[]) => Promise<any[]>;

export const RANK: Record<Role, number>;
export function best(a: Role | null, b: Role | null): Role | null;
export function canEdit(role: Role | null | undefined): boolean;
export function isUuid(v: unknown): v is string;
export function workspaceRole(q: Query, workspaceId: string, email: string): Promise<Role | null>;
export function pageRole(q: Query, pageId: string, email: string): Promise<Role | null>;
export function componentRole(q: Query, componentId: string, email: string): Promise<Role | null>;
export function parseDocName(name: unknown): { kind: "page" | "component"; id: string } | null;
export function documentRole(q: Query, name: unknown, email: string): Promise<Role | null>;
