import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BookingFlow } from "@/components/BookingFlow";
import { pageBySlug, publicPage } from "@/lib/pages";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ page: string; service: string }>; searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await pageBySlug((await params).page);
  return { title: page?.published ? `Book with ${page.name}` : "Booking page not found" };
}

/** Straight to one service: the link a service's "Share" gives, and what a Sites booking block opens. */
export default async function BookService({ params, searchParams }: Props) {
  const { page: slug, service } = await params;
  const page = await pageBySlug(slug);
  if (!page || !page.published) notFound();
  const pub = publicPage(page);
  const s = pub.services.find((x) => x.slug === service);
  const sp = await searchParams;
  return <BookingFlow page={pub} serviceId={s?.id} embed={sp.embed === "1"} />;
}
