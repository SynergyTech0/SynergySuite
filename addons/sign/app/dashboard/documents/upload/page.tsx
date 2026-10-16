"use client";

import dynamic from "next/dynamic";
import { useState, useRef, useEffect } from "react";
import { useSession } from "@/lib/session-client";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import SignersForm from "@/components/documents/SignersForm";
import type { Signer } from "@/lib/types";

import {
  Upload,
  FileText,
  X,
  Plus,
  ArrowLeft,
  Loader2,
  RefreshCw,
} from "lucide-react";

import { NotificationType } from "@prisma/client";
import { useToast } from "@/hooks/use-toast";
import PdfFieldOverlay from "@/components/documents/PdfFieldOverlay";
import FieldPalette from "@/components/documents/FieldPalette";

export default function UploadDocumentPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const { toast } = useToast();

  const [uploading, setUploading] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [sending, setSending] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [signers, setSigners] = useState<Signer[]>([{ email: "", name: "" }]);
  const [signingOrder, setSigningOrder] = useState<"PARALLEL" | "SEQUENTIAL">("PARALLEL");

  const [documents, setDocuments] = useState<any[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<any>(null);

  const [documentData, setDocumentData] = useState<any>(null);
  const [selectedSignerId, setSelectedSignerId] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string>("");

  const topRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load documents
  useEffect(() => {
    fetch("/api/documents")
      .then((res) => res.json())
      .then((data) => setDocuments(data.documents || []))
      .catch(console.error);
  }, []);

  // Fetch secure URL when document changes
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    const fetchSecureUrl = async () => {
      if (!documentData?.id) {
        setPdfUrl("");
        return;
      }

      try {
        const res = await fetch(`/api/documents/${documentData.id}/secure-url`, {
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

    // Clear any existing interval before creating a new one

    fetchSecureUrl();

    // Refresh URL every 4 minutes (before 5 min expiry)
    interval = setInterval(fetchSecureUrl, 4 * 60 * 1000);

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [documentData?.id]);

  // ==========================
  // File change
  // ==========================
  const handleFileChange = (e: any) => {
    if (e.target.files?.[0]) {
      const selected = e.target.files[0];
      setFile(selected);
      if (!title || file?.name.replace(/\.[^/.]+$/, "") === title) setTitle(selected.name.replace(/\.[^/.]+$/, ""));
    }
  };

  const handleSignersChange = (newSigners: Signer[]) => {
    setSigners(newSigners);
  };

  // ==========================
  // Upload handler
  // ==========================
  const handleSubmit = async (e: any) => {
    e.preventDefault();

    if (!file) {
      toast({ title: "No file selected" });
      return;
    }

    if (signers.some((s) => !s.email)) {
      toast({
        title: "Missing signer emails",
        description: "Every signer must have an email.",
      });
      return;
    }

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", title);
      formData.append("description", description);
      formData.append("signers", JSON.stringify(signers));
      formData.append("signingOrder", signingOrder);

      const res = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSelectedDoc(data.document);
      setDocumentData(data.document);
      setDocuments(prev => [data.document, ...prev]); // Add newly uploaded document to list

      toast({ title: "Upload successful" });

      // Scroll down
      setTimeout(
        () => topRef.current?.scrollIntoView({ behavior: "smooth" }),
        300
      );

      // Place the signing fields with the AI model straight away (the upload itself only stores the file).
      detectFields(data.document.id);
    } catch (err) {
      toast({ title: "Upload failed", description: String(err) });
    } finally {
      setUploading(false);
    }
  };

  // ==========================
  // AI field placement
  // ==========================
  // The model reads the rendered pages and places each signature / date / name / checkbox field on
  // the line or box it belongs to; the server snaps it to the real geometry. Fields a person already
  // placed are kept. Replaces the old GPU OCR call, whose server no longer exists.
  const detectFields = async (docId: string) => {
    setOcrRunning(true);
    toast({ title: "Placing fields with AI…", description: "Reading the document. This takes 10–30 seconds." });
    try {
      const res = await fetch(`/api/documents/${docId}/fields`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.hint || data.error || `HTTP ${res.status}`);

      const fieldRes = await fetch(`/api/documents/${docId}/fields`);
      const fieldData = await fieldRes.json();
      setDocumentData((prev: any) => (prev && prev.id === docId ? { ...prev, fields: fieldData.fields || [] } : prev));

      const placed = data.createdFields?.length ?? 0;
      toast({
        title: placed ? `Placed ${placed} field${placed === 1 ? "" : "s"}` : "No signing fields found",
        description: placed
          ? "Check them on the page; drag any field to adjust it."
          : "This document has no obvious place to sign. Add fields from the palette.",
      });
      const hidden = data.analysis?.hiddenText;
      if (hidden?.chars > 0) {
        // The PDF hides text from its reader. It was kept away from the AI; the sender must know.
        toast({
          title: hidden.ocrLayerOnly ? "Invisible OCR text over a scan" : "This PDF contains hidden text",
          description: hidden.ocrLayerOnly
            ? `${hidden.chars} characters of invisible text sit over a scanned image. The AI read the page images instead.`
            : `${hidden.chars} characters of text a reader cannot see were found. AI suggestions were made without it. Review the document before sending.`,
          variant: hidden.ocrLayerOnly ? undefined : "destructive",
        });
      }
      if (data.unmatchedParties?.length) {
        toast({
          title: "Some signers could not be matched",
          description: `Assign fields for: ${data.unmatchedParties.map((p: any) => p.role).join(", ")}`,
        });
      }
    } catch (err) {
      toast({ title: "AI field placement failed", description: `${String(err)}. You can still place fields by hand.`, variant: "destructive" });
    } finally {
      setOcrRunning(false);
    }
  };

  // ==========================
  // Save Draft
  // ==========================
  const handleSaveDraft = async () => {
    if (!selectedDoc) return;

    try {
      // 1. Save document metadata (title, summary, etc.)
      await fetch(`/api/documents/${selectedDoc.id}/save`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: selectedDoc.title,
          description,
          aiSummary: documentData.aiSummary,
          signers,           // save signers for later
          signingOrder       // save signing order too
        }),
      });

      // 2. Save all existing field assignments (including temp-X)
      const fieldsRes = await fetch(`/api/documents/${selectedDoc.id}/fields`);
      const fieldsData = await fieldsRes.json();

      for (const field of fieldsData.fields || []) {
        // Save field assignment + position + size without converting signer IDs
        await fetch(`/api/documents/${selectedDoc.id}/fields/${field.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assignedToId: field.assignedToId || null,
            x: field.x,
            y: field.y,
            width: field.width,
            height: field.height,
            value: field.value || null
          }),
        });
      }

      toast({
        title: "Draft Saved",
        description: "Your document has been saved. You can return later to continue editing.",
      });

    } catch (err) {
      toast({
        title: "Save Failed",
        description: String(err),
        variant: "destructive",
      });
    }
  };

  // ==========================
  // Save + send invites
  // ==========================
  const handleSave = async () => {
    if (!documentData) {
      toast({
        title: "No document selected",
        description: "Please select or upload a document first.",
        variant: "destructive",
      });
      return;
    }

    if (sending) return; // Prevent double-clicks

    setSending(true);

    try {
      // Validate field assignments before sending invites
      const fieldsRes = await fetch(`/api/documents/${documentData.id}/fields`);
      const fieldsData = await fieldsRes.json();
      const fields = fieldsData.fields || [];

      const unassignedFields = fields.filter((f: any) => !f.assignedToId);
      const tempAssignedFields = fields.filter((f: any) =>
        f.assignedToId && f.assignedToId.startsWith("temp-")
      );

      if (unassignedFields.length > 0) {
        toast({
          title: "Unassigned fields detected",
          description: `${unassignedFields.length} field(s) are not assigned to any signer. Please assign all fields before sending.`,
          variant: "destructive",
        });
        return;
      }

      // Validate temp IDs match signers array
      if (tempAssignedFields.length > 0) {
        const invalidTempFields = tempAssignedFields.filter((f: any) => {
          const tempIndex = parseInt(f.assignedToId.replace("temp-", ""));
          return !signers[tempIndex]?.email;
        });

        if (invalidTempFields.length > 0) {
          toast({
            title: "Invalid field assignments",
            description: `${invalidTempFields.length} field(s) are assigned to signers that no longer exist. Please reassign these fields.`,
            variant: "destructive",
          });
          return;
        }
      }

      // Save summary and fields locally
      await fetch(`/api/documents/${documentData.id}/save`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: documentData.title,
          aiSummary: documentData.aiSummary,
        }),
      });

      // Send signer invites
      const emailRes = await fetch("/api/signers/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: documentData.id,
          signers,
          signingOrder,
        }),
      });

      if (emailRes.ok) {
        const { signers: createdSigners } = await emailRes.json();

        // Update field assignments from temp IDs to real signer IDs
        if (createdSigners && createdSigners.length > 0) {
          const fieldsRes = await fetch(`/api/documents/${documentData.id}/fields`);
          const fieldsData = await fieldsRes.json();
          const fields = fieldsData.fields || [];

          console.log(`[Field Remapping] Starting remapping for ${fields.length} fields`);
          console.log(`[Field Remapping] Created signers:`, createdSigners);

          let remappedCount = 0;
          let failedCount = 0;
          const remappingErrors: string[] = [];

          // Map temp-X IDs to real signer IDs based on email
          for (const field of fields) {
            if (field.assignedToId && field.assignedToId.startsWith("temp-")) {
              const tempIndex = parseInt(field.assignedToId.replace("temp-", ""));
              const signerEmail = signers[tempIndex]?.email;

              console.log(`[Field Remapping] Field ${field.id}: temp-${tempIndex} → signerEmail: ${signerEmail}`);

              if (signerEmail) {
                // Case-insensitive email matching
                const matchingSigner = createdSigners.find(
                  (s: any) => s.email.toLowerCase() === signerEmail.toLowerCase()
                );

                if (matchingSigner) {
                  console.log(`[Field Remapping] Found matching signer: ${matchingSigner.id} (${matchingSigner.email})`);

                  const patchRes = await fetch(`/api/documents/${documentData.id}/fields/${field.id}`, {
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
                      const errorMsg = `Field ${field.id}: Update failed - assignedToId is ${patchData.field?.assignedToId} instead of ${matchingSigner.id}`;
                      remappingErrors.push(errorMsg);
                      console.error(`[Field Remapping] ✗ ${errorMsg}`);
                    }
                  } else {
                    failedCount++;
                    const errorText = await patchRes.text();
                    const errorMsg = `Field ${field.id} (${field.label || field.fieldType}): ${errorText}`;
                    remappingErrors.push(errorMsg);
                    console.error(`[Field Remapping] ✗ Failed to remap field ${field.id}:`, errorText);
                  }
                } else {
                  failedCount++;
                  const errorMsg = `Field ${field.id}: No signer found for email ${signerEmail}`;
                  remappingErrors.push(errorMsg);
                  console.error(`[Field Remapping] ✗ ${errorMsg}`);
                }
              } else {
                failedCount++;
                const errorMsg = `Field ${field.id}: Invalid temp index ${tempIndex}`;
                remappingErrors.push(errorMsg);
                console.error(`[Field Remapping] ✗ ${errorMsg}`);
              }
            }
          }

          console.log(`[Field Remapping] Complete: ${remappedCount} remapped, ${failedCount} failed`);

          if (failedCount > 0) {
            toast({
              title: "Warning: Field Assignment Issues",
              description: `Invites sent, but ${failedCount} field(s) could not be assigned. Check console for details.`,
              variant: "destructive",
            });
          } else if (remappedCount > 0) {
            toast({
              title: "Invites sent successfully",
              description: `${remappedCount} field(s) assigned to signers.`
            });
          } else {
            toast({ title: "Invites sent" });
          }
        } else {
          toast({ title: "Invites sent" });
        }

        await fetch("/api/notify/notifications/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: session?.user?.email,
            subject: "Document Created",
            message: `Your document "${documentData.title}" has been created and invitations sent.`,
            type: NotificationType.DOCUMENT_SENT,
            documentId: documentData.id,
          }),
        });

        setSending(false);
        router.replace("/dashboard/documents");
      } else {
        toast({ title: "Save OK", description: "Invite failed." });
        setSending(false);
      }
    } catch (err) {
      toast({ title: "Save failed", description: String(err) });
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden">
      <div ref={topRef} />

      {/* HEADER */}
      <div className="flex items-center p-2 border-b bg-gray-50">
        <Link href="/dashboard">
          <Button variant="outline" size="sm">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
        </Link>

        <div className="ml-4">
          <h1 className="text-xl font-bold">Documents</h1>
          <p className="text-sm text-gray-600">Upload & prepare documents</p>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        {!documentData && (
          <aside className="w-20 md:w-64 border-r bg-white overflow-y-auto">
            <div className="p-4 border-b flex justify-between items-center">
              <h2 className="font-semibold">Documents</h2>

              <Button
                size="sm"
                onClick={() => {
                  setFile(null);
                  setDocumentData(null);
                  setSelectedDoc(null);
                  setTitle("");
                  setDescription("");
                  setSigners([{ email: "", name: "" }]);
                  setSigningOrder("PARALLEL");
                }}
              >
                <Upload className="w-4 h-4 mr-1" /> New
              </Button>          </div>

            {documents.map((doc) => (
              <div
                key={doc.id}
                onClick={() => {
                  setSelectedDoc(doc);
                  setDocumentData(doc);
                  // Load signers from the document when opening a draft
                  if (doc.signers && doc.signers.length > 0) {
                    setSigners(
                      doc.signers.map((s: any) => ({
                        email: s.email || "",
                        name: s.name || "",
                      }))
                    );
                  } else {
                    setSigners([{ email: "", name: "" }]);
                  }
                  // Load signing order from document
                  if (doc.signingOrder) {
                    setSigningOrder(doc.signingOrder as "PARALLEL" | "SEQUENTIAL");
                  }
                }}
                className={`p-3 cursor-pointer border-b ${
                  selectedDoc?.id === doc.id ? "bg-gray-100" : "hover:bg-gray-50"
                }`}
              >
                <p className="font-medium truncate">{doc.title}</p>
                <p className="text-xs text-gray-500">{doc.fileType}</p>
              </div>
            ))}
          </aside>
        )}

        {/* Main Panel */}
        <main className="flex-1 overflow-y-auto p-4">
          {/* Upload Form */}
          {!documentData && (
            <form
              onSubmit={handleSubmit}
              className="space-y-6 max-w-3xl mx-auto"
            >
              {/* Upload Card */}
              <Card>
                <CardHeader>
                  <CardTitle>Upload Document</CardTitle>
                  <CardDescription>PDF only</CardDescription>
                </CardHeader>

                <div className="p-4">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    id="file-upload"
                    onChange={handleFileChange}
                  />

                  <label
                    htmlFor="file-upload"
                    className="block border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-gray-400 transition-colors"
                  >
                    {!file ? (
                      <>
                        <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                        <p>Click to upload or drag & drop</p>
                      </>
                    ) : (
                      <div className="flex items-center justify-center gap-3">
                        <FileText className="w-8 h-8 text-blue-600" />
                        <p>{file.name}</p>

                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {setFile(null); setTitle("");}}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </label>
                </div>
              </Card>

              {/* Document Info */}
              <Card>
                <CardHeader>
                  <CardTitle>Document Details</CardTitle>
                </CardHeader>

                <div className="p-4 space-y-4">
                  <Label>Title *</Label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />

                  <Label>Description</Label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </Card>

              {/* Signers */}
              <SignersForm
                signers={signers}
                onSignersChange={handleSignersChange}
                signingOrder={signingOrder}
                onSigningOrderChange={setSigningOrder}
              />

              <Button type="submit" disabled={uploading}>
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />{" "}
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" /> Upload
                  </>
                )}
              </Button>
            </form>
          )}

          {/* Document + Field Editor */}
          {documentData && (
            <div className="flex gap-2">
              {/* Left: Field Palette */}
              <div>
                <FieldPalette
                  signers={signers
                    .filter((s) => s.email)
                    .map((s, idx) => ({
                      id: `temp-${idx}`,
                      email: s.email,
                      name: s.name || s.email,
                    }))}
                  selectedSignerId={selectedSignerId}
                  onSignerChange={setSelectedSignerId}
                />
              </div>

              {/* Center: PDF Viewer with Field Overlay */}
              <div className="flex-1">
                <PdfFieldOverlay
                  documentId={documentData.id}
                  pdfUrl={`/api/files/${documentData.cloudStoragePath.replace(/^\/?/, "")}`}
                  signers={signers
                    .filter((s) => s.email)
                    .map((s, idx) => ({
                      id: `temp-${idx}`,
                      email: s.email,
                      name: s.name || s.email,
                    }))
                  }
                  mode="edit"
                  onFieldsUpdate={() => {
                    fetch(`/api/documents/${documentData.id}/fields`)
                      .then((res) => res.json())
                      .then((data) =>
                        setDocumentData((prev: any) => ({
                          ...prev,
                          fields: data.fields || [],
                        }))
                      );
                  }}
                />

              </div>

              {/* Right Panel */}
              <div className="w-80 flex flex-col gap-2">
                {/* Summary */}
                <Card>
                  <CardHeader>
                    <CardTitle>Document Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      rows={6}
                      value={documentData.aiSummary || ""}
                      onChange={(e) =>
                        setDocumentData({
                          ...documentData,
                          aiSummary: e.target.value,
                        })
                      }
                      className="border p-2 rounded w-full"
                    />
                  </CardContent>
                </Card>

                {/* Signers */}
                <SignersForm
                  signers={signers}
                  onSignersChange={handleSignersChange}
                  signingOrder={signingOrder}
                  onSigningOrderChange={setSigningOrder}
                />

                {/* Fields Summary */}
                <Card>
                  <CardHeader>
                    <CardTitle>Fields</CardTitle>
                    <CardDescription>
                      {documentData.fields?.length || 0} fields added
                    </CardDescription>
                  </CardHeader>

                  <div className="p-4">
                    <p className="text-sm text-gray-600">
                      Drag field types from the left palette onto the document to add fields.
                      Click fields to assign them to signers.
                    </p>
                  </div>
                </Card>

                <Button
                  onClick={handleSaveDraft}
                  className="bg-blue-600 text-white"
                >
                  Save for later
                </Button>

                <Button
                  onClick={handleSave}
                  disabled={sending}
                  className="bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {sending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Sending Invites...
                    </>
                  ) : (
                    "Save + Send Invites"
                  )}
                </Button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
