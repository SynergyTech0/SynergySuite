"use client";

import { useEffect, useState } from "react";
import { Mail, Clock, CheckCircle, Eye, ChevronLeft } from "lucide-react";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
	CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";

// ---------------
// Data structure for individual signer profile
// ---------------
export interface IndividualSignerStats {
	id: string | null;
	name: string;
	email: string;
	companyName: string | null;
	image: string | null;
	documentsCount: number;
	completedCount: number;
	pendingCount: number;
	documentIds: string[];
	documents: Array<{
		id: string;
		title: string;
		date: Date;
		status: string;
	}>;
}

function header(signer: IndividualSignerStats) {
	return (
		<Card key={signer.id + signer.email}>
			<CardContent className="p-6">
				<div className="flex items-center justify-between">
					<div className="flex items-center space-x-4">
						<Avatar className="h-12 w-12">
							<AvatarFallback className="bg-blue-100 text-blue-600 font-semibold">
								{signer.name
									.split(" ")
									.map((n: string) => n[0].toUpperCase())
									.join("")}
							</AvatarFallback>
						</Avatar>
						<div>
							<h3 className="font-semibold text-gray-900">
								{signer.name}
							</h3>
							<p className="text-sm text-gray-600 flex items-center space-x-1">
								<Mail className="w-3 h-3" />
								<span>{signer.email}</span>
							</p>
						</div>
					</div>
					<div className="flex items-center space-x-6">
						<div className="text-center">
							<p className="text-2xl font-bold text-gray-900">
								{signer.documentsCount}
							</p>
							<p className="text-sm text-gray-600">Total</p>
						</div>
						<div className="text-center">
							<p className="text-2xl font-bold text-yellow-600">
								{signer.pendingCount}
							</p>
							<p className="text-sm text-gray-600">Pending</p>
						</div>
						<div className="text-center">
							<p className="text-2xl font-bold text-green-600">
								{signer.completedCount}
							</p>
							<p className="text-sm text-gray-600">Completed</p>
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

export default function SignerProfile({
	params,
}: {
	params: { email: string };
}) {
	//Find and display individual signer profile data
	const [signer, setSigner] = useState<IndividualSignerStats>();
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		const fetchSigners = async () => {
			try {
				// Ensure email is properly encoded for URL
				const cleanEmail = decodeURIComponent(params.email); // First decode any encoded params
				const response = await fetch(
					`/api/signers/${encodeURIComponent(cleanEmail)}/profile`
				);
				if (response.ok) {
					const data = await response.json();
					setSigner(data); // Remove .signers as the API returns the data directly
				}
			} catch (error) {
				console.error("Failed to fetch signers:", error);
			} finally {
				setLoading(false);
			}
		};

		fetchSigners();
	}, []);

	if (loading) {
		return <div>Loading...</div>;
	}

	if (!signer) {
		return <div>Signer not found.</div>;
	}

	// Display signer profile and document information
	return (
		<div className="p-6 max-w-5xl mx-auto space-y-6">
			<div className="flex items-center space-x-4">
				<Link href="/dashboard/signers">
					<Button variant="ghost" size="lg" className="mb-2">
						<ChevronLeft />
					</Button>
				</Link>
				<div className='flex flex-col'>
					<h1 className="text-3xl font-bold text-gray-900">Signer Profile</h1>
					<p className="text-gray-600 mt-1">View and manage signer information</p>
				</div>
			</div>

			{header(signer)}

			<Card className="mt-3">
				<CardHeader>
					<CardTitle>Shared Documents</CardTitle>
					<CardDescription>
						These are the documents that have been shared with this
						signer.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{signer.documentsCount === 0 ? (
						<p className="text-gray-600">
							No documents shared with this signer.
						</p>
					) : (
						<div className="flex flex-col gap-2">
							{signer.documents.map((document) => (
								<div
									key={document.id}
									className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:shadow-sm transition-shadow"
								>
									<div className="flex items-center space-x-4">
										{document.status === "PENDING" ? (
											<div
												className={`p-3 rounded-lg bg-orange-100 flex-initial`}
											>
												<Clock
													className={`w-6 h-6 text-orange-600`}
												/>
											</div>
										) : (
											<div
												className={`p-3 rounded-lg bg-green-100 flex-initial`}
											>
												<CheckCircle
													className={`w-6 h-6 green-orange-600`}
												/>
											</div>
										)}
										<div className="min-w-0 flex-1">
											<div className="flex items-center space-x-2 mb-1">
												<p className="text-sm font-medium text-gray-900 truncate">
													{document.title}
												</p>
											</div>
											<div className="flex items-center space-x-4 text-xs text-gray-500">
												<span>
													{new Date(
														document.date
													).getMonth() +
														"/" +
														new Date(
															document.date
														).getDate() +
														"/" +
														new Date(
															document.date
														).getFullYear()}
												</span>
												<span>•</span>
												<span>
													{formatDistanceToNow(
														new Date(document.date)
													)}
													{" ago"}
												</span>
											</div>
										</div>
									</div>

									<div className="flex items-center space-x-2">
										<Link
											href={`/dashboard/documents/${document.id}`}
										>
											<Button variant="ghost" size="sm">
												<Eye className="w-4 h-4" />
											</Button>
										</Link>
									</div>
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
