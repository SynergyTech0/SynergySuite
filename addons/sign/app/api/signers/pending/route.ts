// Retrieve all unsigned documents for the authenticated signer
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from '@/lib/db';

interface pendingDocument {
  id: string;
  title: string;
  sender: { name: string; email: string };
  sentAt: Date;
  deadline: Date | null;
  token: string;
}
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

    if (!session || !session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const pendingDocuments = await prisma.documentSigner.findMany({
        where: { email: session.user.email, status: 'PENDING' },
        select: {
            document: {
                select: {
                    id: true,
                    title: true,
                    sender: { select: { name: true, email: true } },
                    createdAt: true,
                    deadline: true,
                },
            },
            token: true,
        },
    });

    const formattedDocuments: pendingDocument[] = pendingDocuments.map((ds) => ({
        id: ds.document.id,
        title: ds.document.title,
        sender: { name: ds.document.sender.name || "Unknown", email: ds.document.sender.email },
        sentAt: ds.document.createdAt || new Date(),
        deadline: ds.document.deadline || null,
        token: ds.token || '',
    }));

    return NextResponse.json(formattedDocuments);
}