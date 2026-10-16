import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AccountEvent } from "@prisma/client";

export async function POST() {
    // Log sign out event
    console.log("Sign out route called");
    const session = await getServerSession(authOptions);
    if (session) {
        await prisma.accountAuditLog.create({
            data: {
                userId: session.user.id,
                event: AccountEvent.LOGGED_OUT,
            },
        });
    }

    // NextAuth handles the actual sign out process client-side

    return new Response(null, { status: 200 });
}