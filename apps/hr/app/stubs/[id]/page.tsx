import { PayStub } from "@/components/PayStub";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <PayStub id={(await params).id} />;
}
