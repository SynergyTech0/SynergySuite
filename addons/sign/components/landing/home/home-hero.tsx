import { Sparkles, ArrowRight, CheckCircle, Shield, IdCardIcon, CreditCard, X } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function HomeHero() {
	return (
		<section className="relative py-20 px-4 sm:px-6 lg:px-8 bg-white/50">
			<div className="max-w-7xl mx-auto">
				<div className="text-center space-y-8">
					<div className="space-y-4">
						<Badge
                            variant='outline'
							className="mb-6 border-blue-200 text-blue-700 bg-blue-50/50 px-4 py-1.5"
						>
							<Shield className="w-3.5 h-3.5 mr-1.5" />
							AI-POWERED SIGNATURES
						</Badge>
						<h1 className="text-5xl md:text-6xl font-bold text-gray-900 leading-tight">
							The Future of <br />
							<span className="text-blue-600">
								Electronic Signatures
							</span>
						</h1>
						<p className="text-xl text-gray-600 max-w-3xl mx-auto">
							Revolutionize your document workflow with AI-driven
							automation, enterprise-grade security, and seamless
							multi-party signing capabilities. Prepare documents
							in seconds — not hours.
						</p>
					</div>

					<div className="flex flex-col sm:flex-row items-center justify-center gap-4">
						<Link href="/auth/signup">
							<Button
								size="lg"
								className="bg-blue-600 hover:bg-blue-700 text-lg px-8 py-3"
							>
								Start For Free
								<ArrowRight className="ml-2 w-5 h-5" />
							</Button>
						</Link>
					</div>

					<div className="flex items-center justify-center space-x-6 text-sm text-gray-500">
						<div className="flex items-center space-x-1">
							<CheckCircle className="w-4 h-4 text-green-500" />
							<span>Free tier</span>
						</div>
						<div className="flex items-center space-x-1">
							<CreditCard className="w-4 h-4 text-green-500" />
							<span>No credit card required</span>
						</div>
						<div className="flex items-center space-x-1">
							<X className="w-4 h-4 text-green-500" />
							<span>Cancel anytime</span>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
