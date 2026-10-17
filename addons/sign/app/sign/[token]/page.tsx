"use client";

import { useEffect, useState, useCallback, Component, ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import PdfFieldOverlay from "@/components/documents/PdfFieldOverlay";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle, AlertCircle } from "lucide-react";

// Error Boundary Component
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error("Error boundary caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen bg-gray-50 p-4">
          <AlertCircle className="h-16 w-16 text-red-500 mb-4" />
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">
            Something Went Wrong
          </h1>
          <p className="text-gray-600 text-center max-w-md mb-4">
            {this.state.error?.message || "An unexpected error occurred"}
          </p>
          <Button onClick={() => window.location.reload()}>Reload Page</Button>
        </div>
      );
    }

    return this.props.children;
  }
}

interface Signer {
  id: string;
  name: string;
  email: string;
  status: string;
  document?: {
    id: string;
    title: string;
    cloudStoragePath: string;
  };
  allSigners?: SimpleSigner[];
}

interface SimpleSigner {
  id: string;
  name: string;
  email: string;
  status: string;
}

interface Field {
  id: string;
  fieldType: string;
  assignedToId: string | null;
  value: string | null;
  required: boolean;
}

function SignPageContent() {
  const params = useParams();
  const router = useRouter();

  // Handle token - it might be an array in some cases
  const tokenParam = params?.token;
  const token = Array.isArray(tokenParam) ? tokenParam[0] : tokenParam;

  const [loading, setLoading] = useState(true);
  const [signer, setSigner] = useState<Signer | null>(null);
  const [allSigners, setAllSigners] = useState<SimpleSigner[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string>("");

  // Fetch secure PDF URL
  const fetchSecureUrl = useCallback(async () => {
    if (!token) return;

    try {
      const res = await fetch(`/api/signers/secure-url?token=${token}`);
      if (!res.ok) {
        console.error("Failed to fetch secure URL");
        return;
      }
      const data = await res.json();
      setPdfUrl(data.url);
    } catch (err) {
      console.error("Error fetching secure URL:", err);
    }
  }, [token]);

  // Fetch signer info using the secure access route
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    const fetchSigner = async () => {
      // Guard against missing token
      if (!token) {
        setError("No token provided");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const res = await fetch(`/api/signers/access?token=${token}`);

        if (!res.ok) {
          const errorData = await res
            .json()
            .catch(() => ({ error: "Invalid response" }));

          // Handle specific error codes
          if (errorData.code === "TOKEN_EXPIRED") {
            throw new Error(
              "This invitation link has expired. Please contact the document sender for a new link.",
            );
          } else if (errorData.code === "INVALID_TOKEN") {
            throw new Error(
              "This invitation link is invalid. Please check your link or contact the document sender.",
            );
          } else if (errorData.code === "DOCUMENT_DECLINED") {
            throw new Error("You have already declined to sign this document.");
          } else if (errorData.code === "DOCUMENT_EXPIRED") {
            throw new Error("This document has passed its signing deadline.");
          } else if (errorData.code === "SEQUENTIAL_ORDER_NOT_MET") {
            throw new Error(
              errorData.message ||
                "Please wait for the previous signer to complete.",
            );
          }

          throw new Error(
            errorData.message || errorData.error || "Invalid or expired link",
          );
        }

        const data = await res.json();

        // Validate response data
        if (!data || !data.signer || !data.document) {
          throw new Error("Invalid response from server");
        }

        // Map the response to expected format
        const signerData = {
          id: data.signer.id,
          name: data.signer.name,
          email: data.signer.email,
          status: data.signer.status,
          document: {
            id: data.document.id,
            title: data.document.title,
            cloudStoragePath: "", // Removed for security - use secure-url endpoint instead
          },
        };

        setSigner(signerData);

        // Set all signers if available
        if (data.allSigners && Array.isArray(data.allSigners)) {
          setAllSigners(data.allSigners);
        }

        // Check if already signed
        if (data.signer.status === "COMPLETED") {
          setCompleted(true);
        }

        // Fetch secure URL after signer data is loaded
        await fetchSecureUrl();

        // Refresh URL every 3 minutes (2 min buffer before 5 min expiry)
        interval = setInterval(fetchSecureUrl, 3 * 60 * 1000);
      } catch (err: any) {
        console.error("Error fetching signer:", err);
        setError(err.message || "Failed to load signing information");
      } finally {
        setLoading(false);
      }
    };
    fetchSigner();

    // Cleanup interval on unmount
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [token, fetchSecureUrl]);

  // Load fields for completion tracking
  const loadFields = useCallback(async () => {
    if (!signer?.document?.id) return;

    try {
      const res = await fetch(`/api/signers/fields?token=${encodeURIComponent(String(token))}`);
      if (!res.ok) {
        console.error("Failed to load fields: HTTP", res.status);
        return;
      }
      const data = await res.json();
      const loadedFields = Array.isArray(data.fields) ? data.fields : [];

      // Debug logging
      console.log(`[Sign Page] Signer ID: ${signer.id}`);
      console.log(`[Sign Page] Document ID: ${signer.document.id}`);
      console.log(`[Sign Page] Loaded ${loadedFields.length} fields:`, loadedFields.map((f: any) => ({
        id: f.id,
        fieldType: f.fieldType,
        assignedToId: f.assignedToId
      })));

      const matchingFields = loadedFields.filter((f: any) => f.assignedToId === signer.id);
      console.log(`[Sign Page] Fields assigned to this signer (${signer.id}): ${matchingFields.length}`);

      if (loadedFields.length > 0 && matchingFields.length === 0) {
        console.warn(`[Sign Page] WARNING: No fields match signer ID ${signer.id}`);
        console.warn(`[Sign Page] Field assignedToIds:`, loadedFields.map((f: any) => f.assignedToId));
      }

      setFields(loadedFields);
    } catch (e) {
      console.error("Failed to load fields:", e);
      setFields([]); // Set empty array on error to prevent crashes
    }
  }, [signer?.document?.id, signer?.id]);

  useEffect(() => {
    loadFields();
  }, [loadFields]);

  // Check if all required fields for this signer are complete
  const myFields = fields.filter((f) => f.assignedToId === signer?.id);
  const completedFields = myFields.filter((f) => f.value);
  const requiredFields = myFields.filter((f) => f.required);
  const allRequiredComplete = requiredFields.every((f) => f.value);

  // Submit signing
  const handleSubmit = async () => {
    if (!allRequiredComplete) {
      alert("Please complete all required fields before submitting.");
      return;
    }

    try {
      setSubmitting(true);

      // Mark signer as complete
      const res = await fetch("/api/signers/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (!res.ok) {
        const error = await res.json();

        // Handle already signed error
        if (error.code === "ALREADY_SIGNED") {
          setCompleted(true);
          return;
        }

        throw new Error(error.error || "Failed to submit signature");
      }

      setCompleted(true);
      // Reload fields to show all completed fields
      await loadFields();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-50 p-4">
        <AlertCircle className="h-16 w-16 text-red-500 mb-4" />
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">
          Unable to Load Document
        </h1>
        <p className="text-gray-600 text-center max-w-md">{error}</p>
      </div>
    );
  }

  // No signer found
  if (!signer || !signer.document) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-50 p-4">
        <AlertCircle className="h-16 w-16 text-yellow-500 mb-4" />
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">
          Document Not Found
        </h1>
        <p className="text-gray-600">
          This signing link may be invalid or expired.
        </p>
      </div>
    );
  }

  // Wait for secure URL to be fetched
  if (!pdfUrl) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4">
          {completed ? (
            // Completed header
            <div className="flex items-center justify-center gap-3">
              <CheckCircle className="h-6 w-6 text-green-500" />
              <div className="text-center">
                <h1 className="text-xl font-semibold text-gray-900">
                  Thank You for Signing!
                </h1>
                <p className="text-sm text-gray-600">
                  You have successfully signed{" "}
                  <strong>{signer.document.title}</strong>
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-xl font-semibold text-gray-900">
                    Sign Document
                  </h1>
                  <p className="text-sm text-gray-600">
                    Hello, {signer.name}! Please sign:{" "}
                    <strong>{signer.document.title}</strong>
                  </p>
                </div>

                {/* Progress */}
                <div className="flex items-center gap-4">
                  <div className="text-sm text-gray-600">
                    {completedFields.length}/{myFields.length} fields completed
                  </div>

                  <Button
                    onClick={handleSubmit}
                    disabled={submitting || !allRequiredComplete}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Submitting...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Submit Signature
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* Progress bar */}
              <div className="mt-3 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 transition-all duration-300"
                  style={{
                    width: `${myFields.length > 0 ? (completedFields.length / myFields.length) * 100 : 0}%`,
                  }}
                />
              </div>
            </>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {myFields.length === 0 ? (
          <div className="text-center py-12">
            <AlertCircle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              No Fields Assigned
            </h2>
            <p className="text-gray-600">
              There are no fields assigned to you in this document. Please
              contact the sender.
            </p>
            {/* Debug info - remove after fixing */}
            <div className="mt-6 p-4 bg-gray-100 rounded text-left text-xs max-w-md mx-auto">
              <p><strong>Debug Info:</strong></p>
              <p>Signer ID: {signer?.id || 'N/A'}</p>
              <p>Document ID: {signer?.document?.id || 'N/A'}</p>
              <p>Total fields loaded: {fields.length}</p>
              <p>Fields matching signer: {myFields.length}</p>
              {fields.length > 0 && (
                <p>Field assignedToIds: {fields.map(f => f.assignedToId || 'null').join(', ')}</p>
              )}
            </div>
          </div>
        ) : (
          <PdfFieldOverlay
            documentId={signer.document.id}
            pdfUrl={pdfUrl}
            signers={
              allSigners.length > 0
                ? allSigners
                : [
                    {
                      id: signer.id,
                      name: signer.name,
                      email: signer.email,
                      status: signer.status,
                    },
                  ]
            }
            mode={completed ? "view" : "sign"}
            currentSignerId={signer.id}
            signerToken={String(token)}
            onFieldsUpdate={loadFields}
          />
        )}
      </main>

      {/* Footer */}
      {!completed && (
        <footer className="bg-white border-t py-4 mt-8">
          <div className="max-w-7xl mx-auto px-4 text-center text-sm text-gray-500">
            Click on each highlighted field to add your signature, initials, or
            text.
            <br />
            Fields marked with <span className="text-red-500">*</span> are
            required.
          </div>
        </footer>
      )}
    </div>
  );
}

// Wrap with Error Boundary
export default function SignPage() {
  return (
    <ErrorBoundary>
      <SignPageContent />
    </ErrorBoundary>
  );
}
