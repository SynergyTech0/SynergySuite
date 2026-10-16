"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, Mail } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import Link from "next/link";

export default function PaymentSuccessPage() {
	const searchParams = useSearchParams();
	const sessionId = searchParams.get("session_id");
	const requestId = searchParams.get("requestId");

	const [loading, setLoading] = useState(true);
	const [verified, setVerified] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		async function verifyPayment() {
			if (!sessionId || !requestId) {
				setError("Missing payment session information.");
				setLoading(false);
				return;
			}

			try {
				const res = await fetch("/api/enterprise/payment/verify", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ sessionId, requestId }),
				});

				const data = await res.json();

				if (!res.ok) {
					throw new Error(data.error || "Failed to verify payment");
				}

				setVerified(true);
			} catch (err: any) {
				console.error("Payment verification error:", err);
				setError(err.message || "Failed to verify payment. Please contact support.");
			} finally {
				setLoading(false);
			}
		}

		verifyPayment();
	}, [sessionId, requestId]);

	if (loading) {
		return (
			<div className="min-h-screen flex items-center justify-center bg-gray-50">
				<div className="text-center">
					<Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-4" />
					<p className="text-gray-600">Verifying your payment...</p>
				</div>
			</div>
		);
	}

	if (error || !verified) {
		return (
			<div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
				<Card className="w-full max-w-md">
					<CardHeader>
						<CardTitle className="text-center text-red-600">Payment Verification Failed</CardTitle>
						<CardDescription className="text-center">
							{error || "We couldn't verify your payment. Please contact support if you were charged."}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Button asChild className="w-full" variant="outline">
							<Link href="/">Return to Home</Link>
						</Button>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 py-12 px-4">
			<div className="max-w-2xl mx-auto">
				<Card className="shadow-xl">
					<CardHeader className="text-center pb-4">
						<div className="flex items-center justify-center mb-4">
							<div className="bg-green-100 rounded-full p-3">
								<CheckCircle2 className="h-12 w-12 text-green-600" />
							</div>
						</div>
						<CardTitle className="text-2xl text-green-700">Payment Successful!</CardTitle>
						<CardDescription className="text-base mt-2">
							Your enterprise account payment has been processed successfully.
						</CardDescription>
					</CardHeader>

					<CardContent className="space-y-6">
						<Alert className="bg-green-50 border-green-200">
							<Mail className="h-4 w-4 text-green-600" />
							<AlertDescription className="text-green-800">
								<strong>Check your email!</strong>
								<p className="mt-2">
									We've sent a confirmation email with your password setup link. 
									Please check your inbox (and spam folder) to complete your account setup.
								</p>
							</AlertDescription>
						</Alert>

						<div className="bg-gray-50 rounded-lg p-6 space-y-3">
							<h3 className="font-semibold text-lg mb-2">What's Next?</h3>
							<ul className="list-disc list-inside space-y-2 text-sm text-gray-700">
								<li>Check your email for the confirmation message</li>
								<li>Click the password setup link in the email</li>
								<li>Create your account password</li>
								<li>Start using your enterprise account</li>
							</ul>
						</div>

						<div className="flex gap-3">
							<Button asChild className="flex-1" variant="outline">
								<Link href="/">Return to Home</Link>
							</Button>
							<Button asChild className="flex-1">
								<Link href="/auth/signin">Sign In</Link>
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}

