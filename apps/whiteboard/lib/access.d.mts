export type Role = "viewer" | "editor" | "owner";
export type LinkAccess = "none" | "view" | "edit";
export type AccessRow = { owner: string; link_access: LinkAccess; member_role: "viewer" | "editor" | null };

export declare const RANK: Record<Role, number>;
export declare const ACCESS_SQL: string;
export declare const UUID: RegExp;
export declare function roleFrom(row: AccessRow | null | undefined, email: string): Role | null;
