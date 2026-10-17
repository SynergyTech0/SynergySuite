import { filters, route, type Params } from "@/lib/api";
import * as accounts from "@/lib/accounts";
import * as contacts from "@/lib/contacts";
import { toCsv } from "@/lib/csv";
import * as leads from "@/lib/leads";
import * as opps from "@/lib/opportunities";
import * as partners from "@/lib/partners";
import * as referrals from "@/lib/referrals";
import { label } from "@/lib/types";
import { UserError } from "@/lib/util";

function download(csv: string, name: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** The list as currently filtered, as CSV. */
export const GET = route(async (ctx, req, { params }: Params<"kind">) => {
  const kind = (await params).kind;
  const f = filters(req);
  if (kind === "accounts") {
    return download(toCsv(await accounts.list(ctx, f), [
      ["Name", (r) => r.name], ["Type", (r) => label(r.type)], ["Industry", (r) => r.industry], ["Website", (r) => r.website],
      ["Phone", (r) => r.phone], ["Address", (r) => r.address], ["City", (r) => r.city], ["State", (r) => r.state],
      ["ZIP", (r) => r.postalCode], ["Owner", (r) => r.owner], ["Updated", (r) => r.updatedAt],
    ]), "accounts.csv");
  }
  if (kind === "contacts") {
    return download(toCsv(await contacts.list(ctx, f), [
      ["Name", (r) => r.name], ["Title", (r) => r.title], ["Account", (r) => r.accountName], ["Email", (r) => r.email],
      ["Phone", (r) => r.phone], ["Owner", (r) => r.owner], ["Updated", (r) => r.updatedAt],
    ]), "contacts.csv");
  }
  if (kind === "leads") {
    return download(toCsv(await leads.list(ctx, f), [
      ["Name", (r) => r.name], ["Company", (r) => r.company], ["Email", (r) => r.email], ["Phone", (r) => r.phone],
      ["Status", (r) => label(r.status)], ["Source", (r) => label(r.source)], ["Score", (r) => r.score ?? ""],
      ["UTM source", (r) => r.utmSource], ["UTM medium", (r) => r.utmMedium], ["UTM campaign", (r) => r.utmCampaign],
      ["Owner", (r) => r.owner], ["Created", (r) => r.createdAt],
    ]), "leads.csv");
  }
  if (kind === "opportunities") {
    return download(toCsv(await opps.list(ctx, f), [
      ["Name", (r) => r.name], ["Account", (r) => r.accountName], ["Amount", (r) => r.amount ?? ""], ["Stage", (r) => label(r.stage)],
      ["Probability", (r) => r.probability ?? ""], ["Close date", (r) => r.closeDate ?? ""], ["Owner", (r) => r.owner],
    ]), "opportunities.csv");
  }
  if (kind === "partners") {
    return download(toCsv(await partners.list(ctx, f), [
      ["Name", (r) => r.name], ["Kind", (r) => label(r.kind)], ["Company", (r) => r.company], ["Email", (r) => r.email], ["Phone", (r) => r.phone],
      ["Status", (r) => label(r.status)], ["Code", (r) => r.code ?? ""], ["Reward type", (r) => label(r.rewardType)], ["Reward", (r) => r.rewardValue],
      ["Owner", (r) => r.owner], ["Updated", (r) => r.updatedAt],
    ]), "partners.csv");
  }
  if (kind === "referrals") {
    return download(toCsv(await referrals.list(ctx, f), [
      ["Referral", (r) => r.name], ["Company", (r) => r.company], ["Partner", (r) => r.partnerName], ["Stage", (r) => label(r.stage)],
      ["Deal value", (r) => r.dealValue ?? ""], ["Reward", (r) => r.reward ?? ""], ["Owed", (r) => r.owed], ["Paid on", (r) => r.paidOn ?? ""],
      ["Paid", (r) => r.paidAmount ?? ""], ["Payment note", (r) => r.paidNote], ["Referred", (r) => r.createdAt],
    ]), "referrals.csv");
  }
  throw new UserError("Not found", 404);
});
