import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { VerifyForm } from '@/components/auth/verify-form';
import { ShieldCheck, MailCheck, Lock } from 'lucide-react';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function VerifyPage() {
	const session = await getServerSession(authOptions);
	
	if (session && session.user?.verified) {
		// If user is already verified, redirect to dashboard
		redirect('/dashboard');
	}

	return (
		<div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
			<div className="w-full max-w-4xl">
				<div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
					{/* Left side - Messaging/Benefits */}
					<div className="space-y-6 lg:pr-8">
						<div className="space-y-2">
							<div className="flex items-center space-x-2">
								<div className="bg-blue-600 p-2 rounded-lg">
									<ShieldCheck className="w-6 h-6 text-white" />
								</div>
								<span className="text-2xl font-bold text-gray-900">SynergySign</span>
							</div>
							<h1 className="text-3xl font-bold text-gray-900">Verify Your Email</h1>
							<p className="text-lg text-gray-600">
								For security and compliance, you must verify your account before using SynergySign services.
							</p>
						</div>

						<div className="space-y-4">
							<div className="flex items-start space-x-3">
								<div className="bg-blue-100 p-2 rounded-lg">
									<MailCheck className="w-5 h-5 text-blue-600" />
								</div>
								<div>
									<h3 className="font-semibold text-gray-900">Check Your Inbox</h3>
									<p className="text-gray-600">Enter the 6-digit code we sent to your email address.</p>
								</div>
							</div>

							<div className="flex items-start space-x-3">
								<div className="bg-green-100 p-2 rounded-lg">
									<Lock className="w-5 h-5 text-green-600" />
								</div>
								<div>
									<h3 className="font-semibold text-gray-900">Secure Access</h3>
									<p className="text-gray-600">Verification helps protect your documents and signing workflows.</p>
								</div>
							</div>

							<p className="text-sm text-gray-500">
								Didn’t receive a code? Check your spam folder, or use the resend option after a short cooldown.
							</p>
						</div>
					</div>

					{/* Right side - Verify form */}
					<div>
						<Card className="shadow-xl border-0">
							<CardHeader className="space-y-1">
								<CardTitle className="text-2xl font-semibold text-center">Verify Your Account</CardTitle>
								<CardDescription className="text-center">
									Enter the code to activate your account
								</CardDescription>
							</CardHeader>
							<CardContent>
								<VerifyForm />
								<div className="mt-6 text-center text-sm text-gray-600">
									<p>
										Verified already?{' '}
										<Link href="/auth/login" className="font-medium text-blue-600 hover:text-blue-500 transition-colors">
											Sign in here
										</Link>
									</p>
								</div>
							</CardContent>
						</Card>
					</div>
				</div>
			</div>
		</div>
	);
}

