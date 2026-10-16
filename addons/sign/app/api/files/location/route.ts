import { NextRequest, NextResponse } from "next/server";
import { getServingLocation } from '@/lib/storage';
import { CloudProvider } from '@prisma/client';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Accept multiple common names for the storage path param for flexibility
    const storagePath = searchParams.get('path') ?? searchParams.get('location') ?? searchParams.get('filePath');
    const providerParam = searchParams.get('provider');

    if (!storagePath || !providerParam) {
      return NextResponse.json({ error: 'Missing required query params: path (or location) and provider' }, { status: 400 });
    }

    // Normalize provider string and map to CloudProvider enum
    const providerKey = providerParam.toUpperCase();
    const providerEnum = (CloudProvider as any)[providerKey] as CloudProvider | undefined;
    if (!providerEnum) {
      return NextResponse.json({ error: `Invalid provider. Supported: ${Object.keys(CloudProvider).join(', ')}` }, { status: 400 });
    }

    const url = await getServingLocation(storagePath, providerEnum);

    console.log(`Resolved serving location: ${url}`);

    return NextResponse.json({ storage: url }, { status: 200 });
  } catch (error) {
    console.error('Failed to resolve storage location:', error);
    return NextResponse.json({ error: 'Failed to resolve storage location' }, { status: 500 });
  }
}
