import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    // Extract token from query parameters
    const url = new URL(req.url);
    const token = url.searchParams.get('token');

    console.log('Verifying signer with token:', token);

    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    // Find the signer by token (token is unique per schema)
    const signer = await prisma.documentSigner.findUnique({
      where: { token },
      include: {
        document: {
          select: {
            id: true,
            title: true,
            cloudStoragePath: true,
            cloudProvider: true
          }
        }
      }
    });

    // Fetch all signers for the document
    let allSigners: any[] = [];
    if (signer && signer.document) {
      allSigners = await prisma.documentSigner.findMany({
        where: { documentId: signer.document.id },
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
        },
      });
    }

    // If no signer found, return error
    if (!signer) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 404 });
    }

    if (!signer.document) {
        return NextResponse.json({ error: 'Associated document not found' }, { status: 404 });
    }

    // Prepare and return signer data
    const result = {
      id: signer.id,
      name: signer.name,
      email: signer.email,
      status: signer.status,
      document: signer.document ? {
        id: signer.document.id,
        title: signer.document.title,
        cloudStoragePath: signer.document.cloudStoragePath,
        provider: signer.document.cloudProvider
      } : undefined,
      allSigners
    };

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('Error in signers/verify route:', err);
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
  }
}
