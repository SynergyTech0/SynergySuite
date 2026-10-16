import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle, PenTool, Upload } from "lucide-react";
import Link from "next/link";

export function LandingHowItWorks() {
	return (
		<div className="bg-white py-2">
			<section className="py-20 px-6 lg:px-8">
				<div className="mx-auto max-w-7xl">
					<div className="text-center mb-16">
						<Badge
							variant="outline"
							className="mb-6 border-blue-200 text-blue-700 bg-blue-50/50 px-4 py-1.5"
						>
							SIMPLE WORKFLOW
						</Badge>
						<h2 className="text-4xl md:text-5xl mb-4 text-gray-900">
							How It Works
						</h2>
						<p className="text-lg text-gray-600 max-w-2xl mx-auto">
							From upload to signed document in minutes. Our
							streamlined process makes document signing
							effortless.
						</p>
					</div>

					<div className="relative">
						{/* Connection Line - Desktop Only */}
						<div
							className="hidden lg:block absolute top-24 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-200 via-blue-400 to-blue-200"
							style={{ zIndex: 0 }}
						/>

						<div
							className="grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-12 relative"
							style={{ zIndex: 1 }}
						>
							{/* Step 1 */}
							<div className="relative">
								<div className="bg-white rounded-2xl border-2 border-gray-200 p-8 hover:border-blue-300 hover:shadow-lg transition-all h-full">
									<div className="flex items-start gap-6 mb-6">
										<div className="relative flex-shrink-0">
											<div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center shadow-lg">
												<Upload className="w-8 h-8 text-white" />
											</div>
											<div className="absolute -top-2 -right-2 w-7 h-7 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs">
												1
											</div>
										</div>
										<div className="flex-1">
											<h3 className="text-2xl mb-2 text-gray-900">
												Upload Document
											</h3>
											<p className="text-sm text-gray-600">
												Choose from templates or upload
												your own
											</p>
										</div>
									</div>
									<div className="space-y-3">
										<div className="flex items-center gap-2 text-sm text-gray-700">
											<CheckCircle className="w-4 h-4 text-blue-600" />
											<span>
												Drag & drop or browse files
											</span>
										</div>
										<div className="flex items-center gap-2 text-sm text-gray-700">
											<CheckCircle className="w-4 h-4 text-blue-600" />
											<span>Access template library</span>
										</div>
										<div className="flex items-center gap-2 text-sm text-gray-700">
											<CheckCircle className="w-4 h-4 text-blue-600" />
											<span>
												Supports all major formats
											</span>
										</div>
									</div>
								</div>
							</div>

							{/* Step 2 */}
							<div className="relative">
								<div className="bg-white rounded-2xl border-2 border-gray-200 p-8 hover:border-blue-300 hover:shadow-lg transition-all h-full">
									<div className="flex items-start gap-6 mb-6">
										<div className="relative flex-shrink-0">
											<div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center shadow-lg">
												<PenTool className="w-8 h-8 text-white" />
											</div>
											<div className="absolute -top-2 -right-2 w-7 h-7 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs">
												2
											</div>
										</div>
										<div className="flex-1">
											<h3 className="text-2xl mb-2 text-gray-900">
												Configure & Sign
											</h3>
											<p className="text-sm text-gray-600">
												AI detects fields automatically
											</p>
										</div>
									</div>
									<div className="space-y-3">
										<div className="flex items-center gap-2 text-sm text-gray-700">
											<CheckCircle className="w-4 h-4 text-blue-600" />
											<span>
												AI-powered field detection
											</span>
										</div>
										<div className="flex items-center gap-2 text-sm text-gray-700">
											<CheckCircle className="w-4 h-4 text-blue-600" />
											<span>Add multiple signers</span>
										</div>
										<div className="flex items-center gap-2 text-sm text-gray-700">
											<CheckCircle className="w-4 h-4 text-blue-600" />
											<span>
												Set signing order & rules
											</span>
										</div>
									</div>
								</div>
							</div>

							{/* Step 3 */}
							<div className="relative">
								<div className="bg-white rounded-2xl border-2 border-gray-200 p-8 hover:border-blue-300 hover:shadow-lg transition-all h-full">
									<div className="flex items-start gap-6 mb-6">
										<div className="relative flex-shrink-0">
											<div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center shadow-lg">
												<CheckCircle className="w-8 h-8 text-white" />
											</div>
											<div className="absolute -top-2 -right-2 w-7 h-7 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs">
												3
											</div>
										</div>
										<div className="flex-1">
											<h3 className="text-2xl mb-2 text-gray-900">
												Complete & Store
											</h3>
											<p className="text-sm text-gray-600">
												Secure, compliant, and legally
												binding
											</p>
										</div>
									</div>
									<div className="space-y-3">
										<div className="flex items-center gap-2 text-sm text-gray-700">
											<CheckCircle className="w-4 h-4 text-blue-600" />
											<span>
												Full audit trail included
											</span>
										</div>
										<div className="flex items-center gap-2 text-sm text-gray-700">
											<CheckCircle className="w-4 h-4 text-blue-600" />
											<span>Encrypted cloud storage</span>
										</div>
										<div className="flex items-center gap-2 text-sm text-gray-700">
											<CheckCircle className="w-4 h-4 text-blue-600" />
											<span>Download anytime</span>
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>

					<div className="text-center mt-12">
						<Link href="/auth/signup">
							<Button
								size="lg"
								className="bg-blue-600 hover:bg-blue-700 text-white px-8"
							>
								Try It Yourself
								<ArrowRight className="w-4 h-4 ml-2" />
							</Button>
						</Link>
					</div>
				</div>
			</section>
		</div>
	);
}
