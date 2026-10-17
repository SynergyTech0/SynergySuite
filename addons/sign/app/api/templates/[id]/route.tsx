import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isDenied, templateFor } from '@/lib/access';

export async function GET(
    request: Request,
    { params }: { params: { id: string } }
) {
    const { id } = params;
    const __access = await templateFor(id, { read: true });
    if (isDenied(__access)) return __access.denied;
    try {
        const originalTemplate = await prisma.template.findUnique({
            where: { id },
        });

        if (!originalTemplate) {
            return NextResponse.json({ error: 'Template not found' }, { status: 404 });
        }

        return NextResponse.json(originalTemplate);
    } catch (error) {
        console.error('Error fetching template:', error);
        return NextResponse.json({ error: 'Failed to fetch template' }, { status: 500 });
    }
}