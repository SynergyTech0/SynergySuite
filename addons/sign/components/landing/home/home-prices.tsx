import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

const plans = [
	{ name: "Free", price: "$0", originalPrice: null, highlight: false },
	{ name: "Basic", price: "$9.99", originalPrice: null, highlight: false },
	{ name: "Pro", price: "$29.99", originalPrice: null, highlight: true },
	{ name: "Enterprise", price: "Custom", originalPrice: null, highlight: false },
];

export function LandingPrices({ setPage }: { setPage: (page: 'home' | 'features' | 'pricing' | 'security') => void }) {
	return (
		<section className="py-20 px-6 lg:px-8 bg-white">
			<div className="mx-auto max-w-7xl">
				<div className="text-center mb-16">
					<Badge className="mb-4 bg-red-600 text-white px-4 py-1.5 text-sm">
						🔥 50% OFF Annual Plans - Limited Time Launch Special
					</Badge>
					<h2 className="text-4xl md:text-5xl mb-4 text-gray-900">
						Choose Your Plan
					</h2>
					<p className="text-lg text-gray-600">
						Start free and scale as you grow
					</p>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
					{plans.map((plan, index) => (
						<Card
							key={index}
							className={`p-6 text-center relative ${
								plan.highlight
									? "border-2 border-blue-600 shadow-lg"
									: "border-gray-200"
							}`}
						>
							{plan.highlight && (
								<Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-4">
									Most Popular
								</Badge>
							)}
							<h3 className="text-xl mb-2 text-gray-900">
								{plan.name}
							</h3>
							<div className="mb-6">
								{plan.originalPrice && (
									<span className="text-lg text-gray-400 line-through mr-2">
										{plan.originalPrice}
									</span>
								)}
								<span className="text-4xl text-gray-900">
									{plan.price}
								</span>
								{plan.price !== "Custom" && (
									<span className="text-gray-600">
										/month
									</span>
								)}
							</div>
							<Link href={`/auth/signup` + (plan.name.toLowerCase() !== 'free' ? `?plan=${encodeURIComponent(plan.name.toLowerCase())}` : '')}>
								<Button
									className={
										plan.highlight
											? "w-full bg-blue-600 hover:bg-blue-700"
											: "w-full bg-gray-900 hover:bg-gray-800"
									}
								>
									{plan.price === "Custom"
										? "Contact Sales"
										: "Get Started"}
								</Button>
							</Link>
						</Card>
					))}
				</div>

				<div className="text-center mt-8">
					<Button variant="link" className="text-blue-600" asChild>
						<Link href="#" onClick={() => setPage('pricing')}>
							View detailed pricing{" "}
							<ArrowRight className="w-4 h-4 ml-1" />
						</Link>
					</Button>
				</div>
			</div>
		</section>
	);
}
