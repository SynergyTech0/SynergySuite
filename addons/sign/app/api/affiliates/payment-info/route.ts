
import { NextResponse } from 'next/server';
import { getServerSession } from "@/lib/auth";
import { authOptions } from '@/lib/auth';
import { prisma as db } from '@/lib/db';

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { payoutMethod, payoutEmail, stripeAccountId } = body;

    const user = await db.user.update({
      where: { email: session.user.email },
      data: {
        payoutMethod,
        payoutEmail,
        stripeAccountId: stripeAccountId || null,
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Payment information updated successfully'
    });

  } catch (error: any) {
    console.error('Error updating payment info:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await db.user.findUnique({
      where: { email: session.user.email },
      select: {
        payoutMethod: true,
        payoutEmail: true,
        stripeAccountId: true,
      }
    });

    return NextResponse.json(user);

  } catch (error: any) {
    console.error('Error fetching payment info:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
