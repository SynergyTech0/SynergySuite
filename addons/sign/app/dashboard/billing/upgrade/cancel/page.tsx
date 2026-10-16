"use client";

import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { XCircle } from "lucide-react";

export default function UpgradeCancel() {
	const router = useRouter();

	return (
		<div className="p-6 max-w-2xl mx-auto space-y-6">
			<Card>
				<CardHeader>
					<div className="flex items-center gap-3">
						<XCircle className="w-10 h-10 text-amber-600" />
						<div>
							<CardTitle className="text-amber-700">Upgrade Cancelled</CardTitle>
							<CardDescription>You cancelled the checkout process</CardDescription>
						</div>
					</div>
				</CardHeader>
				<CardContent className="space-y-4">
					<p className="text-gray-700">
						No charges were made to your account. You can try upgrading again whenever you're ready.
					</p>
					<div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
						<h3 className="font-semibold text-blue-900 mb-2">Need help deciding?</h3>
						<p className="text-sm text-blue-800">
							If you have questions about our plans or need assistance, feel free to contact our support team.
							We're here to help you find the right plan for your needs.
						</p>
					</div>
				</CardContent>
				<CardFooter className="flex gap-3">
					<Button onClick={() => router.push("/dashboard/billing")} variant="outline">
						Back to Billing
					</Button>
					<Button onClick={() => router.push("/dashboard/billing/upgrade?plan=basic")} className="bg-blue-600 hover:bg-blue-700">
						Try Again
					</Button>
				</CardFooter>
			</Card>
		</div>
	);
}
