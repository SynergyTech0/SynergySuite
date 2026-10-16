import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }>}
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const fieldData = await request.json();
    const documentId = ((await context.params).id);

    const field = await prisma.documentField.create({
      data: {
        documentId,
        fieldType: fieldData.fieldType,
        label: fieldData.label,
        pageNumber: fieldData.pageNumber || 1,
        x: fieldData.x,
        y: fieldData.y,
        width: fieldData.width,
        height: fieldData.height,
        assignedToId: fieldData.assignedToId || null,
        value: null,
      },
    });

    return NextResponse.json({ field });
  } catch (error) {
    console.error('Failed to create field:', error);
    return NextResponse.json({ error: 'Failed to create field' }, { status: 500 });
  }
}
