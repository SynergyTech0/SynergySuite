/**
 * Web-to-lead: a website's form (or its server) posts here with `Authorization: Bearer
 * <CRM_API_TOKEN>`. No suite sign-in is involved, so this path bypasses the gateway; with the
 * token unset the endpoint doesn't exist. No tracking pixels or ad-network callbacks.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { intake, intakeFields } from "./leads";
import { intakeOwner } from "./members";
import { UserError } from "./util";

export const MAX_INTAKE_BYTES = 16 * 1024;

/** Constant-time check of the bearer token; false whenever no token is configured. */
export function tokenOk(authorization: string | null, token = process.env.CRM_API_TOKEN || ""): boolean {
  if (!token) return false;
  const m = (authorization ?? "").match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  // Hashing first makes both sides the same length, so the comparison leaks nothing about it.
  const a = createHash("sha256").update(m[1].trim()).digest();
  const b = createHash("sha256").update(token).digest();
  return timingSafeEqual(a, b);
}

export async function readIntake(req: Request): Promise<Record<string, unknown>> {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_INTAKE_BYTES) throw new UserError("Too big", 413);
  const raw = await req.text();
  if (raw.length > MAX_INTAKE_BYTES) throw new UserError("Too big", 413);
  const type = req.headers.get("content-type") || "";
  if (type.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(raw));
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  } catch { /* fall through */ }
  throw new UserError("Send JSON or a form post");
}

export async function receiveLead(b: Record<string, unknown>): Promise<string> {
  const v = intakeFields(b);
  const owner = await intakeOwner();
  if (!owner) throw new UserError("The CRM has no admin yet to receive leads", 503);
  return intake(owner, v);
}
