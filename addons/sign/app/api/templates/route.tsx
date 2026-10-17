// API endpoint for retrieving templates
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getServerSession } from "@/lib/auth";
import { NextResponse, NextRequest } from "next/server";

export async function GET(req: NextRequest) {
	// Verify user session here
	const user = await getServerSession(authOptions).then((session) => session?.user);
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

    // Parse query parameters for pagination and filtering
    const { searchParams } = new URL(req.url);
	const page = Math.max(parseInt(searchParams.get("page") || "1", 10), 1);
	const limit = Math.min(
		Math.max(parseInt(searchParams.get("limit") || "10", 10), 1),
		100
	);
	const skip = (page - 1) * limit;
    const query = searchParams.get("query");

    // Apply filters
	const whereClause: any = { creatorId: user.id };
	if (query) {
		whereClause.OR = [
            { name: { contains: query, mode: "insensitive" } },
            { description: { contains: query, mode: "insensitive" } },
        ];
	}

    // Create the templates query
	const [templates, total] = await Promise.all([
		prisma.template.findMany({
			where: whereClause,
			orderBy: { createdAt: "desc" },
            skip,
            take: limit,
            select: {
                id: true,
                name: true,
                description: true,
                usageCount: true,
                createdAt: true,
                creator: {
                    select: { name: true, email: true }
                }
            },
		}),
		prisma.template.count({ where: whereClause }),
	]);

    // Return the templates with pagination info
	return NextResponse.json({
		templates,
		pagination: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
	});
}
