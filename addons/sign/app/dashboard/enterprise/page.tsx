"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	AlertDialog,
	AlertDialogTrigger,
	AlertDialogContent,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogCancel,
	AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, UserCog, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface EnterpriseInfoResponse {
	id: string;
	name: string;
	seatCount: number;
	active: boolean;

	users: {
		id: string;
		name: string;
		email: string;
		role: string;
		createdAt: Date;
		documentCounts: {
			draft: number;
			sent: number;
			completed: number;
			declined: number;
			expired: number;
			total: number;
		};
		sentDocuments: {
			id: string;
			status: string;
		}[];
	}[];
}

export default function EnterpriseDashboardPage() {
	const [enterpriseInfo, setEnterpriseInfo] =
		useState<EnterpriseInfoResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [search, setSearch] = useState("");
	const { toast } = useToast();
	const router = useRouter();
	const session = useSession();

	useEffect(() => {
		//Don't try to fetch until we have session data and know if user is enterprise admin
		if (!session.data) return;
		console.log("Session data:", session.data);
		if (!session.data?.user.isEnterpriseAdmin) router.replace("/dashboard");
		else {
			fetch("/api/enterprise/info")
				.then((response) => response.json())
				.then((data) => {
					setEnterpriseInfo(data);
				})
				.catch((error) => {
					console.error("Error fetching enterprise info:", error);
				})
				.finally(() => setLoading(false));

		}
	}, [session]);

	async function removeUser(userId: string) {
		const res = await fetch("/api/enterprise/usermanagement/remove", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ userId }),
		});
		if (!res.ok) {
			const error = await res.json();
			toast({
				title: "Error",
				description: error.error,
				variant: "destructive",
			});
		} else {
			toast({
				title: "Success",
				description: "User removed successfully",
			});

			// Optimistically update UI
			setEnterpriseInfo((prev) => {
				if (!prev) return prev;
				return {
					...prev,
					users: prev.users.filter((u) => u.id !== userId),
				};
			});
		}
	}

	// Aggregate stats
	const aggregate = useMemo(() => {
		if (!enterpriseInfo)
			return {
				draft: 0,
				sent: 0,
				completed: 0,
				declined: 0,
				expired: 0,
				total: 0,
			};
		return enterpriseInfo.users.reduce(
			(acc, u) => {
				acc.draft += u.documentCounts?.draft || 0;
				acc.sent += u.documentCounts?.sent || 0;
				acc.completed += u.documentCounts?.completed || 0;
				acc.declined += u.documentCounts?.declined || 0;
				acc.expired += u.documentCounts?.expired || 0;
				acc.total += u.documentCounts?.total || 0;
				return acc;
			},
			{
				draft: 0,
				sent: 0,
				completed: 0,
				declined: 0,
				expired: 0,
				total: 0,
			}
		);
	}, [enterpriseInfo]);

	const filteredUsers = useMemo(() => {
		if (!enterpriseInfo) return [];
		if (!search) return enterpriseInfo.users;
		return enterpriseInfo.users.filter(
			(u) =>
				u.name.toLowerCase().includes(search.trim().toLowerCase()) ||
				u.email.toLowerCase().includes(search.trim().toLowerCase())
		);
	}, [enterpriseInfo, search]);

	return (
		<div className="p-6 space-y-6">
			{/* Header */}
			<div className="flex items-center space-x-4">
				<Link href="/dashboard">
					<Button
					variant="outline"
					className="px-4 py-6 text-lg font-semibold border-2 rounded-lg"
					>
					<ArrowLeft className="w-5 h-8 mr-2" /> Back
					</Button>
				</Link>
				<div className="flex justify-between items-center w-full">
					<div className="flex flex-col gap-4">
						<div className="flex items-center justify-between">
							<div>
								<h1 className="text-2xl font-bold">
									{enterpriseInfo?.name ||
										"Enterprise Dashboard"}
								</h1>
								<p className="text-sm text-muted-foreground">
									Organization overview and user activity
								</p>
							</div>
						</div>
					</div>
					<Badge
						className={
							"text-md hidden sm:block " +
							(enterpriseInfo?.active
								? "bg-green-500 hover:bg-green-500"
								: "bg-gray-500 hover:bg-gray-500")
						}
					>
						{enterpriseInfo?.active ? "Active" : "Inactive"}
					</Badge>
				</div>
			</div>
			{/* High-level stats */}
			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
				<StatCard
					label="Total Documents"
					value={aggregate.total}
					className="bg-gradient-to-br from-slate-900 to-slate-700"
				/>
				<StatCard
					label="Documents Sent"
					value={aggregate.sent}
					className="bg-gradient-to-br from-blue-700 to-blue-500"
				/>
				<StatCard
					label="Seats Used"
					value={`${enterpriseInfo?.users.length || 0} / ${
						enterpriseInfo?.seatCount || 0
					}`}
					className="bg-gradient-to-br from-purple-700 to-purple-500"
				/>
				<StatCard
					label="Completed"
					value={aggregate.completed}
					className="bg-gradient-to-br from-emerald-600 to-emerald-400"
				/>
			</div>

			{/* Actions & Search */}
			<div className="flex items-center gap-4">
				<input
					type="text"
					placeholder="Search users..."
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className="flex-grow rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
				/>
				<span className="text-xs text-muted-foreground ml-auto hidden sm:block">
					{filteredUsers.length} of{" "}
					{enterpriseInfo?.users.length || 0} users
				</span>
				{addUserModal({ setEnterpriseInfo })}
			</div>

			{/* Users Table */}
			<div className="overflow-x-auto rounded-md border">
				<table className="w-full text-sm">
					<thead className="bg-muted/50">
						<tr className="text-left">
							<th className="p-2 font-medium">Name</th>
							<th className="p-2 hidden md:table-cell font-medium">
								Email
							</th>
							<th className="p-2 font-medium text-center hidden lg:table-cell">
								Draft
							</th>
							<th className="p-2 font-medium text-center hidden lg:table-cell">
								Sent
							</th>
							<th className="p-2 font-medium text-center hidden lg:table-cell">
								Completed
							</th>
							<th className="p-2 font-medium text-center hidden lg:table-cell">
								Declined
							</th>
							<th className="p-2 font-medium text-center hidden lg:table-cell">
								Expired
							</th>
							<th className="p-2 font-medium text-center lg:hidden">
								In Progress
							</th>
							<th className="p-2 font-medium text-center lg:hidden">
								Completed
							</th>
							<th className="p-2 font-medium text-right">
								<span className="hidden sm:inline">
									Actions
								</span>
							</th>
						</tr>
					</thead>
					<tbody>
						{loading && (
							<tr>
								<td
									colSpan={5}
									className="p-6 text-center text-muted-foreground"
								>
									Loading users...
								</td>
							</tr>
						)}
						{!loading && filteredUsers.length === 0 && (
							<tr>
								<td
									colSpan={5}
									className="p-6 text-center text-muted-foreground"
								>
									No users found.
								</td>
							</tr>
						)}
						{!loading &&
							filteredUsers.map((u) => {
								const counts = u.documentCounts || {
									draft: 0,
									sent: 0,
									completed: 0,
									declined: 0,
									expired: 0,
									total: 0,
								};
								const inProgress = counts.draft + counts.sent;
								const completedGroup =
									counts.completed +
									counts.declined +
									counts.expired;
								const isAdmin = u.id == session.data?.user.id;
								return (
									<tr
										key={u.id}
										className="border-t hover:bg-muted/30"
									>
										<td className="p-2 table-cell font-medium">
											<div className="flex items-center gap-2">
												{isAdmin && <UserCog />}
												{u.name || "(No name)"}
											</div>
										</td>
										<td className="p-2 hidden md:table-cell break-all">
											{u.email}
										</td>
										<td className="p-2 text-center hidden lg:table-cell">
											<span className="inline-block rounded-md bg-gray-600 text-white px-2 py-1 text-xs w-8 text-center">
												{counts.draft}
											</span>
										</td>
										<td className="p-2 text-center hidden lg:table-cell">
											<span className="inline-block rounded-md bg-blue-600 text-white px-2 py-1 text-xs w-8 text-center">
												{counts.sent}
											</span>
										</td>
										<td className="p-2 text-center hidden lg:table-cell">
											<span className="inline-block rounded-md bg-green-600 text-white px-2 py-1 text-xs w-8 text-center">
												{counts.completed}
											</span>
										</td>
										<td className="p-2 text-center hidden lg:table-cell">
											<span className="inline-block rounded-md bg-red-600 text-white px-2 py-1 text-xs w-8 text-center">
												{counts.declined}
											</span>
										</td>
										<td className="p-2 text-center hidden lg:table-cell">
											<span className="inline-block rounded-md bg-yellow-600 text-white px-2 py-1 text-xs w-8 text-center">
												{counts.expired}
											</span>
										</td>
										<td className="p-2 text-center lg:hidden">
											<span className="inline-block rounded-md bg-blue-600 text-white px-2 py-1 text-xs min-w-[3rem] text-center">
												{inProgress}
											</span>
										</td>
										<td className="p-2 text-center lg:hidden">
											<span className="inline-block rounded-md bg-green-600 text-white px-2 py-1 text-xs min-w-[3rem] text-center">
												{completedGroup}
											</span>
										</td>
										<td className="p-2">
											<div className="flex gap-2 justify-end">
												<RemoveUserModal
													user={{
														id: u.id,
														email: u.email,
														name: u.name,
														isAdmin,
													}}
													removeUser={removeUser}
												/>
											</div>
										</td>
									</tr>
								);
							})}
					</tbody>
				</table>
			</div>
		</div>
	);
}

interface StatCardProps {
	label: string;
	value: string | number;
	className?: string;
}

function StatCard({ label, value, className }: StatCardProps) {
	return (
		<div
			className={`rounded-md p-4 text-white shadow-sm flex flex-col gap-1 ${
				className || "bg-slate-700"
			}`}
		>
			<span className="text-xs uppercase tracking-wide opacity-80">
				{label}
			</span>
			<span className="text-xl font-semibold">{value}</span>
		</div>
	);
}

function addUserModal({
	setEnterpriseInfo,
}: {
	setEnterpriseInfo: React.Dispatch<
		React.SetStateAction<EnterpriseInfoResponse | null>
	>;
}) {
	const { toast } = useToast();

	const [inviteOpen, setInviteOpen] = useState(false);
	const [inviteEmail, setInviteEmail] = useState("");
	const [inviteLoading, setInviteLoading] = useState(false);

	return (
		<AlertDialog
			open={inviteOpen}
			onOpenChange={(o) => {
				setInviteOpen(o);
				if (!o) {
					setInviteEmail("");
				}
			}}
		>
			<AlertDialogTrigger asChild>
				<Button size="sm" variant="outline">
					<UserPlus className="inline sm:hidden" />
					<span className="hidden sm:inline">Add User</span>
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						Invite User to Enterprise
					</AlertDialogTitle>
					<AlertDialogDescription>
						Enter the email address of the person you want to
						invite. If they already have an account they will be
						added immediately. Otherwise they will receive an
						invitation email.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<div className="space-y-3">
					<label className="text-sm font-medium flex flex-col gap-1">
						<span>Email</span>
						<Input
							placeholder="person@example.com"
							type="email"
							value={inviteEmail}
							onChange={(e) => setInviteEmail(e.target.value)}
							disabled={inviteLoading}
						/>
					</label>
				</div>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={inviteLoading}>
						Cancel
					</AlertDialogCancel>
					<AlertDialogAction
						onClick={async () => {
							if (!inviteEmail || !inviteEmail.includes("@")) {
								toast({
									title: "Invalid email",
									description:
										"Please enter a valid email address.",
								});
								return;
							}
							setInviteLoading(true);
							try {
								const res = await fetch(
									"/api/enterprise/usermanagement/add",
									{
										method: "PUT",
										headers: {
											"Content-Type": "application/json",
										},
										body: JSON.stringify({
											email: inviteEmail.trim(),
										}),
									}
								);
								const data = await res.json();
								if (res.ok) {
									toast({
										title: "Invitation Sent",
										description:
											data.message || "User processed.",
									});
									// Refresh enterprise info
									fetch("/api/enterprise/info")
										.then((r) => r.json())
										.then((d) => setEnterpriseInfo(d))
										.catch((err) => console.error(err));
									setInviteOpen(false);
								} else {
									toast({
										title: "Error",
										description:
											data.error ||
											data.message ||
											"Failed to invite user.",
									});
								}
							} catch (e) {
								toast({
									title: "Network Error",
									description: "Could not reach server.",
								});
							} finally {
								setInviteLoading(false);
							}
						}}
						disabled={inviteLoading}
					>
						{inviteLoading ? "Processing..." : "Send Invitation"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function RemoveUserModal({
	user,
	removeUser,
}: {
	user: { id: string; email: string; name: string; isAdmin: boolean };
	removeUser: (userId: string) => void;
}) {
	const [removeOpen, setRemoveOpen] = useState(false);

	return (
		<AlertDialog
			open={removeOpen}
			onOpenChange={(o) => {
				setRemoveOpen(o);
			}}
		>
			<AlertDialogTrigger asChild>
				<Button
					size="sm"
					variant="secondary"
					disabled={user.isAdmin}
					onClick={() => setRemoveOpen(true)}
				>
					<span className="hidden sm:inline">Remove</span>
					<span className="sm:hidden">-</span>
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						Remove User from Enterprise
					</AlertDialogTitle>
					<AlertDialogDescription>
						Are you sure you want to remove this user from the
						enterprise?
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						onClick={async () => {
							removeUser(user.id);
							setRemoveOpen(false);
						}}
					>
						Remove User
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
