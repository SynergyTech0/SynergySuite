import { NextRequest, NextResponse } from "next/server";
// API endpoint for creating notifications

import { getServerSession } from "@/lib/auth";
import { authOptions } from "@/lib/auth";
import { createNotification } from "@/lib/notifications";

export const dynamic = 'force-dynamic';

// Send later functionality can be added in the future but is not implemented yet
export async function POST(request: NextRequest) {
  try {
    // Get the current user session securely (no email in body)
    const session = await getServerSession(authOptions);

    if (!session || !session.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse the request body
    const { email, subject, message, type, documentId, redirectURL } = await request.json();

    if (!email || !subject || !message || !type) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const notification = await createNotification(
      email,
      subject,
      message,
      type,
      undefined, // userId - will be looked up from email in createNotification
      documentId,
      redirectURL
    );

    return NextResponse.json(notification);
  } catch (error) {
    console.error("Error creating notification:", error);
    return NextResponse.json({ error: "Failed to create notification" }, { status: 500 });
  }
}