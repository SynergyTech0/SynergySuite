import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
	getSubscriptionLimits,
	canPerformAction,
} from "@/lib/subscription-limits";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { verify } from "jsonwebtoken";
import { getStorageDir } from "@/lib/storage";
import {
	scanPDFSecurity,
	getSecurityRecommendations,
} from "@/lib/pdf-security";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
	try {
		// 1️⃣ Auth
		const session = await getServerSession(authOptions);
		let userId: string | null = session?.user?.id || null;

		if (!userId) {
			const authHeader = request.headers.get("authorization");
			if (authHeader?.startsWith("Bearer ")) {
				try {
					const token = authHeader.split(" ")[1];
					const decoded: any = verify(
						token,
						process.env.NEXTAUTH_SECRET!
					);
					userId = decoded.userId || decoded.id || null;
				} catch {
					// Invalid or expired JWT
				}
			}
		}

		if (!userId)
			return NextResponse.json(
				{ error: "Unauthorized" },
				{ status: 401 }
			);

		// 2️⃣ User + subscription
		const user = await prisma.user.findUnique({
			where: { id: userId },
			include: { subscription: true },
		});

		if (!user)
			return NextResponse.json(
				{ error: "User not found" },
				{ status: 404 }
			);

		if (!user.subscription)
			return NextResponse.json(
				{ error: "No active subscription found." },
				{ status: 400 }
			);

		//Add more checks for subscription limits here in the future

		// 3️⃣ Limit check
		// const limits = getSubscriptionLimits(user.subscription.tier);
		// if (
		//   !canPerformAction(
		//     user.subscription.tier,
		//     user.documentsThisMonth,
		//     limits.documentsPerMonth
		//   )
		// ) {
		//   return NextResponse.json(
		//     { error: "Document limit reached for your tier." },
		//     { status: 403 }
		//   );
		// }

		// 4️⃣ Parse FormData
		const formData = await request.formData();
		const file = formData.get("file") as File | null;
		const title = formData.get("title") as string;
		const description =
			(formData.get("description") as string) || undefined;

		if (!file || !title)
			return NextResponse.json(
				{ error: "Missing required fields: file or title" },
				{ status: 400 }
			);

		if (!(file instanceof File)) {
			return NextResponse.json(
				{ error: "Invalid file object" },
				{ status: 400 }
			);
		}

		if (!file.name || file.name.includes("..") || file.name.includes("/")) {
			return NextResponse.json(
				{ error: "Invalid file name" },
				{ status: 400 }
			);
		}

		// 6️⃣ Validate file type
		const allowedTypes = [
			"application/pdf",
			"application/msword",
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			"text/plain",
		];
		if (!allowedTypes.includes(file.type)) {
			return NextResponse.json(
				{ error: "Only PDF, DOC, DOCX, or TXT files allowed." },
				{ status: 400 }
			);
		}

		// 6.5️⃣ Security scan for PDFs
		const buffer = Buffer.from(await file.arrayBuffer());

		if (file.type === "application/pdf") {
			const securityScan = await scanPDFSecurity(buffer);

			if (!securityScan.safe) {
				// Log the attempted upload (skip if audit log fails due to foreign key issues)
				try {
					await prisma.auditLog.create({
						data: {
							userId,
							action: "TEMPLATE_CREATED",
							details: {
								title,
								originalFileName: file.name,
								securityThreats: securityScan.threats,
								securityWarnings: securityScan.warnings,
								blocked: true,
							},
						},
					});
				} catch (auditError) {
					// Failed to create audit log
				}

				return NextResponse.json(
					{
						error: "Template upload blocked due to security concerns",
						threats: securityScan.threats,
						warnings: securityScan.warnings,
						recommendations:
							getSecurityRecommendations(securityScan),
					},
					{ status: 400 }
				);
			}

			// Log warnings but allow upload
			if (securityScan.warnings.length > 0) {
				// PDF warnings detected but allowing upload
			}
		}

		// 7️⃣ Save locally (skip S3 for now)

		// Secure, unique filename
		const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
		const uniqueId = crypto.randomBytes(6).toString("hex");
		const localFileName = `${Date.now()}-${uniqueId}-${sanitizedFileName}`;
		const filePathKey = path.join("templates", localFileName);
		const localPath = await getStorageDir(filePathKey, "LOCAL").then(
			(res) => res.path
		);
		await fs.promises.mkdir(path.dirname(localPath), { recursive: true });

		await fs.promises.writeFile(localPath, buffer);

		// Public API-accessible path
		const cloudStoragePath = filePathKey;

		// 7️⃣ Create DB record
		const template = await prisma.template.create({
			data: {
				name: title,
				description: description || null,
				cloudStoragePath,
				originalFileName: file.name || "unknown",
				fileType: file.type || "",
				fileSize: file.size || 0,
				creatorId: userId,
				cloudProvider: "LOCAL",
			},
		});


        // Forign key issues with audit log currently skipping
		// await prisma.auditLog.create({
		// 	data: {
		// 		documentId: template.id,
		// 		userId,
		// 		action: "TEMPLATE_CREATED",
		// 		details: { title, originalFileName: file.name },
		// 	},
		// });

		// ✅ Clean JSON response
		return NextResponse.json({
			success: true,
			template: {
				...template,
				cloudStoragePath,
			},
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		return NextResponse.json(
			{ 
				error: "Failed to upload template",
				details: process.env.NODE_ENV === "development" ? errorMessage : undefined
			},
			{ status: 500 }
		);
	}
}
