"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowLeft,
  Download,
  Save,
  FileText,
  CheckCircle,
  Clock,
  ArrowRight,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import PdfFieldOverlay from "@/components/documents/PdfFieldOverlay";
import FieldPalette from "@/components/documents/FieldPalette";
import SignersForm from "@/components/documents/SignersForm";
import AiInsightsPanel from "@/components/documents/AiInsightsPanel";
import type { Signer } from "@/lib/types";
import { CloudProvider } from "@prisma/client";

interface DocumentField {
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

interface DocumentDetails {
  id: string;
  title: string;
  description: string;
  status: string;
  signingOrder: string;
  createdAt: string;
  updatedAt: string;
  cloudStoragePath: string;
  cloudProvider: CloudProvider;
  sender: { id: string; name: string; email: string };
  signers: Array<{
    id: string;
    email: string;
    name: string | null;
    status: string;
    signedAt: string | null;
    order: number;
  }>;
  fields?: DocumentField[];
}

export default function DocumentDetailPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const params = useParams();
  const documentId = params?.id as string;

  const [document, setDocument] = useState<DocumentDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string>("");
  const [accessError, setAccessError] = useState<string | null>(null);
  const [selectedSignerId, setSelectedSignerId] = useState<string | null>(null);

  // Editable signers state for drafts
  const [editableSigners, setEditableSigners] = useState<Signer[]>([{ email: "", name: "" }]);
  const [signingOrder, setSigningOrder] = useState<"PARALLEL" | "SEQUENTIAL">("PARALLEL");

  // Fetch document details
  const fetchDocument = async () => {
    try {
      const res = await fetch(`/api/documents/${documentId}`, { credentials: "include" });
      const data = await res.json();
      setDocument(data);

      // Populate editable signers from document
      if (data.signers && data.signers.length > 0) {
        setEditableSigners(
          data.signers.map((s: any) => ({
            email: s.email || "",
            name: s.name || "",
          }))
        );
      } else {
        setEditableSigners([{ email: "", name: "" }]);
      }

      // Set signing order from document
      if (data.signingOrder) {
        setSigningOrder(data.signingOrder as "PARALLEL" | "SEQUENTIAL");
      }
    } catch (err) {
      console.error("Failed to fetch document:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (documentId) fetchDocument();
  }, [documentId]);

  // Fetch secure PDF URL
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    const fetchSecureUrl = async () => {
      if (!documentId) return;
      
      try {
        const res = await fetch(`/api/documents/${documentId}/secure-url`, {
          credentials: "include",
        });
        
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          console.error("Failed to fetch secure URL", errorData);
          
          if (res.status === 403) {
            setAccessError("You don't have permission to access this document.");
          } else if (res.status === 404) {
            setAccessError("Document not found.");
          } else {
            setAccessError("Failed to load document. Please try again.");
          }
          return;
        }
        
        const data = await res.json();
        setPdfUrl(data.url);
        console.log("[Frontend] Received secure URL:", data.url);
      } catch (err) {
        console.error("Error fetching secure URL:", err);
        setAccessError("Failed to load document. Please try again.");
      }
    };

    // Clear any existing interval before creating a new one

    fetchSecureUrl();

    // Refresh URL every 4 minutes (before 5 min expiry)
    interval = setInterval(fetchSecureUrl, 4 * 60 * 1000);

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [documentId]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/download`, { credentials: "include" });
      if (res.ok) {
        // Get the blob from the response
        const blob = await res.blob();

        // Get filename from Content-Disposition header or use default
        const contentDisposition = res.headers.get('Content-Disposition');
        let filename = 'document.pdf';
        if (contentDisposition) {
          const match = contentDisposition.match(/filename="(.+)"/);
          if (match) filename = match[1];
        }

        // Create download link
        const url = window.URL.createObjectURL(blob);
        const link = window.document.createElement('a');
        link.href = url;
        link.download = filename;
        window.document.body.appendChild(link);
        link.click();
        window.URL.revokeObjectURL(url);
        window.document.body.removeChild(link);
      } else {
        // Try to parse error response as JSON
        let errorMessage = 'Unknown error';
        try {
          const contentType = res.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const error = await res.json();
            errorMessage = error.error || error.message || 'Unknown error';
          } else {
            errorMessage = await res.text();
          }
        } catch (parseErr) {
          console.error('Failed to parse error response:', parseErr);
          errorMessage = `Server error (${res.status})`;
        }
        alert(`Download failed: ${errorMessage}`);
      }
    } catch (err) {
      console.error('Download error:', err);
      alert(`Download failed: ${err instanceof Error ? err.message : 'An unexpected error occurred'}`);
    } finally {
      setDownloading(false);
    }
  };

  // Save signers and send invites
  const handleSaveSigners = async () => {
    if (!document) return;

    // Validate signers
    const validSigners = editableSigners.filter(s => s.email.trim());
    if (validSigners.length === 0) {
      alert("Please add at least one signer with a valid email.");
      return;
    }

    // Check for unassigned fields
    const fieldsCheckRes = await fetch(`/api/documents/${document.id}/fields`);
    const fieldsCheckData = await fieldsCheckRes.json();
    const currentFields = fieldsCheckData.fields || [];

    const unassignedFields = currentFields.filter((f: any) => !f.assignedToId);
    if (unassignedFields.length > 0) {
      const proceed = confirm(
        `Warning: ${unassignedFields.length} field(s) are not assigned to any signer. ` +
        `These fields won't be visible to signers. Continue anyway?`
      );
      if (!proceed) return;
    }

    setSaving(true);
    try {
      // Update document signing order
      await fetch(`/api/documents/${document.id}/save`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signingOrder: signingOrder,
        }),
      });

      // Send signer invites
      const res = await fetch("/api/signers/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: document.id,
          signers: validSigners,
          signingOrder: signingOrder,
        }),
      });

      if (res.ok) {
        const responseData = await res.json();
        const createdSigners = responseData.signers || [];

        console.log(`[Save & Send] Response:`, responseData);
        console.log(`[Save & Send] Created/existing signers:`, createdSigners);
        console.log(`[Save & Send] Editable signers:`, editableSigners);

        // Remap field assignments from temp-X IDs to real signer IDs
        if (createdSigners.length > 0) {
          const fieldsRes = await fetch(`/api/documents/${document.id}/fields`);
          const fieldsData = await fieldsRes.json();
          const fields = fieldsData.fields || [];

          console.log(`[Field Remapping] Starting remapping for ${fields.length} fields`);
          console.log(`[Field Remapping] Fields:`, fields.map((f: any) => ({ id: f.id, assignedToId: f.assignedToId, label: f.label })));

          let remappedCount = 0;
          let failedCount = 0;

          for (const field of fields) {
            // Skip fields that are already assigned to real signer IDs (not temp-)
            if (!field.assignedToId) {
              console.log(`[Field Remapping] Field ${field.id} has no assignedToId, skipping`);
              continue;
            }

            if (!field.assignedToId.startsWith("temp-")) {
              console.log(`[Field Remapping] Field ${field.id} already has real ID: ${field.assignedToId}`);
              continue;
            }

            const tempIndex = parseInt(field.assignedToId.replace("temp-", ""));
            const signerEmail = editableSigners[tempIndex]?.email;

            console.log(`[Field Remapping] Field ${field.id}: temp-${tempIndex} → signerEmail: ${signerEmail}`);

            if (signerEmail) {
              // Case-insensitive email matching
              const matchingSigner = createdSigners.find(
                (s: any) => s.email.toLowerCase() === signerEmail.toLowerCase()
              );

              if (matchingSigner) {
                console.log(`[Field Remapping] Found matching signer: ${matchingSigner.id} (${matchingSigner.email})`);

                const patchRes = await fetch(`/api/documents/${document.id}/fields/${field.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ assignedToId: matchingSigner.id }),
                });

                if (patchRes.ok) {
                  const patchData = await patchRes.json();
                  console.log(`[Field Remapping] PATCH response:`, patchData);

                  // Verify the update actually persisted
                  if (patchData.field?.assignedToId === matchingSigner.id) {
                    remappedCount++;
                    console.log(`[Field Remapping] ✓ VERIFIED: Field ${field.id} assignedToId is now ${patchData.field.assignedToId}`);
                  } else {
                    failedCount++;
                    console.error(`[Field Remapping] ✗ UPDATE FAILED: Response shows assignedToId as ${patchData.field?.assignedToId}`);
                  }
                } else {
                  failedCount++;
                  const patchError = await patchRes.text();
                  console.error(`[Field Remapping] ✗ Failed to remap field ${field.id}:`, patchError);
                }
              } else {
                failedCount++;
                console.error(`[Field Remapping] ✗ No signer found for email ${signerEmail}. Available signers:`, createdSigners);
              }
            } else {
              failedCount++;
              console.error(`[Field Remapping] ✗ Invalid temp index ${tempIndex}. editableSigners:`, editableSigners);
            }
          }

          console.log(`[Field Remapping] Complete: ${remappedCount} remapped, ${failedCount} failed`);

          if (failedCount > 0) {
            alert(`Invites sent, but ${failedCount} field(s) could not be assigned to signers. Check browser console for details.`);
          } else if (remappedCount > 0) {
            alert(`Invites sent! ${remappedCount} field(s) assigned to signers.`);
          } else {
            alert("Invites sent successfully!");
          }
        } else {
          console.warn("[Save & Send] No signers returned from invite endpoint");
          alert("Invites sent successfully!");
        }

        router.push("/dashboard/documents");
      } else {
        const error = await res.json();
        alert(`Failed to send invites: ${error.error || "Unknown error"}`);
      }
    } catch (err) {
      console.error("Save signers error:", err);
      alert(`Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin h-12 w-12 border-b-2 border-blue-600 rounded-full" />
      </div>
    );

  if (!document)
    return (
      <div className="p-6 text-center">
        <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">Document not found</h3>
        <Link href="/dashboard/documents">
          <Button>Back</Button>
        </Link>
      </div>
    );

  if (accessError)
    return (
      <div className="p-6 text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">Access Denied</h3>
        <p className="text-gray-600 mb-4">{accessError}</p>
        <Link href="/dashboard/documents">
          <Button>Back to Documents</Button>
        </Link>
      </div>
    );

  if (!pdfUrl)
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin h-12 w-12 border-b-2 border-blue-600 rounded-full" />
      </div>
    );

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/documents">
            <Button variant="outline" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">{document.title}</h1>
            <p className="text-gray-600">
              Created{" "}
              {formatDistanceToNow(new Date(document.createdAt), { addSuffix: true })}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleDownload} disabled={downloading} variant="outline">
            <Download className="w-4 h-4 mr-2" />
            {downloading ? "Downloading…" : "Download"}
          </Button>
          <Button disabled={saving}>
            <Save className="w-4 h-4 mr-2" />
            {saving ? "Saving…" : "Save Fields"}
          </Button>
        </div>
      </div>

      {/* Signing Order Display */}
      {document.signers.length > 0 && (
        <Card className="my-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {document.signingOrder === "SEQUENTIAL" ? (
                <>
                  <ArrowRight className="w-5 h-5" />
                  Sequential Signing Order
                </>
              ) : (
                <>Parallel Signing - All at once</>
              )}
            </CardTitle>
            <CardDescription>
              {document.signingOrder === "SEQUENTIAL"
                ? "Signers must sign in order. Each signer will be notified after the previous one completes."
                : "All signers can sign at the same time in any order."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {document.signers
                .sort((a, b) => a.order - b.order)
                .map((signer, index) => (
                  <div
                    key={signer.id}
                    className="flex items-center gap-3 p-3 border rounded-lg"
                  >
                    {document.signingOrder === "SEQUENTIAL" && (
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 font-semibold">
                        {signer.order}
                      </div>
                    )}
                    <div className="flex-1">
                      <p className="font-medium">{signer.name || signer.email}</p>
                      <p className="text-sm text-gray-500">{signer.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {signer.status === "COMPLETED" ? (
                        <>
                          <CheckCircle className="w-5 h-5 text-green-600" />
                          <span className="text-sm font-medium text-green-600">
                            Signed
                            {signer.signedAt &&
                              ` ${formatDistanceToNow(new Date(signer.signedAt), { addSuffix: true })}`}
                          </span>
                        </>
                      ) : (
                        <>
                          <Clock className="w-5 h-5 text-gray-400" />
                          <span className="text-sm text-gray-600">Pending</span>
                        </>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Field Palette, PDF Viewer, and Signers Panel Layout */}
      <div className="flex gap-4">
        {/* Field Palette - Only show in edit mode */}
        {document.status !== 'COMPLETED' && (
          <div className="w-64 flex-shrink-0">
            <FieldPalette
              signers={editableSigners
                .filter((s) => s.email)
                .map((s, idx) => ({
                  id: `temp-${idx}`,
                  name: s.name || s.email,
                  email: s.email
                }))}
              selectedSignerId={selectedSignerId}
              onSignerChange={setSelectedSignerId}
            />
          </div>
        )}

        {/* PDF Viewer */}
        <div className="flex-1 min-w-0">
          <PdfFieldOverlay
            pdfUrl={pdfUrl}
            documentId={document.id}
            mode={document.status === 'COMPLETED' ? 'view' : 'edit'}
            fields={document.fields || []}
            signers={editableSigners
              .filter((s) => s.email)
              .map((s, idx) => ({
                id: `temp-${idx}`,
                name: s.name || s.email,
                email: s.email
              }))}
            onFieldsUpdate={fetchDocument}
          />
        </div>

        {/* Right Panel - AI insights + Signers Form (only for drafts) */}
        {document.status === 'DRAFT' && (
          <div className="w-80 flex-shrink-0 space-y-4">
            {/* Reads the document, names the parties, flags the risks, and places the fields on the
                real signature lines. onFieldsDetected re-fetches so the overlay shows them. */}
            <AiInsightsPanel documentId={document.id} onFieldsDetected={fetchDocument} />

            <SignersForm
              signers={editableSigners}
              onSignersChange={setEditableSigners}
              signingOrder={signingOrder}
              onSigningOrderChange={setSigningOrder}
              title="Signers"
              description="Add or edit signers for this document"
            />

            <Button
              onClick={handleSaveSigners}
              disabled={saving}
              className="w-full"
            >
              <Save className="w-4 h-4 mr-2" />
              {saving ? "Saving..." : "Save & Send Invites"}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}