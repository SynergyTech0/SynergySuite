import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

export function LandingCTA() {
	return (
		<section className="py-20 bg-blue-600">
			<div className="max-w-4xl mx-auto text-center px-4 sm:px-6 lg:px-8">
				<div className="space-y-6 text-white">
					<h2 className="text-4xl font-bold">
						Ready to Transform Your Document Workflow?
					</h2>
					<p className="text-xl text-blue-100">
						Join thousands of businesses already using AI-powered
						signatures
					</p>
					<div className="flex flex-col sm:flex-row items-center justify-center gap-4">
						<Link href="/auth/signup">
							<Button
								size="lg"
								variant="secondary"
								className="text-lg bg-white text-blue-600 hover:bg-gray-100 px-8"
							>
								Start For Free
								<ArrowRight className="ml-2 w-5 h-5" />
							</Button>
						</Link>
					</div>
					<p className="text-sm text-blue-200">
						No risk • Many tiers • Cancel anytime
					</p>
				</div>
			</div>
		</section>
	);
}
