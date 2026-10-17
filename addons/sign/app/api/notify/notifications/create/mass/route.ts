// Mass notification endpoint
// Handles mass in app notifications through API requests

import { NextResponse } from "next/server";
import { createNotification } from "@/lib/notifications";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "@/lib/auth";

export async function POST(req: Request) {
	try {
		// Get the current user session securely (no email in body)
		const session = await getServerSession(authOptions);

		if (!session || !session.user?.email) {
			return NextResponse.json(
				{ error: "Unauthorized" },
				{ status: 401 }
			);
		}

		const {
			emails,
			subject,
			message,
			type,
			userId,
			documentId,
			redirectURL,
		} = await req.json();

		// Validate request body
		if (
			!emails ||
			!Array.isArray(emails) ||
			emails.length === 0 ||
			!subject ||
			!type ||
			!message
		) {
			return NextResponse.json(
				{
					success: false,
					error: "Missing required fields (emails, subject, message)",
				},
				{ status: 400 }
			);
		}

		// Validate email format
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emails.every((email) => emailRegex.test(email))) {
			return NextResponse.json(
				{
					success: false,
					error: "Invalid email format in emails list",
				},
				{ status: 400 }
			);
		}

		// Create notifications in the database
		const createdNotifications = await Promise.all(
			emails.map(async (email) => {
				return await createNotification(
					email,
					subject,
					message,
					type,
					userId,
					documentId,
					redirectURL
				);
			})
		);

		return NextResponse.json({
			success: true,
			notifications: createdNotifications,
		});
	} catch (error: any) {
		console.error("Error creating mass notifications:", error);
		return NextResponse.json(
			{
				success: false,
				error: error.message || "Failed to create mass notifications",
			},
			{ status: 500 }
		);
	}
}
