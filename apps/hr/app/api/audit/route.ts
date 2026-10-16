import { vroute } from "@/lib/api";
import { q } from "@/lib/db";
import { UserError } from "@/lib/util";

/** The latest changes to records, time off decisions and payroll, for HR and payroll admins. */
export const GET = vroute(async (v) => {
  if (!v.roles.hrAdmin && !v.roles.payrollAdmin) throw new UserError("Only HR and payroll admins can see the change log", 403);
  return q("SELECT id::text, at, actor, action, subject, detail FROM audit ORDER BY at DESC LIMIT 300");
});
