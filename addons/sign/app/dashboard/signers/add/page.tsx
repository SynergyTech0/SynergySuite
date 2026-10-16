"use client";

import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
	CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { Plus, X, UserPlus, UploadIcon, ChevronLeft } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useToast } from "@/hooks/use-toast";

// -----------------------------
// Type Definitions
// -----------------------------
interface Document {
	id: string;
	title: string;
	status: string;
	createdAt: string;
	updatedAt: string;
	aiSummary?: string | null;
	sender: {
		name: string;
		email: string;
	};
	signers: Array<{
		id: string;
		email: string;
		status: string;
	}>;
}

export default function AddSignerPage() {
    //Session management
	const { data: session, status } = useSession() || {};
	const router = useRouter();
    
    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/auth/login");
        } else if (status === "authenticated") {
            fetchDocuments();
        }
    }, [status, router]);
    
    // Toast notifications
    const { toast } = useToast();
    
    // Signer management
	const [signers, setSigners] = useState([{ email: "", name: "" }]);
	const addSigner = () => setSigners([...signers, { email: "", name: "" }]);
	const removeSigner = (i: number) =>
		setSigners(signers.filter((_, idx) => idx !== i));
	const updateSigner = (i: number, field: "email" | "name", val: string) =>
		setSigners(
            signers.map((s, idx) => (idx === i ? { ...s, [field]: val } : s))
		);
    
    // Document management    
    const [documents, setDocuments] = useState<Document[]>([]);
    const [selectedDocument, setSelectedDocument] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const fetchDocuments = async () => {
        try {
            const response = await fetch("/api/documents");
            if (response.ok) {
                const data = await response.json();
                setDocuments(data.documents || []);
                
                // Check for documentId in query params and pre-select if present
                const params = new URLSearchParams(window.location.search);
                const documentId = params.get("documentId");
                if (documentId) {
                    setSelectedDocument(documentId);
                    // Find the document and set the query to its title
                    const doc = (data.documents || []).find((d: Document) => d.id === documentId);
                    if (doc) {
                        setQuery(doc.title);
                    }
                }
            }
        } catch (error) {
            console.error("Failed to fetch documents:", error);
        } finally {
            setLoading(false);
        }
    };
        
	// Combobox state
	const [query, setQuery] = useState("");
	const [isOpen, setIsOpen] = useState(false);
	const [highlighted, setHighlighted] = useState(0);
	const comboboxRef = useRef<HTMLDivElement | null>(null);

	const filtered = documents.filter((d) =>
		d.title.toLowerCase().includes(query.toLowerCase())
	);

	// click outside to close
	useEffect(() => {
		const onDocClick = (e: MouseEvent) => {
			if (!comboboxRef.current) return;
			if (!comboboxRef.current.contains(e.target as Node)) {
				setIsOpen(false);
			}
		};
		document.addEventListener("click", onDocClick);
		return () => document.removeEventListener("click", onDocClick);
	}, []);

	const onSelect = (d: Document) => {
		setQuery(d.title);
		setIsOpen(false);
		setSelectedDocument(d.id);
	};

    //Allow for keyboard navigation
	const onKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
		if (!isOpen) return;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setHighlighted((prev) =>
				Math.min(prev + 1, Math.max(0, filtered.length - 1))
			);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setHighlighted((prev) => Math.max(prev - 1, 0));
		} else if (e.key === "Enter") {
			e.preventDefault();
			const item = filtered[highlighted];
			if (item) onSelect(item);
		} else if (e.key === "Escape") {
			setIsOpen(false);
		}
	};

    // Validate email format
    const validateEmail = (email : string) => {
        let regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        return regex.test(email);
    };

    // Handle adding signers
	const handleNewSigners = async () => {
		console.log("Adding signers:", signers);
        console.log("Selected document:", selectedDocument);

        const requestBody = {
            documentId: selectedDocument,
            signers: signers
        }

        for (const signer of signers) {
            if (!validateEmail(signer.email) || !signer.name) {
                toast({
                    title: 'Error',
                    description: 'Please provide valid email and name for all signers.',
                });
                return;
            }
        }
        
        try {
            console.log("Sending email invites...");
            const emailRes = await fetch("/api/signers/invite", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestBody),
            });
            
            //Handle response
            if(emailRes.ok) {
                console.log("Email invites sent successfully");

                let data = await emailRes.json();
                let invitedCount = data.signersInvited;
                // Show appropriate toast based on number of invites sent
                if (invitedCount <= 0) {
                    toast({
                        title: 'No Invites Sent',
                        description: 'No signers were invited. Please check for duplicate or incorrect emails.',
                    });
                }
                else if (invitedCount < signers.length) {
                    toast({
                        title: 'Partial Invites Sent',
                        description: `Only ${invitedCount} out of ${signers.length} signers were invited. Please check for duplicate emails.`,
                    });
                } else {
                    toast({
                        title: 'Invites Sent!',
                        description: 'Successfully invited ' + signers.length + ' users.',
                    });
                }

                router.replace('/dashboard/signers');
            } else {
                console.error("Failed to send email invites" + emailRes.statusText);
                //TODO: Environment variables for email set temporarily
            }
        } catch (error) {
            console.error("Error adding signers:", error);
            return;
        }
	};

    // Render component
	return (
		<div className="grid gap-4 p-6">
            <div className="flex items-center space-x-4">
            <Link href="/dashboard/signers">
            <Button variant="ghost" size="lg" className="mb-2">
                <ChevronLeft />
            </Button>
            </Link>
            <div className='flex flex-col'>
            <h1 className="text-3xl font-bold text-gray-900">Add Signers</h1>
            <p className="text-gray-600 mt-1">Add signers to the document</p>
            </div>
        </div>
			<Card>
				<CardHeader>
					<CardTitle>Select Document</CardTitle>
					<CardDescription>
						Add the document to be signed
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4 grid">
					<Label htmlFor="doc-combobox">Document</Label>
                    {loading ?
                    <div>Loading documents...</div>
                    :
                    <>
                        <div ref={comboboxRef} className="relative">
                            <Input
                                id="doc-combobox"
                                placeholder="Search documents..."
                                value={query}
                                onChange={(e) => {
                                    setQuery(e.target.value);
                                    setIsOpen(true);
                                    setHighlighted(0);
                                }}
                                onFocus={() => setIsOpen(true)}
                                onKeyDown={onKeyDown}
                            />

                            {isOpen && (
                                <ul className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-md border bg-white shadow-lg">
                                    {filtered.length === 0 ? (
                                        <li className="px-3 py-2 text-sm text-gray-500">
                                            No documents
                                        </li>
                                    ) : (
                                        filtered.map((d, idx) => (
                                            <li
                                                key={d.id}
                                                className={`px-3 py-2 cursor-pointer text-sm hover:bg-gray-100 ${
                                                    highlighted === idx
                                                        ? "bg-gray-100"
                                                        : ""
                                                }`}
                                                onMouseEnter={() =>
                                                    setHighlighted(idx)
                                                }
                                                onClick={() => onSelect(d)}
                                            >
                                                <div className="font-medium truncate">
                                                    {d.title}
                                                </div>
                                                <div className="text-xs text-gray-500">
                                                    {d.sender?.name ||
                                                        d.sender?.email}
                                                </div>
                                            </li>
                                        ))
                                    )}
                                </ul>
                            )}
                        </div>
                        <Link href="/dashboard/documents/upload">
                            <Button>
                                <UploadIcon className="w-4 h-4 mr-2" />
                                Upload New Document
                            </Button>
                        </Link>
                    </>
                    }
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Signers</CardTitle>
					<CardDescription>
						People who must sign this document
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{signers.map((s, i) => (
						<div key={i} className="flex gap-4 items-end">
							<div className="flex-1">
								<Label>Name</Label>
								<Input
									value={s.name}
									onChange={(e) =>
										updateSigner(i, "name", e.target.value)
									}
									placeholder="Signer name"
								/>
							</div>
							<div className="flex-1">
								<Label>Email *</Label>
								<Input
									type="email"
									value={s.email}
									onChange={(e) =>
										updateSigner(i, "email", e.target.value)
									}
									placeholder="signer@example.com"
									required
								/>
							</div>
							{signers.length > 1 && (
								<Button
									type="button"
									variant="outline"
									onClick={() => removeSigner(i)}
								>
									<X className="w-4 h-4" />
								</Button>
							)}
						</div>
					))}
					<Button
						type="button"
						variant="outline"
						onClick={addSigner}
						className="w-full"
					>
						<Plus className="w-4 h-4 mr-2" /> New Signer
					</Button>
				</CardContent>
			</Card>

			<Button onClick={handleNewSigners}>
				<UserPlus className="w-4 h-4 mr-2" />
				Add Signers to Document
			</Button>
		</div>
	);
}
