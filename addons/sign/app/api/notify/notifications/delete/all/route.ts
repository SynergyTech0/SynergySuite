// API endpoint for deleting all notifications for a user

import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { authOptions } from "@/lib/auth";
import { deleteAllNotifications } from "@/lib/notifications";

export async function DELETE(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await deleteAllNotifications(session.user.email);

    return NextResponse.json({ message: "All notifications deleted successfully" });
  } catch (error) {
    console.error("Error deleting all notifications:", error);
    return NextResponse.json({ error: "Failed to delete all notifications" }, { status: 500 });
  }
}