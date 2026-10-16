import { body, route } from "@/lib/http";
import { deleteReport, getReport, updateReport } from "@/lib/reports";

type P = { id: string };

export const GET = route<P>(async (_req, me, { id }) => ({ report: await getReport(id, me.email) }));

export const PATCH = route<P>(async (req, me, { id }) => ({ report: await updateReport(id, me.email, await body(req)) }));

export const DELETE = route<P>(async (_req, me, { id }) => {
  await deleteReport(id, me.email);
});
