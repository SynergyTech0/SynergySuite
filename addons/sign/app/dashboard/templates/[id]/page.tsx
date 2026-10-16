"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SignersForm from "@/components/documents/SignersForm";
import PdfFieldOverlay from "@/components/documents/PdfFieldOverlay";
import FieldPalette from "@/components/documents/FieldPalette";
import type { Signer } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { Spinner } from "@/components/ui/spinner";

interface TemplateField {
	id: string;
	fieldType: string;
	label: string;
	required: boolean;
	pageNumber: number | null;
	x: number;
	y: number;
	width: number;
	height: number;
	value: string | null;
	assignedToId: string | null;
}

interface TemplateDetails {
	id: string;
	name: string;
	description: string;
	content: string;
	createdAt: string;
	updatedAt: string;
	cloudStoragePath: string;
	cloudProvider: string;
	fields?: TemplateField[];
}

export default function TemplatePage({ params }: { params: { id: string } }) {
	const [template, setTemplate] = useState<TemplateDetails | null>(null);
	const [signers, setSigners] = useState<Signer[]>([{ email: "", name: "" }]);
	const [loading, setLoading] = useState(true);
	const [sending, setSending] = useState(false);
	const [pdfUrl, setPdfUrl] = useState<string>("");
	const [selectedSignerId, setSelectedSignerId] = useState<string | null>(null);
	const [fieldsKey, setFieldsKey] = useState(0);
	const { toast } = useToast();
	const router = useRouter();
	const { id } = params;

	useEffect(() => {
		const fetchTemplate = async () => {
			try {
				setLoading(true);
				const response = await fetch(`/api/templates/${id}`);
				if (!response.ok) {
					const errorData = await response.json().catch(() => ({}));
					throw new Error(errorData.error || "Failed to fetch template");
				}
				const data = await response.json();
				setTemplate(data);
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : "Failed to load template";
				toast({
					title: "Error",
					description: errorMessage,
					variant: "destructive",
				});
			} finally {
				setLoading(false);
			}
		};

		fetchTemplate();
	}, [id, toast]);

	// Fetch secure URL when template changes
	useEffect(() => {
		let interval: NodeJS.Timeout | null = null;

		const fetchSecureUrl = async () => {
			if (!id) {
				setPdfUrl("");
				return;
			}

			try {
				const res = await fetch(`/api/templates/${id}/secure-url`, {
					credentials: "include",
				});

				if (!res.ok) {
					console.error("Failed to fetch secure URL");
					return;
				}

				const data = await res.json();
				setPdfUrl(data.url);
			} catch (err) {
				console.error("Error fetching secure URL:", err);
			}
		};

		fetchSecureUrl();

		// Refresh URL every 4 minutes (before 5 min expiry)
		interval = setInterval(fetchSecureUrl, 4 * 60 * 1000);

		return () => {
			if (interval) {
				clearInterval(interval);
			}
		};
	}, [id]);

	const handleSendToSigners = async () => {
		// Validate signers
		const validSigners = signers.filter((s) => s.email.trim() !== "");

		if (validSigners.length === 0) {
			toast({
				title: "Validation Error",
				description: "Please add at least one signer with a valid email",
				variant: "destructive",
			});
			return;
		}

		// Check for valid email format
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		const invalidEmails = validSigners.filter((s) => !emailRegex.test(s.email));

		if (invalidEmails.length > 0) {
			toast({
				title: "Validation Error",
				description: "Please ensure all signers have valid email addresses",
				variant: "destructive",
			});
			return;
		}

		setSending(true);
		try {
			const response = await fetch(`/api/templates/${id}/use`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					signers: validSigners,
					title: `Document from ${template?.name}`,
					description: template?.description || "",
				}),
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(errorData.error || "Failed to create document from template");
			}

			const { documentId } = await response.json();

			toast({
				title: "Success",
				description: "Document created successfully!",
			});

			// Redirect to the new document
			router.push(`/dashboard/documents/${documentId}`);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Failed to send document";
			toast({
				title: "Error",
				description: errorMessage,
				variant: "destructive",
			});
		} finally {
			setSending(false);
		}
	};

	const handleFieldsUpdate = () => {
		// Increment key to force PdfFieldOverlay to refresh fields
		setFieldsKey((prev) => prev + 1);
	};

	if (loading) {
		return (
			<div className="flex items-center justify-center min-h-screen">
				<Spinner size="lg" />
			</div>
		);
	}

	if (!template) {
		return (
			<div className="p-6 text-center">
				<h3 className="text-lg font-medium text-gray-900 mb-2">Template not found</h3>
				<Link href="/dashboard/templates">
					<Button variant="outline">Back to Templates</Button>
				</Link>
			</div>
		);
	}

	if (!pdfUrl) {
		return (
			<div className="flex items-center justify-center min-h-screen">
				<div className="animate-spin h-12 w-12 border-b-2 border-blue-600 rounded-full" />
			</div>
		);
	}

	// Map signers to format needed by PdfFieldOverlay
	const mappedSigners = signers
		.filter((s) => s.email.trim() !== "")
		.map((s, index) => ({
			id: `signer-${index}`,
			name: s.name || s.email,
			email: s.email,
		}));

	return (
		<div className="p-6">
			<div className="flex items-center justify-between mb-4">
				<div className="flex items-center space-x-2">
					<Link href="/dashboard/templates">
						<Button variant="ghost" size="lg">
							<ChevronLeft />
						</Button>
					</Link>
					<div className="flex flex-col space-y-1">
						<h1 className="text-2xl font-bold">Template: {template.name}</h1>
						<p className="ms-1 text-sm text-gray-600">{template.description}</p>
					</div>
				</div>
				<Button
					onClick={handleSendToSigners}
					disabled={sending || signers.filter(s => s.email.trim() !== "").length === 0}
					className="bg-blue-600 hover:bg-blue-700"
				>
					{sending ? (
						<>
							<Spinner size="sm" className="mr-2" />
							Creating...
						</>
					) : (
						<>
							<Send className="w-4 h-4 mr-2" />
							Send to Signers
						</>
					)}
				</Button>
			</div>

			<div className="flex gap-4 h-[calc(100vh-180px)]">
				{/* Field Palette - Left Side */}
				<div className="w-64 flex-shrink-0">
					<FieldPalette
						signers={mappedSigners}
						selectedSignerId={selectedSignerId}
						onSignerChange={setSelectedSignerId}
					/>
				</div>

				{/* PDF Viewer - Center */}
				<div className="flex-1 min-w-0">
					<PdfFieldOverlay
						key={fieldsKey}
						documentId={id}
						pdfUrl={pdfUrl}
						mode="edit"
						signers={mappedSigners}
						onFieldsUpdate={handleFieldsUpdate}
						isTemplate={true}
					/>
				</div>

				{/* Signers Form - Right Side */}
				<div className="w-80 flex-shrink-0">
					<SignersForm
						signers={signers}
						onSignersChange={setSigners}
						title="Template Signers"
						description="People who will sign documents created from this template"
					/>
				</div>
			</div>
		</div>
	);
}
