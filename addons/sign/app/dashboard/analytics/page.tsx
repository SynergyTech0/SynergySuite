"use client";

import { DashboardStats } from "@/components/dashboard/dashboard-stats";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEffect, useState } from "react";
import { SignerStatus } from "@prisma/client";
import {
	Chart as ChartJS,
	CategoryScale,
	LineController,
	LinearScale,
	BarController,
	BarElement,
	PointElement,
	LineElement,
	Legend,
	Tooltip,
	Filler,
	Title,
	ArcElement,
	RadialLinearScale,
} from "chart.js";
import { DocumentStatusChart } from "./graphs/DocumentStatusChart";
import { SigningTrendsChart } from "./graphs/SigningTrendsChart";
import { CompletionTimeChart } from "./graphs/CompletionTimeChart";
import { DocumentAnalyticsChart } from "./graphs/DocumentAnalyticsChart";
import { SignerAnalyticsChart } from "./graphs/SignerAnalyticsChart";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

type AggregatedStats = {
	totalDocuments: number;
	pendingSignatures: number;
	completedDocuments: number;
	activeSigners: number;
};

type Stats = {
	aggregatedStats: AggregatedStats;
	documentSigners: Array<{
		status: SignerStatus;
		documentId: string;
		email: string;
		name: string;
		signedAt: Date | null;
		declinedAt: Date | null;
		createdAt: Date;
	}>;
	signerStatusAggregation: Record<string, Record<string, number>>;
	documents: Array<{
		id: string;
		title: string;
		createdAt: Date;
		completedAt: Date | null;
		deadline: Date | null;
		status: string;
	}>;
};

export default function AnalyticsPage() {
	const [stats, setStats] = useState<Stats>();
	const [loading, setLoading] = useState(true);

	ChartJS.register(
		ArcElement,
		CategoryScale,
		LineController,
		LinearScale,
		BarController,
		BarElement,
		PointElement,
		LineElement,
		Legend,
		Tooltip,
		CategoryScale,
		Title,
		Filler,
		RadialLinearScale
	);

	useEffect(() => {
		// Fetch stats from API
		async function fetchStats() {
			try {
				const res = await fetch("/api/dashboard/stats/signing");
				const data = await res.json();
				setStats(data);
				setLoading(false);
			} catch (error) {
				console.error("Failed to fetch stats:", error);
			}
		}

		fetchStats();
	}, []);

	return (
		<div className="p-6 space-y-6">
			<div className="flex items-center space-x-4">
				<Link href="/dashboard">
					<Button
					variant="outline"
					className="px-4 py-6 text-lg font-semibold border-2 rounded-lg"
					>
					<ArrowLeft className="w-5 h-8 mr-2" /> Back
					</Button>
				</Link>
				<div className="flex flex-col">
					<h1 className="text-3xl font-bold text-gray-900">Analytics</h1>
					<p className="text-gray-600 mt-1">
						Track your document signing performance
					</p>
				</div>
			</div>

			{/* Stats Overview */}
			{loading ? (
				<div className="p-6 space-y-6">
					<div className="animate-pulse">
						<div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
							{Array.from({ length: 4 }).map((_, index) => (
								<div
									key={index}
									className="bg-white rounded-lg shadow p-6"
								>
									<div className="h-6 bg-gray-200 rounded w-3/4 mb-4"></div>
									<div className="h-8 bg-gray-200 rounded w-full"></div>
								</div>
							))}
						</div>
					</div>
				</div>
			) : (
				<DashboardStats statsData={stats?.aggregatedStats} />
			)}

			{/* Charts */}
			<Tabs defaultValue="overview" className="space-y-6">
				<TabsList>
					<TabsTrigger value="overview">Overview</TabsTrigger>
					<TabsTrigger value="documents">Documents</TabsTrigger>
					<TabsTrigger value="signers">Signers</TabsTrigger>
				</TabsList>

				<TabsContent value="overview" className="space-y-6">
					<DocumentStatusChart
						signerStatusAggregation={stats?.signerStatusAggregation || {}}
					/>

					<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
						<SigningTrendsChart
							documentSigners={stats?.documentSigners || []}
						/>

						<CompletionTimeChart documentSigners={stats?.documentSigners || []} />
					</div>
				</TabsContent>

				<TabsContent value="documents">
					<DocumentAnalyticsChart documents={stats?.documents || []} />
				</TabsContent>

				<TabsContent value="signers">
					<SignerAnalyticsChart documentSigners={stats?.documentSigners || []} />
				</TabsContent>
			</Tabs>
		</div>
	);
}
