import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isDenied, signerForToken } from "@/lib/access";

export const dynamic = "force-dynamic";

/** GET /api/signers/fields?token=… : the fields on the signer's document (public: the token is the key). */
export async function GET(req: Request) {
  const signer = await signerForToken(new URL(req.url).searchParams.get("token"));
  if (isDenied(signer)) return signer.denied;
  const fields = await prisma.documentField.findMany({ where: { documentId: signer.documentId } });
  return NextResponse.json({ fields });
}
