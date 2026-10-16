'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';

// ✅ Set the worker source explicitly (required for Next.js)
if (typeof window !== 'undefined' && 'Worker' in window) {
  // @ts-ignore - pdfjsLib types don’t always include this property
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();
}

interface Field {
  id: string;
  fieldType: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pageNumber: number;
  assignedTo: string;
}

interface PdfFieldOverlayProps {
  documentId: string;
  pdfUrl: string;
  signers: Array<{ id: string; name: string; email: string }>;
}

export default function PdfFieldOverlay({
  documentId,
  pdfUrl,
  signers,
}: PdfFieldOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [scale, setScale] = useState(1.2);

  // ✅ Load and render PDF
  useEffect(() => {
    const loadPDF = async () => {
      try {
        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale });

        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext('2d');
        if (!context) return;

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
          canvasContext: context,
          viewport,
          canvas: canvasRef.current, // ✅ fixed key
        };
        await page.render(renderContext as any).promise;
      } catch (err) {
        console.error('Error rendering PDF:', err);
      } finally {
        setPdfLoading(false);
      }
    };

    loadPDF();
  }, [pdfUrl, scale]);

  // ✅ Load detected fields
  useEffect(() => {
    const fetchFields = async () => {
      try {
        const res = await fetch(`/api/documents/${documentId}/fields`);
        const data = await res.json();
        setFields(data.fields || []);
      } catch (err) {
        console.error('Error loading fields:', err);
      }
    };
    fetchFields();
  }, [documentId]);

  // ✅ Assign signer
  const handleAssignSigner = async (fieldId: string, signerId: string) => {
    try {
      await fetch(`/api/documents/${documentId}/fields/${fieldId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedTo: signerId }),
      });
      setFields((prev) =>
        prev.map((f) =>
          f.id === fieldId ? { ...f, assignedTo: signerId } : f
        )
      );
    } catch (err) {
      console.error('Error updating field assignment:', err);
    }
  };

  return (
    <div className="w-full flex flex-col gap-4">
      {/* PDF Canvas */}
      <div className="relative border rounded-md overflow-hidden bg-gray-50">
        {pdfLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 z-10">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
          </div>
        )}

        <canvas ref={canvasRef} className="w-full" />

        {/* ✅ Render Field Boxes */}
        {fields.map((field) => (
          <div
            key={field.id}
            className={`absolute border-2 rounded cursor-pointer transition-all ${
              selectedField === field.id
                ? 'border-blue-600'
                : 'border-green-500'
            }`}
            style={{
              top: `${field.y * scale}px`,
              left: `${field.x * scale}px`,
              width: `${field.width * scale}px`,
              height: `${field.height * scale}px`,
            }}
            onClick={() => setSelectedField(field.id)}
          >
            <div className="absolute top-0 left-0 bg-green-500 text-white text-[10px] px-1 rounded-br">
              {field.fieldType}
            </div>
          </div>
        ))}
      </div>

      {/* ✅ Signer Assignment UI */}
      {selectedField && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-700">Assign signer:</span>
          <Select
            onValueChange={(v) => handleAssignSigner(selectedField, v)}
            defaultValue={
              fields.find((f) => f.id === selectedField)?.assignedTo || ''
            }
          >
            <SelectTrigger className="w-60">
              <SelectValue placeholder="Choose signer..." />
            </SelectTrigger>
            <SelectContent>
              {signers.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name || s.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* ✅ Zoom Controls */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setScale((s) => Math.max(0.5, s - 0.1))}
        >
          -
        </Button>
        <span className="text-sm text-gray-600">
          Zoom {Math.round(scale * 100)}%
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setScale((s) => s + 0.1)}
        >
          +
        </Button>
      </div>
    </div>
  );
}
