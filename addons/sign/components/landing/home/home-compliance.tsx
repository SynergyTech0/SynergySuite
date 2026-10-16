import { Badge } from "@/components/ui/badge";

const complianceLogos = [
	"ESIGN",
	"UETA",
	"SOC 2",
	"HIPAA",
	"ISO 27001",
	"GDPR",
];

export function LandingCompliance() {
	return (
		<section className="py-8 px-6 lg:px-8 bg-gray-50/50 border-y border-gray-100">
			<div className="mx-auto max-w-7xl">
				<p className="text-center text-sm text-gray-500 mb-4">
					Trusted & Compliant with Industry Standards
				</p>
				<div className="flex flex-wrap justify-center items-center gap-8">
					{complianceLogos.map((logo) => (
						<Badge
							key={logo}
							variant="outline"
							className="px-4 py-2 border-gray-300 text-gray-700 bg-white"
						>
							{logo}
						</Badge>
					))}
				</div>
			</div>
		</section>
	);
}
