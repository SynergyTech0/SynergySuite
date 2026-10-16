// API endpoint for marking an individual notification as read

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { markNotificationAsRead } from "@/lib/notifications";

export const dynamic = 'force-dynamic';

export async function PUT(req: Request) {
  try {
    // Get the current user session securely (no email in query params)
    const session = await getServerSession(authOptions);

    if (!session || !session.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Extract notification ID from query parameters
    const url = new URL(req.url);
    const notificationId = url.searchParams.get('id');

    if (!notificationId) {
      return NextResponse.json({ error: "Notification ID is required" }, { status: 400 });
    }

    // Mark the notification as read for the authenticated user
    await markNotificationAsRead(notificationId, session.user.email);

    return NextResponse.json({ message: "Notifications marked as read" });
  } catch (error) {
    console.error("Error marking notifications as read:", error);
    return NextResponse.json({ error: "Failed to mark notifications as read" }, { status: 500 });
  }
}