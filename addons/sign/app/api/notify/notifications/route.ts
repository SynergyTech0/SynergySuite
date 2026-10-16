// API endpoint for retrieving notifications

import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { authOptions } from "@/lib/auth";
import { retrieveNotifications } from "@/lib/notifications";

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    // Get the current user session securely (no email in query params)
    const session = await getServerSession(authOptions);

    if (!session || !session.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Pagination
    const url = new URL(req.url);
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const limit = parseInt(url.searchParams.get("limit") || "10", 10);

    // Retrieve notifications for the authenticated user
    const notifications = await retrieveNotifications(session.user.email, page, limit);

    return NextResponse.json(notifications);
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 });
  }
}