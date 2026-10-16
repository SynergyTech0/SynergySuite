import { Check } from "lucide-react";

export function PricingComparison() {
	const detailedFeatures = [
		{
			category: "Documents & Signing",
			items: [
				{
					feature: "Documents per month",
					free: "3 documents per month",
					basic: "20 documents per month",
					pro: "100 documents per month",
					enterprise: "Unlimited documents",
				},
				{
					feature: "Signers per document",
					free: "2 signers per document",
					basic: "5 signers per document",
					pro: "10 signers per document",
					enterprise: "25 signers per document",
				},
				{
					feature: "Templates",
					free: "1 template",
					basic: "10 templates",
					pro: "50 templates",
					enterprise: "Unlimited templates",
				},
			],
		},
		{
			category: "Features",
			items: [
				{
					feature: "AI field detection",
					free: false,
					basic: true,
					pro: true,
					enterprise: true,
				},
				{
					feature: "Custom branding",
					free: false,
					basic: false,
					pro: false,
					enterprise: true,
				},
				{
					feature: "Priority support",
					free: false,
					basic: false,
					pro: true,
					enterprise: true,
				},
				{
					feature: "Dedicated support",
					free: false,
					basic: false,
					pro: false,
					enterprise: true,
				},
			],
		},
	];

	return (
		<section className="py-20 px-6 lg:px-8 bg-gray-50/50">
			<div className="mx-auto max-w-7xl">
				<div className="text-center mb-12">
					<h2 className="text-4xl md:text-5xl mb-4 text-gray-900">
						Detailed Feature Comparison
					</h2>
					<p className="text-lg text-gray-600">
						Compare all features across plans
					</p>
				</div>

				<div className="space-y-12">
					{detailedFeatures.map((category, catIndex) => (
						<div key={catIndex}>
							<h3 className="text-2xl mb-6 text-gray-900">
								{category.category}
							</h3>
							<div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
								<div className="overflow-x-auto">
									<table className="w-full">
										<thead className="bg-gray-50 border-b border-gray-200">
											<tr>
												<th className="text-left p-4 text-sm text-gray-900">
													Feature
												</th>
												<th className="text-center p-4 text-sm text-gray-900">
													Free
												</th>
												<th className="text-center p-4 text-sm text-gray-900">
													Basic
												</th>
												<th className="text-center p-4 text-sm text-gray-900">
													Pro
												</th>
												<th className="text-center p-4 text-sm text-gray-900">
													Enterprise
												</th>
											</tr>
										</thead>
										<tbody>
											{category.items.map(
												(item, itemIndex) => (
													<tr
														key={itemIndex}
														className="border-b border-gray-100 last:border-0"
													>
														<td className="p-4 text-sm text-gray-700">
															{item.feature}
														</td>
														<td className="p-4 text-center text-sm">
															{typeof item.free ===
															"boolean" ? (
																item.free ? (
																	<Check className="w-5 h-5 text-green-600 mx-auto" />
																) : (
																	<span className="text-gray-300">
																		—
																	</span>
																)
															) : (
																<span className="text-gray-700">
																	{item.free}
																</span>
															)}
														</td>
														<td className="p-4 text-center text-sm">
															{typeof item.basic ===
															"boolean" ? (
																item.basic ? (
																	<Check className="w-5 h-5 text-green-600 mx-auto" />
																) : (
																	<span className="text-gray-300">
																		—
																	</span>
																)
															) : (
																<span className="text-gray-700">
																	{item.basic}
																</span>
															)}
														</td>
														<td className="p-4 text-center text-sm">
															{typeof item.pro ===
															"boolean" ? (
																item.pro ? (
																	<Check className="w-5 h-5 text-green-600 mx-auto" />
																) : (
																	<span className="text-gray-300">
																		—
																	</span>
																)
															) : (
																<span className="text-gray-700">
																	{item.pro}
																</span>
															)}
														</td>
														<td className="p-4 text-center text-sm">
															{typeof item.enterprise ===
															"boolean" ? (
																item.enterprise ? (
																	<Check className="w-5 h-5 text-green-600 mx-auto" />
																) : (
																	<span className="text-gray-300">
																		—
																	</span>
																)
															) : (
																<span className="text-gray-700">
																	{
																		item.enterprise
																	}
																</span>
															)}
														</td>
													</tr>
												)
											)}
										</tbody>
									</table>
								</div>
							</div>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
