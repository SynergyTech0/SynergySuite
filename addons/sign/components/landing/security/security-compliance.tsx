import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowRight, CheckCircle, Scale } from "lucide-react";
import Link from "next/link";

export function SecurityCompliance() {
	const complianceStandards = [
		{
			name: "ESIGN Act",
			description:
				"U.S. Electronic Signatures in Global and National Commerce Act",
		},
		{
			name: "UETA",
			description: "Uniform Electronic Transactions Act",
		},
		{
			name: "eIDAS",
			description:
				"European Union electronic identification and trust services",
		},
		{
			name: "GDPR",
			description: "General Data Protection Regulation compliant",
		},
		{
			name: "SOC 2 Type II",
			description: "Service Organization Control security certification",
		},
		{
			name: "ISO 27001",
			description:
				"International information security management standard",
		},
	];

	return (
		<section className="py-20 px-6 lg:px-8 bg-gray-50/50">
			<div className="mx-auto max-w-7xl">
				<div className="text-center mb-16">
					<h2 className="text-4xl md:text-5xl mb-4 text-gray-900">
						Industry-Leading Compliance
					</h2>
					<p className="text-lg text-gray-600 max-w-3xl mx-auto">
						Our signatures are legally binding and compliant with
						international regulations and standards
					</p>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
					{complianceStandards.map((standard, index) => (
						<Card key={index} className="p-6 border-gray-200">
							<div className="flex items-start gap-3">
								<div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
									<CheckCircle className="w-5 h-5" />
								</div>
								<div>
									<h4 className="mb-1 text-gray-900">
										{standard.name}
									</h4>
									<p className="text-sm text-gray-600">
										{standard.description}
									</p>
								</div>
							</div>
						</Card>
					))}
				</div>

				<Card className="mt-12 p-8 bg-blue-50/50 border-blue-200">
					<div className="flex items-start gap-4">
						<Scale className="w-6 h-6 text-blue-600 flex-shrink-0 mt-1" />
						<div>
							<h4 className="text-xl mb-2 text-gray-900">
								Legal Validity Worldwide
							</h4>
							<p className="text-gray-700 leading-relaxed">
								Our electronic signatures are legally binding in
								over 180 countries. Each signature includes a
								certificate of completion with full audit trail,
								ensuring enforceability in court. We maintain
								compliance with local and international
								regulations including ESIGN (USA), UETA (USA),
								eIDAS (EU), and equivalent laws worldwide.
							</p>
						</div>
					</div>
				</Card>
			</div>
		</section>
	);
}
