import { Card } from "@/components/ui/card";
import { CheckCircle } from "lucide-react";

export function FeaturesIndustry() {
	const industries = [
		{
			title: "HR & Onboarding",
			items: [
				"Employee contracts",
				"Policy acknowledgments",
				"Benefits enrollment",
				"Performance reviews",
			],
		},
		{
			title: "Legal & Contracts",
			items: [
				"Client agreements",
				"NDAs",
				"Court documents",
				"Legal notices",
			],
		},
		{
			title: "Healthcare",
			items: [
				"Patient consent forms",
				"HIPAA compliance",
				"Medical records",
				"Insurance documents",
			],
		},
		{
			title: "Enterprise",
			items: [
				"Vendor agreements",
				"Multi-party contracts",
				"Procurement",
				"Partnership deals",
			],
		},
	];

	return (
		<section className="py-20 px-6 lg:px-8">
			<div className="mx-auto max-w-7xl">
				<div className="text-center mb-16">
					<h2 className="text-4xl md:text-5xl mb-4 text-gray-900">
						Perfect For Every Use Case
					</h2>
					<p className="text-lg text-gray-600">
						Trusted across industries for mission-critical workflows
					</p>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
					{industries.map((useCase, index) => (
						<Card key={index} className="p-6 border-gray-200">
							<h3 className="text-xl mb-4 text-gray-900">
								{useCase.title}
							</h3>
							<ul className="space-y-2">
								{useCase.items.map((item, itemIndex) => (
									<li
										key={itemIndex}
										className="flex items-center gap-2 text-sm text-gray-600"
									>
										<CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
										{item}
									</li>
								))}
							</ul>
						</Card>
					))}
				</div>
			</div>
		</section>
	);
}
