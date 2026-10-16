import { Card } from "@/components/ui/card";
import { BookOpen, Brain, CheckCircle, Code, Database, Edit3, FileText, GitBranch, Shield, Smartphone, Users, Zap, Lock } from "lucide-react";

export function FeaturesGrid() {
	const features = [
		{
			icon: Brain,
			title: "AI-Driven Document Automation",
			description:
				"Eliminate the manual grind. SynergySign automatically identifies fields, extracts data, and generates signature workflows with smart suggestions powered by advanced AI.",
			benefits: [
				"Automatic field detection and placement",
				"Smart data extraction from documents",
				"AI-generated workflow suggestions",
				"Prepare documents in seconds, not hours",
			],
			gradient: "from-blue-50 to-blue-100/50",
			iconColor: "text-blue-600",
		},
		{
			icon: Shield,
			title: "Secure, Legally-Binding E-Signatures",
			description:
				"Every signature is encrypted, timestamped, and fully compliant with ESIGN, UETA, SOC 2, HIPAA, and enterprise audit requirements.",
			benefits: [
				"End-to-end encryption for all signatures",
				"Automatic timestamping and verification",
				"Legally enforceable worldwide",
				"Tamper-proof document security",
			],
			gradient: "from-green-50 to-green-100/50",
			iconColor: "text-green-600",
		},
		{
			icon: GitBranch,
			title: "Multi-Signer Workflows (Sequential & Parallel)",
			description:
				"Create simple or advanced signing flows with individual, team, or enterprise signers in any configuration you need.",
			benefits: [
				"Sequential signing order support",
				"Parallel signing for simultaneous signatures",
				"Mixed workflows for complex requirements",
				"Automated reminders and expiration rules",
			],
			gradient: "from-purple-50 to-purple-100/50",
			iconColor: "text-purple-600",
		},
		{
			icon: Edit3,
			title: "Real-Time Document Editor",
			description:
				"A fast, intuitive editor built for efficiency, designed so anyone can prepare documents — not just technical staff.",
			benefits: [
				"Drag-and-drop field placement",
				"Smart text boxes and form elements",
				"Date, signature, checkbox, initials, dropdowns",
				"Page-level annotations and highlights",
			],
			gradient: "from-orange-50 to-orange-100/50",
			iconColor: "text-orange-600",
		},
		{
			icon: Code,
			title: "Embedded Signatures for Apps & Websites",
			description:
				"Integrate SynergySign anywhere with a single embed. Offer customers and employees a frictionless signing experience.",
			benefits: [
				"Customer portal integration",
				"Healthcare systems - FHIR/HL7 compatible (coming soon)",
				"Internal tool embedding",
				"Mobile app integration",
			],
			gradient: "from-indigo-50 to-indigo-100/50",
			iconColor: "text-indigo-600",
		},
		{
			icon: Users,
			title: "Team & Organization Management",
			description:
				"Full enterprise control from a single dashboard. Scales effortlessly from small teams to global organizations.",
			benefits: [
				"Departments and groups management",
				"Role-based access control",
				"Document-level permissions",
				"Activity logs and audit trails",
			],
			gradient: "from-pink-50 to-pink-100/50",
			iconColor: "text-pink-600",
		},
		{
			icon: FileText,
			title: "Automated Compliance & Audit Trails",
			description:
				"Every action is automatically logged and preserved. Make legal reviews, compliance checks, and investigations painless.",
			benefits: [
				"Automatic logging of all actions",
				"View, edit, send, sign tracking",
				"Exportable audit reports",
				"Complete forensic documentation",
			],
			gradient: "from-cyan-50 to-cyan-100/50",
			iconColor: "text-cyan-600",
		},
		{
			icon: Database,
			title: "Secure Cloud Storage & Versioning",
			description:
				"All documents are securely stored with encryption at rest and in transit. Your contracts are always safe, accessible, and organized.",
			benefits: [
				"Military-grade encryption",
				"Automatic version tracking",
				"Unlimited revision history",
				"Automatic cloud backups",
			],
			gradient: "from-teal-50 to-teal-100/50",
			iconColor: "text-teal-600",
		},
		{
			icon: BookOpen,
			title: "Templates & Reusable Workflows",
			description:
				"Turn your most-used documents into structured templates. Standardize forms and eliminate redundant preparation work.",
			benefits: [
				"Create unlimited templates",
				"Pre-configured signature fields",
				"Speed up repeat workflows",
				"Share templates across teams",
			],
			gradient: "from-violet-50 to-violet-100/50",
			iconColor: "text-violet-600",
		},
		{
			icon: Zap,
			title: "API & Webhook Integration",
			description:
				"SynergySign integrates cleanly into your stack. Ideal for enterprise automation and full-stack integration.",
			benefits: [
				"REST API + future GraphQL endpoint",
				"Real-time webhooks for events",
				"SSO (coming soon) / OAuth2 support",
				"Compatible with AIP/OpenI fabric",
			],
			gradient: "from-yellow-50 to-yellow-100/50",
			iconColor: "text-yellow-600",
		},
		{
			icon: Smartphone,
			title: "Mobile-Ready Signing Experience",
			description:
				"Sign and send documents from any device with a clean, responsive interface that never breaks layouts.",
			benefits: [
				"Works on any screen size",
				"Touch-optimized signing",
				"Native mobile experience",
				"Offline signing capability",
			],
			gradient: "from-rose-50 to-rose-100/50",
			iconColor: "text-rose-600",
		},
		{
			icon: Lock,
			title: "Enterprise-Grade Security",
			description:
				"Engineered to meet strict enterprise requirements. Security is not a checkbox — it's part of the fabric.",
			benefits: [
				"Zero-trust architecture",
				"AES-256 encryption",
				"Key rotation and secure token policies",
				"Geographic redundancy and threat detection",
			],
			gradient: "from-red-50 to-red-100/50",
			iconColor: "text-red-600",
		},
	];

	return (
		<section className="py-20 px-6 lg:px-8 bg-gray-50/50">
			<div className="mx-auto max-w-7xl">
				<div className="space-y-16">
					{features.map((feature, index) => {
						const Icon = feature.icon;
						const isEven = index % 2 === 0;

						return (
							<div
								key={index}
								className={`grid grid-cols-1 lg:grid-cols-2 gap-12 items-center ${
									isEven ? "" : "lg:grid-flow-dense"
								}`}
							>
								{/* Feature Card */}
								<Card
									className={`p-10 bg-gradient-to-br ${feature.gradient} border-0 shadow-lg ${
										isEven ? "" : "lg:col-start-2"
									}`}
								>
									<div className="mb-6">
										<Icon
											className={`w-14 h-14 ${feature.iconColor}`}
										/>
									</div>
									<h3 className="text-3xl mb-4 text-gray-900">
										{feature.title}
									</h3>
									<p className="text-lg text-gray-600 leading-relaxed">
										{feature.description}
									</p>
								</Card>

								{/* Benefits List */}
								<div
									className={
										isEven
											? ""
											: "lg:col-start-1 lg:row-start-1"
									}
								>
									<div className="space-y-4">
										{feature.benefits.map(
											(benefit, bIndex) => (
												<div
													key={bIndex}
													className="flex items-start gap-3"
												>
													<CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
													<p className="text-lg text-gray-700">
														{benefit}
													</p>
												</div>
											)
										)}
									</div>
								</div>
							</div>
						);
					})}
				</div>
			</div>
		</section>
	);
}
