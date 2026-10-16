"use client";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NotificationType } from "@prisma/client";
import { formatDistanceToNow, set } from "date-fns";
import { Bell, BookCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// Interface for notification data
interface Notification {
	id: string;
	subject: string;
	message: string;
	read: boolean;
	type: NotificationType;
	documentId?: string;
	redirectURL?: string;
	createdAt: Date;
}

// Helper function to render a single notification element
function notificationElement(
	notification: Notification,
	accessNotification?: (notification: Notification) => void,
	readNotification?: (notification: Notification) => void
) {
	return (
		<div
			key={notification.id + notification.subject}
			className={
				"flex items-center transition duration-100 ease-in-out bg-white-1 hover:bg-gray-100" +
				(notification.read ? " bg-gray-100" : "")
			}
		>
			<DropdownMenuItem className="flex-grow" onClick={() => accessNotification?.(notification)}>
				<div className="flex flex-col items-start">
					<div className="font-medium">{notification.subject}</div>
					<div className="text-xs text-gray-400 mt-1">
						{notification.createdAt.toLocaleString().slice(0, 10) +
							" • " +
							formatDistanceToNow(notification.createdAt) +
							" ago"}
					</div>
					<div className="text-sm text-gray-500">
						{notification.message}
					</div>
				</div>
			</DropdownMenuItem>
			<div className="flex-shrink">
				{!notification.read && (
					<Button
						className="p-2 hover:bg-clear"
						variant="ghost"
						size="sm"
						onClick={() => readNotification?.(notification)}
					>
						<BookCheck className="w-6 h-6 text-gray-600 hover:text-blue-600" />
					</Button>
				)}
			</div>
		</div>
	);
}

export function NotificationBell() {
	const [notifications, setNotifications] = useState<Notification[]>([]);
	const [isLoading, setIsLoading] = useState<boolean>(true);
	const router = useRouter();

	const NOTIFICATION_DISPLAY_LIMIT = 10;

	useEffect(() => {
		// Fetch notifications from the API for the current user
		const fetchNotifications = async () => {
			try {
				const response = await fetch("/api/notify/notifications?page=1&limit=" + NOTIFICATION_DISPLAY_LIMIT);
				if (response.ok) {
					const data = await response.json();
					setNotifications(data);
				} else {
					console.error("Failed to fetch notifications");
				}
			} catch (error) {
				console.error("Error fetching notifications:", error);
			} finally {
				setIsLoading(false);
			}
		};

		fetchNotifications();
	}, []);

    // Handler for when a notification is clicked
	const notificationClickHandler = (notification: Notification) => {
		markAsRead(notification);

        // Navigate based on notification details
        // If redirectURL is present, use it; otherwise, use documentId
		if (notification.redirectURL) {
			router.push(notification.redirectURL);
		} else if (notification.documentId) {
            // Navigate based on notification type
			switch (notification.type) {
				// TODO: Add more cases as needed for different notification types
				default:
					router.push(
						`/dashboard/documents/${notification.documentId}`
					);
			}
		}
	};

    // Mark a single notification as read
	const markAsRead = (notification: Notification) => {
		if (notification.read) return; // Already read

		fetch(`/api/notify/notifications/read?id=${notification.id}`, {
			method: "PUT",
		}).then((res) => {
			if (!res.ok) {
				console.error("Failed to mark notification as read");
				return;
			}

			// Optimistically update UI as read
			setNotifications((prevNotifications) =>
				prevNotifications.map((n) =>
					n.id === notification.id ? { ...n, read: true } : n
				)
			);
		});
	};

    // Mark all notifications as read
	const markAllAsRead = () => {
		fetch(`/api/notify/notifications/read/all`, {
			method: "PUT",
		}).then((res) => {
			if (!res.ok) {
				console.error("Failed to mark all notifications as read");
				return;
			}

			// Optimistically update UI as read
			setNotifications((prevNotifications) =>
				prevNotifications.map((n) =>
					n.read === false ? { ...n, read: true } : n
				)
			);
		});
	};

	if (isLoading) {
		return (
			<Button variant="ghost" size="sm" className="relative">
				<Bell className="w-5 h-5" />
			</Button>
		);
	}

    // Render the notification bell with dropdown menu
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="sm" className="relative">
					<Bell className="w-5 h-5" />
					{notifications.some((n) => !n.read) && (
						<span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full"></span>
					)}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="max-w-md min-w-md">
				<div className="flex">
					<DropdownMenuLabel>
						<Bell className="w-4 h-4 mr-2 inline-block" />
						Notifications
					</DropdownMenuLabel>

					<Button
						variant="link"
						size="sm"
						className="ml-auto mr-2"
						onClick={markAllAsRead}
					>
						Mark all as read
					</Button>
				</div>
                {/* TODO: Make notifications scrollable once passes size */}
				<div className="max-h-[100px] sm:max-h-[300px] md:max-h-[500px] overflow-y-auto w-full overflow-x-hidden">
					<DropdownMenuSeparator />
					{/* Notification items will go here */}
					{notifications.length === 0 ? (
						<div className="p-4 text-sm text-gray-500">
							No new notifications
						</div>
					) : (
						notifications.map((notification) =>
							notificationElement(
								notification,
								notificationClickHandler,
								markAsRead
							)
						)
					)}
				</div>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
