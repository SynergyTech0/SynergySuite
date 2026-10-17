import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isDenied, templateFor } from "@/lib/access";

// Note: Doesn't make a deep copy of files in storage, just DB entries which allows for different fields added ontop
export async function POST(
	request: Request,
	{ params }: { params: { id: string } }
) {
	const { id } = params;
	const access = await templateFor(id, { read: true });
	if (isDenied(access)) return access.denied;

	try {
		// Fetch the original template
		const originalTemplate = await prisma.template.findUnique({
			where: { id },
		});

		if (!originalTemplate) {
			return NextResponse.json({ error: "Template not found" }, { status: 404 });
		}

		// Create a new template with the same data
		const newTemplate = await prisma.template.create({
			data: {
				name: `${originalTemplate.name} (Copy)`,
				description: originalTemplate.description || "",
				cloudStoragePath: originalTemplate.cloudStoragePath,
                originalFileName: originalTemplate.originalFileName,
				fileType: originalTemplate.fileType,
				fileSize: originalTemplate.fileSize,
				cloudProvider: originalTemplate.cloudProvider,
				isPublic: originalTemplate.isPublic,
				// The copy belongs to whoever made it.
				creatorId: access.session.user.id,
			},
		});

		return NextResponse.json(newTemplate);
	} catch (error) {
		console.error("Error copying template:", error);
		return NextResponse.json({ error: "Failed to copy template" }, { status: 500 });
	}
}
