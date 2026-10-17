import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from "@/lib/auth";
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { copyFile } from '@/lib/storage';
import { DocumentStatus } from '@prisma/client';
export const dynamic = 'force-dynamic';

/**
 * POST /api/templates/[id]/use
 * Create a document from a template with signers
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: templateId } = await context.params;
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const template = await prisma.template.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    const body = await request.json();
    const { signers, title, description } = body;

    if (!signers || signers.length === 0) {
      return NextResponse.json(
        { error: 'At least one signer is required' },
        { status: 400 }
      );
    }

    // Copy the template file to a new document location
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    const newFilePath = `documents/${timestamp}-${randomId}-${template.originalFileName}`;

    // Copy file in storage
    await copyFile(
      template.cloudStoragePath,
      newFilePath,
      template.cloudProvider
    );

    // Create the document
    const document = await prisma.document.create({
      data: {
        title: title || `Document from ${template.name}`,
        description: description || template.description || '',
        cloudStoragePath: newFilePath,
        cloudProvider: template.cloudProvider,
        originalFileName: template.originalFileName,
        fileType: template.fileType,
        fileSize: template.fileSize,
        status: DocumentStatus.DRAFT,
        signingOrder: 'PARALLEL',
        senderId: session.user.id,
        templateId: templateId,
      },
    });

    // Create document signers
    const signerPromises = signers.map((signer: any, index: number) =>
      prisma.documentSigner.create({
        data: {
          documentId: document.id,
          email: signer.email,
          name: signer.name || signer.email,
          status: 'PENDING',
          order: index + 1,
        },
      })
    );

    const createdSigners = await Promise.all(signerPromises);

    // Copy template fields to document fields (if template has fields)
    if (template.fields && Array.isArray(template.fields) && template.fields.length > 0) {
      const fieldPromises = (template.fields as any[]).map((field: any) => {
        // Map template field assignedToId (which might be index-based) to actual signer ID
        let assignedToId = null;
        if (field.assignedToId !== null && field.assignedToId !== undefined) {
          // If assignedToId is a number (index), use it to find the signer
          const signerIndex = typeof field.assignedToId === 'number'
            ? field.assignedToId
            : parseInt(field.assignedToId, 10);

          if (!isNaN(signerIndex) && signerIndex >= 0 && signerIndex < createdSigners.length) {
            assignedToId = createdSigners[signerIndex].id;
          }
        }

        return prisma.documentField.create({
          data: {
            documentId: document.id,
            fieldType: field.fieldType,
            label: field.label || field.fieldType,
            x: Number(field.x),
            y: Number(field.y),
            width: Number(field.width),
            height: Number(field.height),
            pageNumber: field.pageNumber || 1,
            assignedToId,
            required: field.required || false,
          },
        });
      });

      await Promise.all(fieldPromises);
    }

    // Increment template usage count
    await prisma.template.update({
      where: { id: templateId },
      data: { usageCount: { increment: 1 } },
    });

    return NextResponse.json({
      success: true,
      documentId: document.id,
      message: 'Document created from template successfully',
    });
  } catch (error: any) {
    console.error('Error using template:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
