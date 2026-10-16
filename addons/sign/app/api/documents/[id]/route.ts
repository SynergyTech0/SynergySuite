import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { CloudProvider } from "@prisma/client";

interface DocumentDetails {
  id: string;
  title: string;
  description: string;
  status: string;
  signingOrder: string;
  createdAt: string;
  updatedAt: string;
  deadline: string | null;
  cloudStoragePath: string;
  cloudProvider: CloudProvider | null;
  sender: { id: string; name: string; email: string };
  signers: Array<{
    id: string;
    email: string;
    name: string | null;
    userId: string | null;
    status: string;
    signedAt: string | null;
    order: number;
  }>;
  fields?: SignatureField[];
}

interface SignatureField {
  id: string;
  type: "Signature" | "Date" | "Name" | "Email" | "Text";
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  value?: string | null;
  assignedToId?: string | null;
  fieldType?: string;
  label?: string;
  required?: boolean;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    // ✅ Fix: properly destructure params
    const { id } = await context.params;

    const document = await prisma.document.findUnique({
      where: { id },
      include: {
        sender: true,
        signers: {
          include: {
            user: true,
          },
        },
        fields: true,
      },
    });

    if (!document) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 },
      );
    }

    // ✅ Map signers
    const signers = document.signers.map((signer) => ({
      id: signer.id,
      email: signer.email,
      name: signer.user?.name || signer.name || null,
      userId: signer.userId || null,
      status: signer.status,
      signedAt: signer.signedAt ? signer.signedAt.toISOString() : null,
      order: signer.order,
    }));

    // ✅ Map fields
    const fieldTypeMap: Record<string, SignatureField["type"]> = {
      SIGNATURE: "Signature",
      DATE: "Date",
      TEXT: "Text",
    };

    const fields: SignatureField[] = document.fields.map((field) => ({
      id: field.id,
      type: fieldTypeMap[field.fieldType] ?? "Text",
      pageNumber: field.pageNumber ?? 1,
      x: field.x,
      y: field.y,
      width: field.width,
      height: field.height,
      value: field.value,
      assignedToId: field.assignedToId,
      fieldType: field.fieldType,
      label: field.label,
      required: field.required,
    }));

    // Here file access must go through /api/documents/[id]/secure-url
    const response: DocumentDetails = {
      id: document.id,
      title: document.title,
      description: document.description ?? "",
      status: document.status,
      signingOrder: document.signingOrder,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
      deadline: document.deadline ? document.deadline.toISOString() : null,
      cloudStoragePath: "", // Use /secure-url instead
      cloudProvider: CloudProvider.NONE, // Internal implementation
      sender: {
        id: document.sender.id,
        name: document.sender.name ?? "",
        email: document.sender.email,
      },
      signers,
      fields,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("❌ Error fetching document:", error);
    return NextResponse.json(
      { error: "Internal server error", details: String(error) },
      { status: 500 },
    );
  }
}
