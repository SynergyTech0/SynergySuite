import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Check } from "lucide-react";
import Link from "next/link";

export function PricingHero() {
	const plans = [
		{
			name: "Free",
			price: "$0",
			originalPrice: null,
			period: "/month",
			annualPrice: null,
			annualOriginal: null,
			description: "For individuals exploring",
			features: [
				"3 documents per month",
				"2 signers per document",
				"1 template",
			],
			cta: "Try for Free",
			highlighted: false,
		},
		{
			name: "Basic",
			price: "$9.99",
			originalPrice: null,
			period: "/month",
			annualPrice: "$59.99",
			annualOriginal: "$119.88",
			description: "For individuals and small teams",
			features: [
				"20 documents per month",
				"5 signers per document",
				"10 templates",
				"AI field detection",
			],
			cta: "Get Started",
			highlighted: false,
		},
		{
			name: "Pro",
			price: "$29.99",
			originalPrice: null,
			period: "/month",
			annualPrice: "$179.99",
			annualOriginal: "$359.88",
			description: "For established teams",
			badge: "Most Popular",
			features: [
				"100 documents per month",
				"10 signers per document",
				"50 templates",
				"All AI features",
				"Priority support",
			],
			cta: "Get Started",
			highlighted: true,
		},
		{
			name: "Enterprise",
			price: "Custom",
			originalPrice: null,
			period: "",
			annualPrice: null,
			annualOriginal: null,
			description: "For large organizations",
			features: [
				"Unlimited documents",
				"25 signers per document",
				"Unlimited templates",
				"Custom branding",
				"Dedicated support",
			],
			cta: "Contact Sales",
			highlighted: false,
		},
	];

	return (
		<>
			<section className="pt-32 pb-20 px-6 lg:px-8">
				<div className="mx-auto max-w-7xl text-center">
					<Badge className="mb-4 bg-red-600 text-white px-4 py-1.5 text-sm">
						🔥 50% OFF Annual Plans - Limited Time Launch Special
					</Badge>
					<h1 className="text-5xl md:text-6xl mb-6 text-gray-900">
						Choose Your Plan
					</h1>
					<p className="text-xl text-gray-600 max-w-3xl mx-auto">
						Start free and scale as you grow
					</p>
				</div>
			</section>

			{/* Pricing Cards */}
			<section className="pb-20 px-6 lg:px-8">
				<div className="mx-auto max-w-7xl">
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
						{plans.map((plan, index) => (
							<Card
								key={index}
								className={`p-8 relative flex flex-col ${
									plan.highlighted
										? "border-2 border-blue-600 shadow-xl"
										: "border border-gray-200"
								}`}
							>
								{plan.badge && (
									<Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-4 py-1">
										{plan.badge}
									</Badge>
								)}

								<div className="text-center mb-6">
									<h3 className="text-2xl mb-2 text-gray-900">
										{plan.name}
									</h3>
									<div className="mb-3">
										<span className="text-5xl text-gray-900">
											{plan.price}
										</span>
										{plan.period && (
											<span className="text-gray-600 text-lg">
												{plan.period}
											</span>
										)}
									</div>
									{plan.annualPrice && (
										<div className="mb-2 p-2 bg-red-50 rounded-lg">
											<span className="text-sm text-red-600 font-medium">Annual: </span>
											<span className="text-sm text-gray-400 line-through mr-1">
												{plan.annualOriginal}
											</span>
											<span className="text-sm text-red-600 font-bold">
												{plan.annualPrice}/year
											</span>
										</div>
									)}
									<p className="text-sm text-gray-600">
										{plan.description}
									</p>
								</div>

								<div className="space-y-3 mb-8">
									{plan.features.map((feature, fIndex) => (
										<div
											key={fIndex}
											className="flex items-start gap-3"
										>
											<Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
											<span className="text-sm text-gray-700">
												{feature}
											</span>
										</div>
									))}
								</div>

								<Link href={`/auth/signup` + (plan.name.toLowerCase() !== 'free' ? `?plan=${encodeURIComponent(plan.name.toLowerCase())}` : '')} className="mt-auto">
									<Button
										className={`w-full ${
											plan.highlighted
												? "bg-blue-600 hover:bg-blue-700 text-white"
												: "bg-gray-900 hover:bg-gray-800 text-white"
										}`}
									>
										{plan.cta}
									</Button>
								</Link>
							</Card>
						))}
					</div>
				</div>
			</section>
		</>
	);
}
