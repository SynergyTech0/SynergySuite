import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
	try {
		const session = await getServerSession(authOptions);
		const user = session?.user;

		if (!user?.id) {
			return NextResponse.json(
				{ error: "Unauthorized" },
				{ status: 401 }
			);
		}

		const { searchParams } = new URL(request.url);
		const status = searchParams.get("status");
		const query = searchParams.get("query");
		// optional archived query param (true|false). If omitted we default to excluding archived documents.
		const archivedParam = searchParams.get("archived");
		const page = Math.max(parseInt(searchParams.get("page") || "1", 10), 1);
		const limit = Math.min(
			Math.max(parseInt(searchParams.get("limit") || "10", 10), 1),
			100
		);
		const skip = (page - 1) * limit;

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

		// apply archived filter last so it behaves like an optional parameter similar to `status`.
		// If the client provided `archived`, use it. Otherwise default to excluding archived documents.
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
		console.error("❌ Documents fetch error:", error);
		return NextResponse.json(
			{ error: "Failed to fetch documents" },
			{ status: 500 }
		);
	}
}
