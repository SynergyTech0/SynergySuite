"use client";

import PdfViewer from "@/components/pdf/PdfViewer";

interface DocumentViewerProps {
  location: string;
  provider?: string;   // reserved for future use
  documentId?: string;
}

export default function DocumentViewer({ location, provider, documentId }: DocumentViewerProps) {
  // Derive ID fallback from URL if documentId isn't provided
  const docId =
    documentId ||
    (location ? location.split("/").pop() || "unknown" : "unknown");

  return <PdfViewer url={location} documentId={docId} />;
}
