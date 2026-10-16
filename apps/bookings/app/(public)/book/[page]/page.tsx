import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BookingFlow } from "@/components/BookingFlow";
import { pageBySlug, publicPage } from "@/lib/pages";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ page: string }>; searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await pageBySlug((await params).page);
  return { title: page?.published ? `Book with ${page.name}` : "Booking page not found" };
}

/** A customer's booking page. `?embed=1` drops the outer padding for a Sites block or iframe. */
export default async function BookPage({ params, searchParams }: Props) {
  const page = await pageBySlug((await params).page);
  if (!page || !page.published) notFound();
  const sp = await searchParams;
  return <BookingFlow page={publicPage(page)} embed={sp.embed === "1"} />;
}
