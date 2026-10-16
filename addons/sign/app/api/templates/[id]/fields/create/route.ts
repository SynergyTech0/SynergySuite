import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/templates/[id]/fields/create
 * Create a new field on a template
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
      select: { fields: true, creatorId: true },
    });

    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    // Check permissions
    if (template.creatorId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { fieldType, label, x, y, width, height, pageNumber, assignedToId } = body;

    // Generate a unique ID for the field
    const fieldId = `temp-field-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const newField = {
      id: fieldId,
      fieldType,
      label: label || fieldType,
      x: Number(x),
      y: Number(y),
      width: Number(width),
      height: Number(height),
      pageNumber: pageNumber || 1,
      assignedToId: assignedToId || null,
      value: null,
      required: false,
    };

    // Get existing fields or initialize empty array
    const existingFields = Array.isArray(template.fields) ? template.fields : [];
    const updatedFields = [...existingFields, newField];

    // Update template with new fields
    await prisma.template.update({
      where: { id: templateId },
      data: { fields: updatedFields },
    });

    return NextResponse.json({ field: newField });
  } catch (error: any) {
    console.error('Error creating template field:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
