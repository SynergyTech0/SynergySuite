// Email notification endpoint
// Sends email notifications to users via nodemailer and Gmail SMTP through api request

import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";

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

		const { to, subject, html } = await req.json();

		// Validate request body
		if (!to || !subject || !html) {
			return NextResponse.json(
				{
					success: false,
					error: "Missing required fields (to, subject, html)",
				},
				{ status: 400 }
			);
		}

		// Send the email
		const emailRes = await sendEmail(to, subject, html);

		if (!emailRes.success) {
			console.error("Failed to send email:", emailRes.messageId);
			return NextResponse.json(
				{ success: false, error: "Failed to send email" },
				{ status: 500 }
			);
		}

		return NextResponse.json({ success: true });
	} catch (error: any) {
		console.error("Error sending email:", error);
		return NextResponse.json(
			{ success: false, error: error.message || "Failed to send email" },
			{ status: 500 }
		);
	}
}
