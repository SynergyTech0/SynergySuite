import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ManageBooking } from "@/components/ManageBooking";
import { forCustomer } from "@/lib/appointments";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your appointment", robots: { index: false, follow: false } };

/** The customer's own page for one appointment; the link in every email they get. */
export default async function Manage({ params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token;
  const view = await forCustomer(token);
  if (!view) notFound();
  return <ManageBooking token={token} initial={view} />;
}
