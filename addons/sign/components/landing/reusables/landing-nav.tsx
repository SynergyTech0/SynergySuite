import { FileSignature, Menu, PenTool, X } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useState } from "react";

const navigation = [
	{ name: "Home", href: "home" },
	{ name: "Features", href: "features" },
	{ name: "Pricing", href: "pricing" },
	{ name: "Security", href: "security" },
];

export function LandingNav({ page, setPage }: { page: 'home' | 'features' | 'pricing' | 'security'; setPage: (page: 'home' | 'features' | 'pricing' | 'security') => void }) {
	const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
	return (
		<header className="bg-white border-b border-gray-200 sticky top-0 z-50">
			<nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
				<div className="flex justify-between items-center py-4">
					<div className="flex items-center space-x-2">
						<div className="bg-blue-600 p-2 rounded-lg">
							<FileSignature className="w-6 h-6 text-white" />
						</div>
						<span className="text-2xl font-bold text-gray-900">
							SynergySign
						</span>
					</div>
					<div className="hidden md:flex flex-shrink space-x-6">
						{navigation.map((item) => (
							<Link
								key={item.name}
								href="#"
								onClick={() => setPage((item.href) as 'home' | 'features' | 'pricing' | 'security')}
								className={`text-sm transition-colors ${
									page === item.href
										? "text-blue-600"
										: "text-gray-600 hover:text-gray-900"
								}`}
							>
								{item.name}
							</Link>
						))}
					</div>
					<div className="hidden md:flex items-center space-x-4">
						<Link href="/auth/login">
							<Button variant="ghost" size="sm">
								Sign In
							</Button>
						</Link>
						<Link href="/auth/signup">
							<Button
								size="sm"
								className="bg-blue-600 hover:bg-blue-700"
							>
								Start For Free
							</Button>
						</Link>
					</div>

					{/* Mobile Menu Button */}
					<button
					className="md:hidden p-2"
					onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
					>
					{mobileMenuOpen ? (
						<X className="w-6 h-6 text-gray-900" />
					) : (
						<Menu className="w-6 h-6 text-gray-900" />
					)}
					</button>
				</div>
      		</nav>

			{/* Mobile Menu */}
			{mobileMenuOpen && (
				<div className="md:hidden border-t border-gray-200 bg-white">
					<div className="px-6 py-4 space-y-3">
						{navigation.map((item) => (
						<Link
							key={item.name}
							href="#"
							onClick={() => { setPage((item.href) as 'home' | 'features' | 'pricing' | 'security'); setMobileMenuOpen(false); }}
							className={`block py-2 text-sm text-center hover:bg-gray-100 ${
							page === item.href
								? "text-blue-600"
								: "text-gray-600 hover:text-gray-900"
							}`}
						>
							{item.name}
						</Link>
						))}
						<div className="pt-3 flex flex-col gap-2">
							<Button variant="ghost" size="sm" className="w-full text-gray-700">
								Sign In
							</Button>
							<Button size="sm" className="w-full bg-blue-600 hover:bg-blue-700 text-white">
								Start For Free
							</Button>
						</div>
					</div>
				</div>
			)}
		</header>
	);
}
