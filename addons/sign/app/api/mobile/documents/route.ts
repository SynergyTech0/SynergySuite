import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
	try {
		// Extract and validate Bearer token
		const authHeader = request.headers.get("authorization");

		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			return NextResponse.json(
				{ error: "Missing or invalid authorization header" },
				{ status: 401 }
			);
		}

		const token = authHeader.substring(7); // Remove "Bearer " prefix

		// Find session by token
		const session = await prisma.session.findUnique({
			where: { sessionToken: token },
			include: {
				user: true
			}
		});

		if (!session) {
			return NextResponse.json(
				{ error: "Invalid or expired session" },
				{ status: 401 }
			);
		}

		// Check if session is expired
		if (session.expires < new Date()) {
			// Clean up expired session
			await prisma.session.delete({
				where: { sessionToken: token }
			});

			return NextResponse.json(
				{ error: "Session expired" },
				{ status: 401 }
			);
		}

		const user = session.user;

		// Parse query parameters
		const { searchParams } = new URL(request.url);
		const status = searchParams.get("status");
		const query = searchParams.get("query");
		const archivedParam = searchParams.get("archived");
		const page = Math.max(parseInt(searchParams.get("page") || "1", 10), 1);
		const limit = Math.min(
			Math.max(parseInt(searchParams.get("limit") || "10", 10), 1),
			100
		);
		const skip = (page - 1) * limit;

		// Build where clause based on user role
		let whereClause: any = {};
		const role = (user.role || "SENDER").toUpperCase();

		if (role === "SIGNER") {
			whereClause = {
				signers: {
					some: {
						OR: [{ userId: user.id }, { email: user.email }],
					},
				},
			};
		}
		if (role === "SENDER") {
			whereClause.senderId = user.id;
		}
		if (role === "ADMIN") {
			// Admin can see all documents
		}

		if (status && status !== "all") whereClause.status = status;
		if (query) {
			whereClause.OR = [
				{ title: { contains: query, mode: "insensitive" } },
				{ description: { contains: query, mode: "insensitive" } },
				{ signers: { some: { name: { contains: query, mode: "insensitive" } } } },
				{ signers: { some: { email: { contains: query, mode: "insensitive" } } } },
				{ sender: { name: { contains: query, mode: "insensitive" } } },
				{ sender: { email: { contains: query, mode: "insensitive" } } },
			];
		}

		// Apply archived filter
		if (!archivedParam || archivedParam == "false") {
			whereClause.archived = false;
		}

		const [documents, total] = await Promise.all([
			prisma.document.findMany({
				where: whereClause,
				include: {
					sender: { select: { id: true, name: true, email: true } },
					signers: {
						select: {
							id: true,
							name: true,
							email: true,
							status: true,
							signedAt: true,
							userId: true,
							order: true,
						},
					},
					_count: { select: { fields: true } },
				},
				orderBy: [{ archived: "asc" }, { createdAt: "desc" }],
				skip,
				take: limit,
			}),
			prisma.document.count({ where: whereClause }),
		]);

		return NextResponse.json({
			documents,
			pagination: {
				page,
				limit,
				total,
				totalPages: Math.ceil(total / limit),
			},
		});
	} catch (error) {
		console.error("❌ Mobile documents fetch error:", error);
		return NextResponse.json(
			{ error: "Failed to fetch documents" },
			{ status: 500 }
		);
	}
}
