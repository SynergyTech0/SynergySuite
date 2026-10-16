import { body, vroute } from "@/lib/api";
import { getSettings, saveSettings } from "@/lib/payroll/runs";
import { UserError } from "@/lib/util";

export const GET = vroute(async (v) => {
  if (!v.roles.payrollAdmin) throw new UserError("Only payroll admins can see payroll settings", 403);
  return getSettings();
});
export const PUT = vroute(async (v, req) => saveSettings(v, await body(req)));
