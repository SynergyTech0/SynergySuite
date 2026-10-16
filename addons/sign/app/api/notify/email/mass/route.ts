// Mass email notification endpoint

// Sends mass email notifications to multiple users via nodemailer and Gmail SMTP through api request
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

		let failedEmails = 0;
		for (const recipient of to) {
			// Send the email to each recipient
			const emailRes = await sendEmail(recipient, subject, html);

			if (!emailRes.success) {
				console.error("Failed to send email:", emailRes.messageId);
				failedEmails++;
				continue;
			}
		}

		if (failedEmails > 0) {
			if (failedEmails === to.length) {
				return NextResponse.json(
					{
						success: false,
						error: "Failed to send emails to all recipients",
					},
					{ status: 500 }
				);
			}
			return NextResponse.json({
				success: false,
				warning: `Failed to send emails to ${failedEmails} recipients`,
			});
		}
	} catch (error: any) {
		console.error("Error sending email:", error);
		return NextResponse.json(
			{ success: false, error: error.message || "Failed to send email" },
			{ status: 500 }
		);
	}
	return NextResponse.json({ success: true });
}
