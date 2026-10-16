import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getServerSession } from "@/lib/auth";
import { authOptions } from "@/lib/auth";

interface SignerStats {
  id: string | null;
  name: string;
  email: string;
  companyName: string | null;
  image: string | null;
  documentsCount: number;
  completedCount: number;
  pendingCount: number;
}

export async function GET() {
	const session = await getServerSession(authOptions);
	const user = session?.user;

	if (!user?.id) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	try {
        // TODO: Add pagination support for large datasets
		// Get grouped signer statistics with user data when available
		const signerStats : SignerStats[] = await prisma.$queryRaw`
        WITH owned_documents AS (
        SELECT id
        FROM documents
        WHERE "senderId" = ${user.id}
        ), all_signer_names AS (
        SELECT 
        email,
        name
        FROM document_signers ds
        INNER JOIN owned_documents od ON ds."documentId" = od.id
        UNION
        SELECT 
        u.email,
        u.name
        FROM users u
        INNER JOIN document_signers ds ON ds.email = u.email
        INNER JOIN owned_documents od ON ds."documentId" = od.id
        WHERE u.name IS NOT NULL
        ), first_names AS (
        SELECT 
        email,
        MIN(name) as first_alphabetical_name
        FROM all_signer_names
        GROUP BY email
        ), grouped_signers AS (
        SELECT 
        email,
        "userId",
        COUNT(DISTINCT ds."documentId") as documents_count,
        COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pending_count,
        COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) as completed_count
        FROM document_signers ds
        INNER JOIN owned_documents od ON ds."documentId" = od.id
        GROUP BY email, "userId"
        )
        SELECT 
        gs.email,
        fn.first_alphabetical_name as name,
        u."companyName" as "companyName",
        u.image,
        gs.documents_count as "documentsCount",
        gs.pending_count as "pendingCount",
        gs.completed_count as "completedCount"
        FROM grouped_signers gs
        LEFT JOIN users u ON gs."userId" = u.id
        LEFT JOIN first_names fn ON gs.email = fn.email
        ORDER BY gs.documents_count DESC;
        `;

        //Must preform to handle type-safety issues with BigInt
        const safeResults = signerStats.map(row => ({
            ...row,
            documentsCount: row.documentsCount?.toString(),
            pendingCount: row.pendingCount?.toString(),
            completedCount: row.completedCount?.toString(),
        }));



		return NextResponse.json({ signers: safeResults });
	} catch (error: any) {
		console.error("Error fetching signer stats:", error);
		return NextResponse.json(
			{ error: "Failed to fetch signer statistics" },
			{ status: 500 }
		);
	}
}
