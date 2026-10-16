import { Card } from "@/components/ui/card";

export function PricingFAQ() {
	return (
		<section className="py-20 px-6 lg:px-8 bg-white">
			<div className="mx-auto max-w-4xl">
				<div className="text-center mb-12">
					<h2 className="text-4xl md:text-5xl mb-4 text-gray-900">
						Frequently Asked Questions
					</h2>
				</div>

				<div className="space-y-6">
					<Card className="p-6 border-gray-200">
						<h4 className="text-lg mb-2 text-gray-900">
							Can I change plans later?
						</h4>
						<p className="text-gray-600">
							Yes! You can upgrade or downgrade your plan at any
							time. Changes take effect immediately and we'll
							prorate any differences.
						</p>
					</Card>

					<Card className="p-6 border-gray-200">
						<h4 className="text-lg mb-2 text-gray-900">
							Do you offer discounts for annual plans?
						</h4>
						<p className="text-gray-600">
							Yes! We also are the only e-signature platform that offers
							quarterly plans for teams that want to save but don't want to commit
							to a full year.
						</p>
					</Card>
				</div>
			</div>
		</section>
	);
}
