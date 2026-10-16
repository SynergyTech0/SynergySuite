import nodemailer from "nodemailer";

interface EmailOptions {
	to: string;
	subject: string;
	html: string;
	attachments?: Array<{
		filename: string;
		path?: string;
		content?: string | Buffer;   // Buffer: attach bytes we hold (e.g. the freshly signed PDF)
	}>;
}

export async function sendEmail(options: EmailOptions | string, subject?: string, html?: string) {
	// Support both old signature (to, subject, html) and new signature ({ to, subject, html, attachments })
	let emailOptions: EmailOptions;
	
	if (typeof options === 'string') {
		// Old signature: sendEmail(to, subject, html)
		if (subject == null || html == null) {
			throw new Error('subject and html are required when using the old signature');
		}
		emailOptions = {
			to: options,
			subject: subject,
			html: html,
		};
	} else {
		// New signature: sendEmail({ to, subject, html, attachments })
		emailOptions = options;
	}
	// Check if using OAuth2 or simple auth
	const useOAuth2 = process.env.GOOGLE_CLIENT_ID &&
	                  process.env.GOOGLE_CLIENT_SECRET &&
	                  process.env.GOOGLE_REFRESH_TOKEN;

	// DEV SINK: with no mail credentials at all, sending threw "Email credentials not configured",
	// which meant you could not invite a signer — i.e. the core flow was unrunnable locally. Write
	// the message to ./dev-mail/*.eml instead so the flow completes and the mail is inspectable.
	// Explicit outbound kill switch. This rail mails signing links to
	// counterparties and exposes a mass-send endpoint; before this there was no
	// way to stop it short of deleting the SMTP credentials. Defaults to armed.
	// Disarming deliberately routes through the dev-sink below rather than
	// throwing, so the signing flow still completes and every message is
	// inspectable on disk instead of reaching a real inbox.
	const sendArmed = process.env.EMAIL_SEND_ARMED !== "0";
	const hasCreds = sendArmed && (useOAuth2 || (process.env.EMAIL_USER && process.env.EMAIL_PASS));
	if (!hasCreds) {
		const fs = await import("fs/promises");
		const path = await import("path");
		const dir = path.join(process.cwd(), "dev-mail");
		await fs.mkdir(dir, { recursive: true });
		const safe = String(emailOptions.subject).replace(/[^a-z0-9]+/gi, "-").slice(0, 60);
		const file = path.join(dir, `${Date.now()}-${safe}.eml`);
		await fs.writeFile(
			file,
			`To: ${emailOptions.to}\nSubject: ${emailOptions.subject}\n` +
			`X-Attachments: ${(emailOptions.attachments ?? []).map((a) => a.filename).join(", ") || "(none)"}\n` +
			`\n${emailOptions.html}\n`,
			"utf8",
		);
		console.warn(
			`[email] ${sendArmed ? "no credentials configured" : "OUTBOUND DISARMED (EMAIL_SEND_ARMED=0)"}` +
			` — wrote ${file} instead of sending`,
		);
		return { messageId: `dev-sink:${path.basename(file)}`, devSink: file };
	}

	let transporter;

	if (useOAuth2) {
		// OAuth2 configuration (more secure, recommended)
		transporter = nodemailer.createTransport({
			service: "gmail",
			auth: {
				type: "OAuth2",
				user: process.env.GOOGLE_USER_EMAIL,
				clientId: process.env.GOOGLE_CLIENT_ID,
				clientSecret: process.env.GOOGLE_CLIENT_SECRET,
				refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
			},
		});
	} else {
        console.warn("OAuth2 credentials not fully set. Falling back to simple authentication.");

		// Simple auth with app password (fallback)
		transporter = nodemailer.createTransport({
			host: process.env.SMTP_HOST || "smtp.gmail.com",
			port: Number(process.env.SMTP_PORT || 465),
			secure: Number(process.env.SMTP_PORT || 465) === 465,
			auth: {
				user: process.env.EMAIL_USER,
				pass: process.env.EMAIL_PASS,
			},
		});
	}

	try {
		// Verify connection
		await transporter.verify();
		console.log("SMTP connection established successfully");

		// Send the email
		const info = await transporter.sendMail({
			from: `"SynergySign" <${process.env.GOOGLE_USER_EMAIL || process.env.EMAIL_USER}>`,
			to: emailOptions.to,
			subject: emailOptions.subject,
			html: emailOptions.html,
			attachments: emailOptions.attachments,
		});

		console.log("Email sent successfully:", info.messageId);
		return { success: true, messageId: info.messageId };
	} catch (error) {
		console.error("Email sending failed:", error);
		throw error;
	}
}
