import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

interface EnterpriseInfoResponse {
	id: string;
	name: string;
    seatCount: number;
    active: boolean;
	users: {
		id: string;
		name: string;
		email: string;
		role: string;
		createdAt: Date;
		documentCounts: {
			draft: number;
			sent: number;
			completed: number;
			declined: number;
			expired: number;
			total: number;
		};
		sentDocuments: {
			id: string;
			status: string;
		}[];
	}[];
}

export async function GET() {
	const session = await getServerSession(authOptions);
	if (!session?.user?.id) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const userId = session.user.id;

	// Fetch the user's enterprise account
	const user = await prisma.user.findUnique({
		where: { id: userId },
		include: { administratorOf: true },
	});

	if (!user) {
		return NextResponse.json({ error: "User not found" }, { status: 404 });
	}

	if (!user.administratorOf) {
		return NextResponse.json(
			{ error: "No enterprise account found" },
			{ status: 404 }
		);
	}

	const enterpriseAccount = user.administratorOf;

	// Collect enterprise info to return
	// Get all the users in the enterprise account and count the status of their documents
	const users = await prisma.user.findMany({
		where: { enterpriseId: enterpriseAccount.id },
		select: {
			id: true,
			name: true,
			email: true,
			role: true,
			createdAt: true,

			sentDocuments: {
				select: {
					id: true,
					status: true,
				},
			},
		},
	});

	// Count document statuses for each user
	const usersWithCounts = users.map((user) => {
		const draft = user.sentDocuments.filter(
			(doc) => doc.status === "DRAFT"
		).length;
		const sent = user.sentDocuments.filter(
			(doc) => doc.status === "SENT"
		).length;
		const completed = user.sentDocuments.filter(
			(doc) => doc.status === "COMPLETED"
		).length;
		const declined = user.sentDocuments.filter(
			(doc) => doc.status === "DECLINED"
		).length;
		const expired = user.sentDocuments.filter(
			(doc) => doc.status === "EXPIRED"
		).length;

		return {
			id: user.id,
			name: user.name,
			email: user.email,
			role: user.role,
			createdAt: user.createdAt,
			sentDocuments: user.sentDocuments,
			documentCounts: {
				draft,
				sent,
				completed,
				declined,
				expired,
				total: user.sentDocuments.length,
			},
		};
	});

	return NextResponse.json({
		id: enterpriseAccount.id,
		name: enterpriseAccount.name,
        seatCount: enterpriseAccount.userLimit,
        active: enterpriseAccount.isActive,
		users: usersWithCounts,
	});
}
