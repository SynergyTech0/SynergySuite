import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from "@/lib/auth";
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/templates/[id]/fields/[fieldId]
 * Update a field on a template
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; fieldId: string }> }
) {
  try {
    const { id: templateId, fieldId } = await context.params;
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const template = await prisma.template.findUnique({
      where: { id: templateId },
      select: { fields: true, creatorId: true },
    });

    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    if (template.creatorId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const fields = Array.isArray(template.fields) ? template.fields : [];

    const updatedFields = fields.map((field: any) => {
      if (field.id === fieldId) {
        return { ...field, ...body };
      }
      return field;
    });

    await prisma.template.update({
      where: { id: templateId },
      data: { fields: updatedFields },
    });

    const updatedField = updatedFields.find((f: any) => f.id === fieldId);
    return NextResponse.json({ field: updatedField });
  } catch (error: any) {
    console.error('Error updating template field:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/templates/[id]/fields/[fieldId]
 * Delete a field from a template
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; fieldId: string }> }
) {
  try {
    const { id: templateId, fieldId } = await context.params;
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const template = await prisma.template.findUnique({
      where: { id: templateId },
      select: { fields: true, creatorId: true },
    });

    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    if (template.creatorId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const fields = Array.isArray(template.fields) ? template.fields : [];
    const updatedFields = fields.filter((field: any) => field.id !== fieldId);

    await prisma.template.update({
      where: { id: templateId },
      data: { fields: updatedFields },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting template field:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
