"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, MailCheck, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function VerifyForm() {
	const router = useRouter();
	const params = useSearchParams();
	const email = params.get("email") || "";
	const { toast } = useToast();

	const [code, setCode] = useState("");
	const [isVerifying, setIsVerifying] = useState(false);
	const [isSending, setIsSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [resendCooldown, setResendCooldown] = useState(0);
	const [codeSent, setCodeSent] = useState(true); // Default to true since email is auto-sent on signup

	useEffect(() => {
		let timer: NodeJS.Timeout | null = null;
		if (resendCooldown > 0) {
			timer = setInterval(() => {
				setResendCooldown((s) => (s > 0 ? s - 1 : 0));
			}, 1000);
		}
		return () => {
			if (timer) clearInterval(timer);
		};
	}, [resendCooldown]);

	const isCodeValid = useMemo(() => /^(\d){6}$/.test(code), [code]);
	const canSubmit = email.length > 3 && isCodeValid && !isVerifying;

	const onSendCode = async () => {
		if (!email) {
			setError("Please enter your email to receive a verification code.");
			return;
		}
		setError(null);
		setIsSending(true);
		try {
			const res = await fetch("/api/auth/verify/generate", {
				method: "POST",
                headers: {
                    "regenerate": "true"
                },
			});
			if (res.ok) {
				setCodeSent(true);
				setResendCooldown(30);
				toast({
					title: "Verification code sent",
					description: `We emailed a code to ${email}.`,
				});
			} else {
				const data = await res.json();
				setError(data.error || "Failed to send verification code.");
			}
		} catch (err) {
			setError("Failed to send verification code. Please try again.");
		} finally {
			setIsSending(false);
		}
	};

	const onSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		setIsVerifying(true);
		try {
				const result = await fetch("/api/auth/verify", {
                method: "POST",
                body: JSON.stringify({ code }),
                headers: {
                    "Content-Type": "application/json",
                },
            });
			if (!result.ok) {
				setError("Invalid verification code. Please try again or request a new one.");
				return;
			}
			toast({
				title: "Email verified!",
				description: "Your account is now verified.",
			});
			// Redirect based on optional plan param or referral status
			const plan = (params.get("plan") || "").toLowerCase();
			const fromReferral = params.get("fromReferral") === "true";

			if (plan === "basic" || plan === "pro") {
				router.replace(`/dashboard/billing/upgrade?plan=${encodeURIComponent(plan)}`);
			} else if (plan === "enterprise") {
				router.replace("/dashboard/billing/enterprise-contact");
			} else if (fromReferral) {
				// Users from affiliate links must choose a paid plan
				router.replace("/dashboard/billing/upgrade");
			} else {
				router.replace("/dashboard");
			}
		} catch (err) {
			setError("Something went wrong. Please try again.");
		} finally {
			setIsVerifying(false);
		}
	};

	const onResend = async () => {
		if (resendCooldown > 0) return;
		if (!email) {
			setError("No email attached, please contact support.");
			return;
		}
		setError(null);
		setIsSending(true);
		setResendCooldown(30);
		const res = await fetch("/api/auth/verify/generate", {
            method: "POST",
            headers: {
                "regenerate": "true"
            }
        });
		if (res.ok) {
			toast({
				title: "Verification code re-sent",
				description: `We emailed a new code to ${email}.`,
			});
		}
		setIsSending(false);
	};

	return (
		<form onSubmit={onSubmit} className="space-y-4">
			<Alert className="bg-blue-50 border-blue-200">
				<MailCheck className="h-4 w-4 text-blue-600" />
				<AlertDescription className="text-blue-800">
					We've sent a 6-digit verification code to your email. Please check your inbox (and spam folder) and enter the code below to verify your account.
				</AlertDescription>
			</Alert>

			{error && (
				<Alert variant="destructive">
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}

			{!codeSent && (
				<Button 
					type="button" 
					onClick={onSendCode} 
					className="w-full"
					disabled={!email || isSending}
				>
					{isSending ? (
						<>
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							Sending Code...
						</>
					) : (
						"Send Verification Code"
					)}
				</Button>
			)}

			{codeSent && (
				<>
					<div className="space-y-2">
						<Label htmlFor="code">Verification Code</Label>
						<Input
							id="code"
							inputMode="numeric"
							maxLength={6}
							placeholder="123456"
							value={code}
							onChange={(e) =>
								setCode(e.target.value.replace(/[^0-9]/g, ""))
							}
							disabled={isVerifying}
							required
						/>
						<p className="text-xs text-gray-500">
							Enter the 6-digit code from your email.
						</p>
					</div>

					<Button type="submit" className="w-full" disabled={!canSubmit}>
						{isVerifying ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Verifying...
							</>
						) : (
							"Verify Account"
						)}
					</Button>

					<div className="flex items-center justify-between text-sm">
						<button
							type="button"
							onClick={onResend}
							className="text-blue-600 hover:text-blue-500 disabled:text-gray-400"
							disabled={resendCooldown > 0 || isVerifying || isSending}
						>
							Resend code
						</button>
						<div className="flex items-center gap-2 text-gray-600">
							<Clock className="h-4 w-4" />
							{resendCooldown > 0
								? `You can resend in ${resendCooldown}s`
								: "Ready to resend"}
						</div>
					</div>
				</>
			)}
		</form>
	);
}
