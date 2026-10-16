import { FileSignature } from "lucide-react";
import Link from "next/link";

export function LandingFooter({ setPage }: { setPage: (page: 'home' | 'features' | 'pricing' | 'security') => void }) {
	return (
		<footer className="bg-[#1a1d29] text-white w-full">
			<div className="mx-auto max-w-7xl px-6 lg:px-8 py-16">
				<div className="grid grid-cols-1 md:grid-cols-4 gap-12">
					{/* Brand */}
					<div className="space-y-4 col-span-2">
						<div className="flex items-center justify-center space-x-2">
							<div className="bg-blue-600 p-2 rounded-lg">
								<FileSignature className="w-6 h-6 text-white" />
							</div>
							<span className="text-2xl font-bold text-white">
								SynergySign
							</span>
						</div>
						<p className="text-gray-400">
							The future of electronic signatures, powered by
							artificial intelligence.
						</p>
					</div>

					{/* Product */}
					<div className="text-center">
						<h4 className="mb-4 text-sm text-white">Product</h4>
						<ul className="space-y-2.5 text-sm text-gray-400">
							<li>
								<Link
									href="/#"
									onClick={() => setPage('features')}
									className="hover:text-white transition-colors"
								>
									Features
								</Link>
							</li>
							<li>
								<Link
									href="/#"
									onClick={() => setPage('pricing')}
									className="hover:text-white transition-colors"
								>
									Pricing
								</Link>
							</li>
							<li>
								<Link
									href="/#"
									onClick={() => setPage('security')}
									className="hover:text-white transition-colors"
								>
									Security
								</Link>
							</li>
						</ul>
					</div>

					{/* Company */}
					<div className="text-center">
						<h4 className="mb-4 text-sm text-white">Company</h4>
						<ul className="space-y-2.5 text-sm text-gray-400">
							<li>
								<a
									href="/contact"
									className="hover:text-white transition-colors"
								>
									Contact
								</a>
							</li>
						</ul>
					</div>
				</div>

				<div className="mt-12 pt-8 border-t border-gray-800 text-center">
					<p className="text-sm text-gray-500">
						© 2025 SynergySign. All rights reserved.
					</p>
				</div>
			</div>
		</footer>
	);
}
