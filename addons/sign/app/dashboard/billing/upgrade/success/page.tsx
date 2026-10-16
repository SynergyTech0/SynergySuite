"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, Loader2 } from "lucide-react";

export default function UpgradeSuccess() {
	const searchParams = useSearchParams();
	const router = useRouter();
	const { data: session, update } = useSession();
	const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
	const sessionId = searchParams.get("session_id");

	useEffect(() => {
		// If we have a checkout session_id, attempt to refresh the auth session
		// so the new subscription is reflected immediately in the UI.
		const refreshSession = async () => {
			if (!sessionId) {
				setStatus("error");
				return;
			}

			try {
				// Poll the verify endpoint until the subscription is synced
				// This ensures the webhook has finished updating the database
				let synced = false;
				let attempts = 0;
				const maxAttempts = 10; // Max 10 seconds (10 attempts * 1 second)

				while (!synced && attempts < maxAttempts) {
					const res = await fetch(`/api/billing/verify`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ session_id: sessionId }),
					});

					if (!res.ok) {
						throw new Error(`Verification failed: ${res.status}`);
					}

					const data: {
						success: boolean;
						synced: boolean;
						dbSubscription?: { tier?: string; status?: string; currentPeriodEnd?: string | null };
						expected?: { tier?: string | null };
					} = await res.json();

					if (data.synced) {
						synced = true;
						break;
					}

					// Wait 1 second before polling again
					await new Promise(resolve => setTimeout(resolve, 1000));
					attempts++;
				}

				// If not synced after max attempts, manually sync (for test mode without webhooks)
				if (!synced) {
					console.warn("Webhook hasn't processed payment yet, attempting manual sync...");

					const manualSyncRes = await fetch(`/api/billing/manual-sync`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ session_id: sessionId }),
					});

					if (!manualSyncRes.ok) {
						console.error("Manual sync failed:", await manualSyncRes.text());
					} else {
						console.log("✅ Manual sync successful");
					}
				}

				// Ask NextAuth to refresh JWT/session from DB
				await update?.({});

				// Refresh the router to update any server components using the session
				router.refresh();
				setStatus("success");

				// Auto-redirect to dashboard after 2 seconds
				setTimeout(() => {
					router.push("/dashboard");
				}, 2000);
			} catch (err) {
				console.error("Failed to refresh session after upgrade:", err);
				setStatus("error");
			}
		};

		refreshSession();
	}, [sessionId, update, router]);

	if (status === "loading") {
		return (
			<div className="p-6 max-w-2xl mx-auto space-y-6">
				<Card>
					<CardContent className="pt-6 flex flex-col items-center justify-center space-y-4 py-12">
						<Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
						<p className="text-gray-600">Confirming your subscription...</p>
					</CardContent>
				</Card>
			</div>
		);
	}

	if (status === "error") {
		return (
			<div className="p-6 max-w-2xl mx-auto space-y-6">
				<Card>
					<CardHeader>
						<CardTitle className="text-red-600">Something went wrong</CardTitle>
						<CardDescription>We couldn't verify your subscription</CardDescription>
					</CardHeader>
					<CardContent>
						<p className="text-gray-600">
							Please contact support if you were charged but don't see your subscription active.
						</p>
					</CardContent>
					<CardFooter>
						<Button onClick={() => router.push("/dashboard/billing")}>
							Go to Billing
						</Button>
					</CardFooter>
				</Card>
			</div>
		);
	}

	return (
		<div className="p-6 max-w-2xl mx-auto space-y-6">
			<Card>
				<CardHeader>
					<div className="flex items-center gap-3">
						<CheckCircle className="w-10 h-10 text-green-600" />
						<div>
							<CardTitle className="text-green-700">Subscription Activated!</CardTitle>
							<CardDescription>Your upgrade was successful</CardDescription>
						</div>
					</div>
				</CardHeader>
				<CardContent className="space-y-4">
					<p className="text-gray-700">
						Thank you for upgrading! Your new subscription is now active and you have access to all the features of your plan.
					</p>
					<div className="bg-green-50 border border-green-200 rounded-lg p-4">
						<h3 className="font-semibold text-green-900 mb-2">What's next?</h3>
						<ul className="space-y-1 text-sm text-green-800">
							<li>• Your features are now unlocked</li>
							<li>• You'll receive a confirmation email shortly</li>
							<li>• You can manage your subscription in billing settings</li>
							<li>• Your first payment will be processed today</li>
						</ul>
					</div>
					<p className="text-sm text-gray-600 mt-2 italic">
						Redirecting you to the dashboard in 2 seconds...
					</p>
				</CardContent>
				<CardFooter className="flex gap-3">
					<Button onClick={() => router.push("/dashboard")} variant="outline">
						Go to Dashboard
					</Button>
					<Button onClick={() => router.push("/dashboard/billing")} className="bg-green-600 hover:bg-green-700">
						View Billing Details
					</Button>
				</CardFooter>
			</Card>
		</div>
	);
}
