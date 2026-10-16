import { NotificationStatus, NotificationType } from "@prisma/client";
import { prisma } from "./db";

export async function createNotification(
	email: string,
	subject: string,
	message: string,
	type: NotificationType,
	userId?: string,
	documentId?: string,
	redirectURL?: string
) {
	if (!email) {
		throw new Error("Email is required");
	}

	let user = userId;
	if (!userId) {
		// Search for the user to see if they exist
		user = await prisma.user
			.findUnique({
				where: { email },
			})
			.then((u) => (u ? u.id : undefined));
	}

	// Create the notification in the database
	const notification = await prisma.notification.create({
		data: {
			email,
			userId: user ?? null,
			subject,
			message,
			type,
			status: NotificationStatus.SENT, // Change in the future if implementing scheduled sending
			documentId,
			redirectURL,
		},
	});

	return notification;
}

export async function retrieveNotifications(
	email: string,
	page: number = 1,
	limit: number = 99999, // Effectively no limit by default
	statusFilter?: NotificationStatus[],
	retention?: number,
	unreadOnly?: boolean,
) {
	if (!email) {
		throw new Error("Email is required");
	}

	const whereClause: any = { email };
	if (unreadOnly) {
		whereClause.read = false;
	}
	if (retention) {
		const cutoff = new Date(Date.now() - retention * 24 * 60 * 60 * 1000);
		whereClause.createdAt = { gte: cutoff };
	}
	if (statusFilter && statusFilter.length > 0) {
		whereClause.type = { in: statusFilter };
	}
	const offset = (page - 1) * limit;

	const notifications = await prisma.notification.findMany({
		where: whereClause,
		orderBy: [{ createdAt: "desc" }],
		select: {
			id: true,
			subject: true,
			message: true,
			createdAt: true,
			read: true,
			type: true,
			documentId: true,
			redirectURL: true,
		},
		skip: offset,
		take: limit,
	});
	return notifications;
}

export async function retrieveNotificationById(notificationId: string) {
	const notification = await prisma.notification.findUnique({
		where: { id: notificationId },
		select: {
			id: true,
			subject: true,
			message: true,
			createdAt: true,
			read: true,
			type: true,
			documentId: true,
			redirectURL: true,
		},
	});
	return notification;
}

export async function markNotificationAsRead(notificationId: string, email?: string) {
	if (email) {
		const notification = await prisma.notification.findUnique({
			where: { id: notificationId },
		});
		if (!notification || notification.email !== email) {
			throw new Error("Unauthorized to mark notification as read");
		}
	}

	await prisma.notification.update({
		where: { id: notificationId },
		data: { read: true },
	});
}

export async function markAllNotificationsAsRead(email: string) {
	await prisma.notification.updateMany({
		where: { email, read: false },
		data: { read: true },
	});
}

// Not implemented yet but could be useful for database cleanup
export async function deleteOldNotifications(retentionDays: number = 30) {
	const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
	await prisma.notification.deleteMany({
		where: { createdAt: { lt: cutoff } },
	});
}

export async function deleteNotification(notificationId: string, email?: string) {
	if (email) {
		const notification = await prisma.notification.findUnique({
			where: { id: notificationId },
		});
		if (!notification || notification.email !== email) {
			throw new Error("Unauthorized to delete notification");
		}
	}

	await prisma.notification.delete({
		where: { id: notificationId },
	});
}

export async function deleteAllNotifications(email: string) {
	await prisma.notification.deleteMany({
		where: { email },
	});
}