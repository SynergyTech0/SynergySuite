import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

// ---------------
// Data structure for individual signer profile
// ---------------
export interface IndividualSignerStats {
  id: string | null;
  name: string;
  email: string;
  companyName: string | null;
  image: string | null;
  documentsCount: number;
  completedCount: number;
  pendingCount: number;
  documentIds: string[];
  documents: Array<{
    id: string;
    title: string;
    date: Date;
    status: string;
  }>;
}

export async function GET(req: Request) {
  // Extract email from the URL path
  const url = new URL(req.url);
  const rawEmail = url.pathname.split("/signers/")[1].split("/profile")[0];
  // Double decode to handle potential double encoding
  const email = decodeURIComponent(decodeURIComponent(rawEmail));
  const session = await getServerSession(authOptions);
  const user = session?.user;

  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Get user info if exists
    const userInfo = await prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, companyName: true, image: true }
    });

    // Get all document_signers for this email, only for documents owned by session user
    // TODO: Once a user signs up data should be updated for all their email entries
    const sharedSigners = await prisma.documentSigner.findMany({
      where: {
        email,
        document: { senderId: user.id }
      },
      select: {
        documentId: true,
        status: true,
        name: true,
        userId: true,
        document: {
          select: {
            title: true,
            createdAt: true,
            status: true
          }
        }
      }
    });

    // Gather stats
    const documentsCount = sharedSigners.length;
    const pendingCount = sharedSigners.filter(s => s.status === 'PENDING').length;
    const completedCount = sharedSigners.filter(s => s.status === 'COMPLETED').length;
    const companyName = userInfo?.companyName ?? null;
    const image = userInfo?.image ?? null;
    const userId = userInfo?.id ?? sharedSigners[0]?.userId ?? null;
    const documentIds = sharedSigners.map(s => s.documentId);

    // Collect all possible names and sort them
    const allNames = [
      userInfo?.name,
      ...sharedSigners.map(s => s.name)
    ].filter((name): name is string => !!name); // Filter out nulls/undefined
    
    const firstName = allNames.length > 0 
      ? allNames.sort((a, b) => a.localeCompare(b))[0]  // Get alphabetically first name
      : email;

    const documents = sharedSigners.map(s => ({
      id: s.documentId,
      title: s.document.title,
      date: s.document.createdAt,
      status: s.status
    }));

    const result: IndividualSignerStats = {
      id: userId,
      name: firstName,
      email,
      companyName,
      image,
      documentsCount,
      completedCount,
      pendingCount,
      documentIds,
      documents
    };

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Error fetching individual signer stats:", error);
    return NextResponse.json({ error: "Failed to fetch signer statistics" }, { status: 500 });
  }
}
