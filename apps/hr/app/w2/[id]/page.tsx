import { W2Form } from "@/components/W2Form";

export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ year?: string }> }) {
  return <W2Form id={(await params).id} year={(await searchParams).year ?? String(new Date().getFullYear() - 1)} />;
}
