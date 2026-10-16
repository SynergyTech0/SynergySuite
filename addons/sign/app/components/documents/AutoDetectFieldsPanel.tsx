"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Scan, RefreshCcw } from "lucide-react";

interface AutoDetectFieldsPanelProps {
  documentId: string;
  onRefresh?: () => void; // callback to reload document fields list
}

export default function AutoDetectFieldsPanel({
  documentId,
  onRefresh,
}: AutoDetectFieldsPanelProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [detectedCount, setDetectedCount] = useState<number | null>(null);

  const handleAutoDetect = async () => {
    setLoading(true);
    setSummary(null);
    setDetectedCount(null);

    try {
      const res = await fetch(`/api/documents/${documentId}/fields/auto-detect`, {
        method: "POST",
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Auto-detect failed");
      }

      setSummary(data.summary || "");
      setDetectedCount(data.fieldsDetected || 0);

      toast({
        title: "AI Field Detection Complete",
        description: `Detected ${data.fieldsDetected} fields and generated a summary.`,
      });

      if (onRefresh) onRefresh();
    } catch (error: any) {
      toast({
        title: "Auto-detect failed",
        description: error.message || "Something went wrong.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-4 border border-gray-300 bg-white shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Scan className="h-5 w-5 text-blue-600" />
          AI Field Detection
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-sm text-gray-600">
          Automatically scans the uploaded document using local OCR and AI heuristics to
          identify <b>Signature</b>, <b>Date</b>, and <b>Name</b> fields, and generates a brief summary.
        </p>

        <div className="flex gap-3">
          <Button
            onClick={handleAutoDetect}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Detecting...
              </>
            ) : (
              <>
                <RefreshCcw className="h-4 w-4 mr-2" /> Run Auto-Detect
              </>
            )}
          </Button>

          {detectedCount !== null && (
            <span className="text-gray-700 text-sm mt-2">
              {detectedCount} fields detected
            </span>
          )}
        </div>

        {summary && (
          <div className="mt-4 p-3 bg-gray-50 rounded border border-gray-200">
            <h4 className="font-semibold text-gray-800 text-sm mb-1">Document Summary:</h4>
            <p className="text-gray-700 text-sm whitespace-pre-wrap leading-snug">
              {summary}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
