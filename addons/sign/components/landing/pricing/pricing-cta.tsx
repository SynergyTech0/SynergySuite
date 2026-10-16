import { Button } from "@/components/ui/button";

export function PricingCTA() {
	return (
		<section className="py-20 px-6 lg:px-8 bg-gradient-to-r from-blue-600 to-blue-700">
			<div className="mx-auto max-w-4xl text-center text-white">
				<h2 className="text-4xl md:text-5xl mb-6">
					Still have questions?
				</h2>
				<p className="text-xl mb-10 text-blue-100">
					Our team is here to help you find the perfect plan for your
					needs
				</p>
				<div className="flex flex-col sm:flex-row gap-4 justify-center">
					<a href="/contact?inquiryType=question">
						<Button
							size="lg"
							className="bg-white text-blue-600 hover:bg-gray-100"
							>
							Contact Sales
						</Button>
					</a>
					<a href="/contact?inquiryType=demo">
						<Button
							size="lg"
							variant="outline"
							className="bg-transparent border-2 border-white text-white hover:bg-white/10 hover:border-white hover:text-white"
						>
							Schedule a Demo
						</Button>
					</a>
				</div>
			</div>
		</section>
	);
}
