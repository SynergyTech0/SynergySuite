import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowRight, Eye, FileCheck, Scale, Server, Users, Lock } from "lucide-react";
import Link from "next/link";

export function SecurityGrid() {
	const securityFeatures = [
		{
			icon: Lock,
			title: "Bank-Grade Encryption",
			description:
				"End-to-end 256-bit AES encryption ensures your documents are secure in transit and at rest.",
			gradient: "from-blue-50 to-blue-100/50",
			iconColor: "text-blue-600",
		},
		{
			icon: FileCheck,
			title: "Complete Audit Trail",
			description:
				"Every action is logged with timestamp, IP address, and user details for full accountability.",
			gradient: "from-green-50 to-green-100/50",
			iconColor: "text-green-600",
		},
		{
			icon: Scale,
			title: "Legal Validity",
			description:
				"ESIGN & UETA compliant signatures with full legal standing in over 180 countries worldwide.",
			gradient: "from-purple-50 to-purple-100/50",
			iconColor: "text-purple-600",
		},
		{
			icon: Eye,
			title: "Document Authentication",
			description:
				"Advanced tamper detection and verification ensures document integrity at all times.",
			gradient: "from-orange-50 to-orange-100/50",
			iconColor: "text-orange-600",
		},
		{
			icon: Server,
			title: "Secure Infrastructure",
			description:
				"Enterprise-grade cloud infrastructure with 99.9% uptime SLA and regular security audits.",
			gradient: "from-indigo-50 to-indigo-100/50",
			iconColor: "text-indigo-600",
		},
		{
			icon: Users,
			title: "Access Control",
			description:
				"Role-based permissions and multi-factor authentication with granular access controls.",
			gradient: "from-pink-50 to-pink-100/50",
			iconColor: "text-pink-600",
		},
	];

	return (
		<section className="py-20 px-6 lg:px-8 bg-gray-50/50">
			<div className="mx-auto max-w-7xl">
				<div className="text-center mb-16">
					<h2 className="text-4xl md:text-5xl mb-4 text-gray-900">
						Enterprise-Grade Security
					</h2>
					<p className="text-lg text-gray-600">
						Multi-layered security architecture protecting your
						documents at every level
					</p>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
					{securityFeatures.map((feature, index) => {
						const Icon = feature.icon;
						return (
							<Card
								key={index}
								className={`p-8 bg-gradient-to-br ${feature.gradient} border-0 shadow-sm hover:shadow-md transition-all`}
							>
								<div className="mb-4">
									<Icon
										className={`w-10 h-10 ${feature.iconColor}`}
									/>
								</div>
								<h3 className="text-xl mb-3 text-gray-900">
									{feature.title}
								</h3>
								<p className="text-gray-600 leading-relaxed">
									{feature.description}
								</p>
							</Card>
						);
					})}
				</div>

				<div className="text-center mt-12">
					<Link href="/auth/signup">
						<Button
							size="lg"
							className="bg-blue-600 hover:bg-blue-700 text-white px-8"
						>
							Experience Unbreakable Security
							<ArrowRight className="w-4 h-4 ml-2" />
						</Button>
					</Link>
					<p className="text-sm text-gray-500 mt-3">
						Fort Knox called. They want security tips from us.
					</p>
				</div>
			</div>
		</section>
	);
}
