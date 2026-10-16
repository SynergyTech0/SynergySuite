"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, Building2, Users, CreditCard } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface PaymentData {
	requestId: string;
	companyName: string;
	contactName: string;
	teamSize: string;
	amount: number;
	valid: boolean;
	message?: string;
}

export default function EnterprisePaymentPage() {
	const searchParams = useSearchParams();
	const router = useRouter();
	const token = searchParams.get("token");
	const requestId = searchParams.get("requestId");

	const [loading, setLoading] = useState(true);
	const [paymentData, setPaymentData] = useState<PaymentData | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [processing, setProcessing] = useState(false);
	const [regenerating, setRegenerating] = useState(false);
	const [regenerateMessage, setRegenerateMessage] = useState<string | null>(null);

	useEffect(() => {
		async function validateToken() {
			if (!token || !requestId) {
				setError("Invalid payment link. Missing token or request ID.");
				setLoading(false);
				return;
			}

			try {
				const res = await fetch(
					`/api/enterprise/payment/validate?token=${token}&requestId=${requestId}`
				);
				const data = await res.json();

				if (!res.ok || !data.valid) {
					setError(data.message || "Invalid or expired payment link.");
					setLoading(false);
					return;
				}

				setPaymentData(data);
			} catch (err) {
				console.error("Error validating payment token:", err);
				setError("Failed to validate payment link. Please try again.");
			} finally {
				setLoading(false);
			}
		}

		validateToken();
	}, [token, requestId]);

	const handlePayment = async () => {
		if (!token || !requestId) return;

		setProcessing(true);
		try {
			const res = await fetch("/api/enterprise/payment/checkout", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ token, requestId }),
			});

			const data = await res.json();

			if (!res.ok) {
				throw new Error(data.error || "Failed to create checkout session");
			}

			// Redirect to Stripe Checkout
			if (data.checkoutUrl) {
				window.location.href = data.checkoutUrl;
			} else {
				throw new Error("No checkout URL received");
			}
		} catch (err: any) {
			console.error("Payment error:", err);
			setError(err.message || "Failed to initiate payment. Please try again.");
			setProcessing(false);
		}
	};

	const handleRegenerateLink = async () => {
		if (!requestId) return;

		setRegenerating(true);
		setRegenerateMessage(null);
		
		try {
			const res = await fetch("/api/enterprise/payment/regenerate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ requestId }),
			});

			const data = await res.json();

			if (!res.ok) {
				throw new Error(data.error || "Failed to regenerate payment link");
			}

			setRegenerateMessage("✅ A new payment link has been sent to your email. Please check your inbox.");
		} catch (err: any) {
			console.error("Error regenerating link:", err);
			setRegenerateMessage(`❌ ${err.message || "Failed to regenerate payment link. Please contact support."}`);
		} finally {
			setRegenerating(false);
		}
	};

	if (error || !paymentData?.valid) {
		const isExpired = error?.includes("expired") || paymentData?.message?.includes("expired");
		
		return (
			<div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
				<Card className="w-full max-w-md">
					<CardHeader>
						<div className="flex items-center justify-center mb-4">
							<XCircle className="h-12 w-12 text-red-500" />
						</div>
						<CardTitle className="text-center">Payment Link Invalid</CardTitle>
						<CardDescription className="text-center">
							{error || paymentData?.message || "This payment link is invalid or has expired."}
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{isExpired && requestId && (
							<>
								<div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
									<p className="text-sm text-blue-800 mb-3">
										<strong>Link Expired?</strong> We can send you a new payment link to complete your enterprise account setup.
									</p>
									<Button
										onClick={handleRegenerateLink}
										disabled={regenerating}
										className="w-full"
									>
										{regenerating ? (
											<>
												<Loader2 className="mr-2 h-4 w-4 animate-spin" />
												Sending...
											</>
										) : (
											"Request New Payment Link"
										)}
									</Button>
									{regenerateMessage && (
										<p className={`text-sm mt-3 ${regenerateMessage.startsWith("✅") ? "text-green-700" : "text-red-700"}`}>
											{regenerateMessage}
										</p>
									)}
								</div>
							</>
						)}
						<Button
							onClick={() => router.push("/")}
							className="w-full"
							variant="outline"
						>
							Return to Home
						</Button>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4">
			<div className="max-w-2xl mx-auto">
				<Card className="shadow-xl">
					<CardHeader className="text-center pb-4">
						<div className="flex items-center justify-center mb-4">
							<div className="bg-blue-100 rounded-full p-3">
								<CreditCard className="h-8 w-8 text-blue-600" />
							</div>
						</div>
						<CardTitle className="text-2xl">Complete Your Enterprise Payment</CardTitle>
						<CardDescription className="text-base mt-2">
							Your enterprise request has been approved. Complete your payment to activate your account.
						</CardDescription>
					</CardHeader>

					<CardContent className="space-y-6">
						{/* Order Summary */}
						<div className="bg-gray-50 rounded-lg p-6 space-y-4">
							<h3 className="font-semibold text-lg mb-4">Order Summary</h3>
							
							<div className="space-y-3">
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-2 text-gray-600">
										<Building2 className="h-4 w-4" />
										<span>Company</span>
									</div>
									<span className="font-medium">{paymentData.companyName}</span>
								</div>

								<div className="flex items-center justify-between">
									<div className="flex items-center gap-2 text-gray-600">
										<Users className="h-4 w-4" />
										<span>Team Size</span>
									</div>
									<span className="font-medium">{paymentData.teamSize} users</span>
								</div>

								<div className="border-t pt-3 mt-3">
									<div className="flex items-center justify-between">
										<span className="text-lg font-semibold">Total Amount</span>
										<span className="text-2xl font-bold text-blue-600">
											${paymentData.amount.toFixed(2)} USD
										</span>
									</div>
								</div>
							</div>
						</div>

						{/* Important Information */}
						<Alert>
							<CheckCircle2 className="h-4 w-4" />
							<AlertDescription>
								<strong>What happens next?</strong>
								<ul className="list-disc list-inside mt-2 space-y-1 text-sm">
									<li>You'll be redirected to Stripe's secure payment page</li>
									<li>After successful payment, you'll receive a confirmation email</li>
									<li>The email will include your password setup link</li>
									<li>Your enterprise account will be activated automatically</li>
								</ul>
							</AlertDescription>
						</Alert>

						{/* Payment Button */}
						<Button
							onClick={handlePayment}
							disabled={processing}
							className="w-full h-12 text-lg font-semibold"
							size="lg"
						>
							{processing ? (
								<>
									<Loader2 className="mr-2 h-5 w-5 animate-spin" />
									Processing...
								</>
							) : (
								<>
									<CreditCard className="mr-2 h-5 w-5" />
									Proceed to Secure Payment
								</>
							)}
						</Button>

						<p className="text-xs text-center text-gray-500">
							Your payment is secured by Stripe. We never store your payment information.
						</p>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}

