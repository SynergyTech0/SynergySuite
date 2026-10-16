import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { BookOpen, Brain, Code, Database, Edit3, FileText, GitBranch, Shield, Smartphone, Users, Zap, Lock } from "lucide-react";

const mainFeatures = [
	{
		icon: Brain,
		title: "AI-Driven Document Automation",
		description:
			"Eliminate the manual grind. SynergySign automatically identifies fields, extracts data, and generates signature workflows with smart suggestions powered by advanced AI. Prepare documents in seconds — not hours.",
		gradient: "from-blue-50 to-blue-100/50",
		iconColor: "text-blue-600",
	},
	{
		icon: Shield,
		title: "Secure, Legally-Binding E-Signatures",
		description:
			"Every signature is encrypted, timestamped, and fully compliant with ESIGN, UETA, SOC 2, HIPAA, and enterprise audit requirements. Your contracts remain legally enforceable and tamper-proof end-to-end.",
		gradient: "from-green-50 to-green-100/50",
		iconColor: "text-green-600",
	},
	{
		icon: GitBranch,
		title: "Multi-Signer Workflows (Sequential & Parallel)",
		description:
			"Create simple or advanced signing flows with individual, team, or enterprise signers. Support for sequential order, parallel order, or mixed workflows with automated reminders and expiration rules. Perfect for HR, legal, healthcare, and enterprise contracting.",
		gradient: "from-purple-50 to-purple-100/50",
		iconColor: "text-purple-600",
	},
	{
		icon: Edit3,
		title: "Real-Time Document Editor",
		description:
			"A fast, intuitive editor built for efficiency with drag-and-drop fields, smart text boxes, date, signature, checkbox, initials, and dropdowns. Page-level annotations and highlights designed so anyone can prepare documents, not just technical staff.",
		gradient: "from-orange-50 to-orange-100/50",
		iconColor: "text-orange-600",
	},
	{
		icon: Code,
		title: "Embedded Signatures for Apps & Websites",
		description:
			"Integrate SynergySign anywhere with a single embed: customer portals, healthcare systems - FHIR/HL7 compatible (coming soon), internal tools, and mobile apps. Offer customers and employees a frictionless signing experience.",
		gradient: "from-indigo-50 to-indigo-100/50",
		iconColor: "text-indigo-600",
	},
	{
		icon: Users,
		title: "Team & Organization Management",
		description:
			"Full enterprise control from a single dashboard with departments and groups, role-based access, document permissions, and activity logs. Scales effortlessly from small teams to global organizations.",
		gradient: "from-pink-50 to-pink-100/50",
		iconColor: "text-pink-600",
	},
	{
		icon: FileText,
		title: "Automated Compliance & Audit Trails",
		description:
			"Every action — view, edit, send, sign — is automatically logged and preserved. Exportable audit reports make legal reviews, compliance checks, and investigations painless.",
		gradient: "from-cyan-50 to-cyan-100/50",
		iconColor: "text-cyan-600",
	},
	{
		icon: Database,
		title: "Secure Cloud Storage & Versioning",
		description:
			"All documents are securely stored with encryption at rest + in transit, version tracking, unlimited revision history, and automatic backups. Your contracts are always safe, accessible, and organized.",
		gradient: "from-teal-50 to-teal-100/50",
		iconColor: "text-teal-600",
	},
	{
		icon: BookOpen,
		title: "Templates & Reusable Workflows",
		description:
			"Turn your most-used documents into structured templates. Standardize forms, speed up repeat workflows, and eliminate redundant preparation work.",
		gradient: "from-violet-50 to-violet-100/50",
		iconColor: "text-violet-600",
	},
	{
		icon: Zap,
		title: "API & Webhook Integration",
		description:
			"SynergySign integrates cleanly into your stack with REST API + future GraphQL endpoint, webhooks for events, OAuth2 / SSO (coming soon), and compatibility with AIP/OpenI fabric for deep automation. Ideal for enterprise automation and full-stack integration.",
		gradient: "from-yellow-50 to-yellow-100/50",
		iconColor: "text-yellow-600",
	},
	{
		icon: Smartphone,
		title: "Mobile-Ready Signing Experience",
		description:
			"Sign and send documents from any device, with a clean, responsive interface that never breaks layouts — regardless of screen size.",
		gradient: "from-rose-50 to-rose-100/50",
		iconColor: "text-rose-600",
	},
	{
		icon: Lock,
		title: "Enterprise-Grade Security",
		description:
			"Engineered to meet strict enterprise requirements with zero-trust architecture, AES-256 encryption, key rotation and secure token policies, geographic redundancy, and automated threat detection. Security is not a checkbox — it's part of the fabric.",
		gradient: "from-red-50 to-red-100/50",
		iconColor: "text-red-600",
	},
];

export function LandingFeatures() {
	return (
		<section className="py-20 px-6 lg:px-8 bg-white">
			<div className="mx-auto max-w-7xl">
				<div className="text-center mb-16">
					<Badge
						variant="outline"
						className="mb-6 border-blue-200 text-blue-700 bg-blue-50/50 px-4 py-1.5"
					>
						COMPLETE FEATURE SET
					</Badge>
					<h2 className="text-4xl md:text-5xl mb-4 text-gray-900">
						Everything You Need, All in One Place
					</h2>
					<p className="text-lg text-gray-600 max-w-3xl mx-auto">
						Enterprise-grade document signing powered by advanced AI
						and built for teams of any size
					</p>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
					{mainFeatures.map((feature, index) => {
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
								<p className="text-gray-600 leading-relaxed text-sm">
									{feature.description}
								</p>
							</Card>
						);
					})}
				</div>
			</div>
		</section>
	);
}
