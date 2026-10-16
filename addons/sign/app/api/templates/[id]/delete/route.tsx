import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deleteFile } from "@/lib/storage";
import { isDenied, templateFor } from "@/lib/access";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "Missing template id" }, { status: 400 });
    }
    const access = await templateFor(id);
    if (isDenied(access)) return access.denied;

    // ✅ Fetch template metadata before deletion
    const template = await prisma.template.findUnique({
      where: { id },
      select: { cloudStoragePath: true, cloudProvider: true },
    });

    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    // Copies share the stored file, and documents made from the template may point at it too:
    // only the last one out removes it.
    const sharing =
      (await prisma.template.count({ where: { cloudStoragePath: template.cloudStoragePath, id: { not: id } } })) +
      (await prisma.document.count({ where: { cloudStoragePath: template.cloudStoragePath } }));
    if (!sharing) {
      try {
        await deleteFile(template.cloudStoragePath, template.cloudProvider);
      } catch (err) {
        console.warn("⚠️ File delete warning:", err);
      }
    }

    // ✅ Delete the template record from DB
    const deleted = await prisma.template.delete({
      where: { id },
    });
    return NextResponse.json({ template: deleted }, { status: 200 });
  } catch (error: any) {
    if (error?.code === "P2025") {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }
    console.error("❌ Failed to delete template:", error);
    return NextResponse.json(
      { error: "Failed to delete template" },
      { status: 500 }
    );
  }
}
