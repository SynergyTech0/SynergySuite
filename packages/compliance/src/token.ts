import { timingSafeEqual } from "node:crypto";

/** True when an Authorization header carries `Bearer <COMPLIANCE_TOKEN>`. With no token configured, nothing is authorized. */
export function complianceAuthorized(header: string | null | undefined, token = process.env.COMPLIANCE_TOKEN || ""): boolean {
  if (!token || !header || !header.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
