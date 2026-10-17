'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Loader2, Pen, Calendar, Type, Check, User, ChevronDown, X } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';

// PDF.js worker configuration
if (typeof window !== 'undefined' && 'Worker' in window) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
}

// Field model for overlays
interface Field {
  id: string;
  fieldType: 'SIGNATURE' | 'INITIALS' | 'TEXT' | 'DATE' | 'CHECKBOX' | 'DROPDOWN';
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pageNumber: number;
  assignedToId: string | null;
  value: string | null;
  required: boolean;
}

// DocumentField type for initial props
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

interface Signer {
  id: string;
  name: string;
  email: string;
}

interface PdfFieldOverlayProps {
  documentId: string;
  pdfUrl: string;
  signers: Signer[];
  mode?: 'edit' | 'sign' | 'view';
  currentSignerId?: string;
  onFieldsUpdate?: () => void;
  fields?: DocumentField[];
  isTemplate?: boolean; // If true, use template API endpoints
  /** A signer's link token: fields are read and filled through the signer routes, without sign-in. */
  signerToken?: string;
}

// Field type colors
const FIELD_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  SIGNATURE: { bg: 'bg-blue-100/80', border: 'border-blue-500', text: 'text-blue-700' },
  INITIALS: { bg: 'bg-purple-100/80', border: 'border-purple-500', text: 'text-purple-700' },
  DATE: { bg: 'bg-green-100/80', border: 'border-green-500', text: 'text-green-700' },
  TEXT: { bg: 'bg-yellow-100/80', border: 'border-yellow-500', text: 'text-yellow-700' },
  CHECKBOX: { bg: 'bg-orange-100/80', border: 'border-orange-500', text: 'text-orange-700' },
  DROPDOWN: { bg: 'bg-pink-100/80', border: 'border-pink-500', text: 'text-pink-700' },
};

// Field type icons
const FIELD_ICONS: Record<string, React.ReactNode> = {
  SIGNATURE: <Pen className="h-3 w-3" />,
  INITIALS: <User className="h-3 w-3" />,
  DATE: <Calendar className="h-3 w-3" />,
  TEXT: <Type className="h-3 w-3" />,
  CHECKBOX: <Check className="h-3 w-3" />,
};

export default function PdfFieldOverlay({
  documentId,
  pdfUrl,
  signers = [],
  mode = 'edit',
  currentSignerId,
  onFieldsUpdate,
  fields: initialFields,
  isTemplate = false,
  signerToken,
}: PdfFieldOverlayProps) {
  // Defensive checks for required props
  if (!documentId) {
    console.error('PdfFieldOverlay: documentId is required');
    return (
      <div className="p-8 text-center text-red-600">
        Error: Document ID is missing
      </div>
    );
  }

  if (!pdfUrl) {
    console.error('PdfFieldOverlay: pdfUrl is required');
    return (
      <div className="p-8 text-center text-red-600">
        Error: PDF URL is missing
      </div>
    );
  }

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [fields, setFields] = useState<Field[]>([]);
  const [selectedField, setSelectedField] = useState<Field | null>(null);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [scale, setScale] = useState(1);
  const [pdfSize, setPdfSize] = useState({ width: 0, height: 0 });
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const renderTaskRef = useRef<any>(null);

  // Signing modal state
  const [showSigningModal, setShowSigningModal] = useState(false);
  const [signingField, setSigningField] = useState<Field | null>(null);
  const [inputValue, setInputValue] = useState('');

  // Signature pad state
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Drag-and-drop state
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [draggedFieldId, setDraggedFieldId] = useState<string | null>(null);
  const [dragStartPos, setDragStartPos] = useState<{ x: number; y: number } | null>(null);
  const [resizingField, setResizingField] = useState<string | null>(null);
  const [resizeStartPos, setResizeStartPos] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  // Quick signer assignment dropdown
  const [showQuickAssign, setShowQuickAssign] = useState<string | null>(null);

  const [pageInput, setPageInput] = useState("");

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      if (showQuickAssign) {
        setShowQuickAssign(null);
      }
    };

    if (showQuickAssign) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showQuickAssign]);

  // ======================================================
  // Load PDF Document
  // ======================================================
  useEffect(() => {
    const loadPDF = async () => {
      try {
        setPdfLoading(true);
        const task = pdfjsLib.getDocument(pdfUrl);
        const pdf = await task.promise;
        setPdfDoc(pdf);
        setTotalPages(pdf.numPages);
        await renderPage(pdf, currentPage);
      } catch (err) {
        console.error('PDF load error:', err);
      } finally {
        setPdfLoading(false);
      }
    };

    loadPDF();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfUrl]);

  // Re-render on page or scale change
  useEffect(() => {
    if (pdfDoc) {
      renderPage(pdfDoc, currentPage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, scale, pdfDoc]);

  const renderPage = async (pdf: any, pageNum: number) => {
    try {
      // Cancel any previous render task
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }

      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale });

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      setPdfSize({
        width: viewport.width,
        height: viewport.height,
      });

      // Store the render task so we can cancel it later if needed
      const renderTask = page.render({
        canvasContext: ctx,
        viewport,
      });
      renderTaskRef.current = renderTask;

      await renderTask.promise;
      renderTaskRef.current = null;
    } catch (err) {
      // Ignore cancellation errors
      if (err instanceof Error && err.message.includes('cancel')) {
        return;
      }
      console.error('Page render error:', err);
    }
  };

  // ======================================================
  // Load Fields from API
  // ======================================================
  const loadFields = useCallback(async (forceRefetch = false) => {
    // If initial fields are provided and not forcing refetch, use them
    if (initialFields && !forceRefetch) {
      setFields(initialFields as Field[]);
      return;
    }

    // Otherwise fetch from API
    try {
      const baseUrl = signerToken
        ? `/api/signers/fields?token=${encodeURIComponent(signerToken)}`
        : isTemplate ? `/api/templates/${documentId}/fields` : `/api/documents/${documentId}/fields`;
      const res = await fetch(baseUrl);
      const data = await res.json();
      setFields(data.fields || []);
    } catch (e) {
      console.error('Field load error:', e);
    }
  }, [documentId, initialFields, isTemplate, signerToken]);

  useEffect(() => {
    loadFields();
  }, [loadFields]);

  // ======================================================
  // OCR Trigger
  // ======================================================
  const runOCR = async () => {
    try {
      setOcrLoading(true);

      // Start OCR processing
      const startRes = await fetch(`/api/documents/${documentId}/ocr`, {
        method: 'POST',
      });

      if (!startRes.ok) {
        const error = await startRes.json();
        throw new Error(error.error || 'OCR request failed');
      }

      const startResult = await startRes.json();
      console.log('OCR started:', startResult);

      if (startResult.status === 'processing') {
        // Poll for completion
        let attempts = 0;
        const maxAttempts = 30; // 30 attempts * 2 seconds = 60 seconds max

        while (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds

          const statusRes = await fetch(`/api/documents/${documentId}/ocr`);
          const statusData = await statusRes.json();

          if (statusData.status === 'completed') {
            console.log('OCR complete:', statusData);
            // Refresh fields
            await loadFields();
            onFieldsUpdate?.();
            alert(`OCR complete! Detected ${statusData.fieldsDetected} fields.`);
            return;
          }

          attempts++;
        }

        if (attempts >= maxAttempts) {
          alert('OCR is still processing. This may take longer than expected. Please refresh the page in a moment.');
        }
      }
    } catch (err) {
      console.error('OCR failed:', err);
      alert(`OCR failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setOcrLoading(false);
    }
  };

  // ======================================================
  // Assign Signer
  // ======================================================
  const handleAssignSigner = async (fieldId: string, signerId: string) => {
    try {
      // Save assignment (including temp IDs like temp-0, temp-1) to database
      const baseUrl = isTemplate ? `/api/templates/${documentId}/fields/${fieldId}` : `/api/documents/${documentId}/fields/${fieldId}`;
      const response = await fetch(baseUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedToId: signerId || null }),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('Failed to assign signer:', error);
        alert(`Failed to assign signer: ${error.error || 'Unknown error'}`);
        return;
      }

      // Update local state
      setFields((prev) =>
        prev.map((f) =>
          f.id === fieldId ? { ...f, assignedToId: signerId || null } : f
        )
      );
    } catch (err) {
      console.error('Assign signer error:', err);
      alert(`Error assigning signer: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  // ======================================================
  // Delete Field
  // ======================================================
  const deleteField = useCallback(async (fieldId: string) => {
    try {
      const baseUrl = isTemplate ? `/api/templates/${documentId}/fields/${fieldId}` : `/api/documents/${documentId}/fields/${fieldId}`;
      const response = await fetch(baseUrl, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Failed to delete field:', errorData);
        
        // If field doesn't exist (404), still remove from local state
        if (response.status === 404 || response.status === 500) {
          setFields((prev) => prev.filter((f) => f.id !== fieldId));
          setSelectedField(null);
          onFieldsUpdate?.();
          return;
        }
        
        alert(`Failed to delete field: ${errorData.error || 'Unknown error'}`);
        return;
      }

      setFields((prev) => prev.filter((f) => f.id !== fieldId));
      setSelectedField(null);
      onFieldsUpdate?.();
    } catch (err) {
      console.error('Delete field error:', err);
      alert(`Failed to delete field: ${err instanceof Error ? err.message : 'Network error'}`);
    }
  }, [documentId, onFieldsUpdate, isTemplate]);

  // ======================================================
  // Keyboard Delete Handler
  // ======================================================
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (mode === 'edit' && selectedField && (e.key === 'Delete' || e.key === 'Backspace')) {
        // Prevent default browser back navigation on Backspace
        e.preventDefault();
        deleteField(selectedField.id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, selectedField, deleteField]);

  // ======================================================
  // Field Click Handler
  // ======================================================
  const handleFieldClick = (e: React.MouseEvent, field: Field) => {
    e.stopPropagation();

    // In view mode, clicking does nothing
    if (mode === 'view') {
      return;
    }

    if (mode === 'edit') {
      setSelectedField(field);
    } else if (mode === 'sign') {
      // Only allow signing if field is assigned to current signer
      if (field.assignedToId === currentSignerId && !field.value) {
        setSigningField(field);
        setInputValue('');
        setShowSigningModal(true);

        // Clear signature canvas if it's a signature field
        if (field.fieldType === 'SIGNATURE' || field.fieldType === 'INITIALS') {
          setTimeout(() => {
            const canvas = signatureCanvasRef.current;
            if (canvas) {
              const ctx = canvas.getContext('2d');
              ctx?.clearRect(0, 0, canvas.width, canvas.height);
            }
          }, 100);
        }
      }
    }
  };

  // ======================================================
  // Signature Pad Drawing
  // ======================================================
  const getCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();

    // Handle touch events
    if ('touches' in e) {
      if (e.touches.length > 0) {
        return {
          x: e.touches[0].clientX - rect.left,
          y: e.touches[0].clientY - rect.top,
        };
      }
      return null;
    }

    // Handle mouse events
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const coords = getCoordinates(e);
    if (!coords) return;

    const canvas = signatureCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#000';
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    e.preventDefault();

    const coords = getCoordinates(e);
    if (!coords) return;

    const canvas = signatureCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearSignature = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  };

  // ======================================================
  // Save Field Value
  // ======================================================
  const saveFieldValue = async () => {
    if (!signingField) return;

    let value = inputValue;

    // Get signature from canvas for signature/initials fields
    if (signingField.fieldType === 'SIGNATURE' || signingField.fieldType === 'INITIALS') {
      const canvas = signatureCanvasRef.current;
      if (canvas) {
        value = canvas.toDataURL('image/png');
      }
    }

    // For checkbox, toggle value
    if (signingField.fieldType === 'CHECKBOX') {
      value = signingField.value === 'checked' ? '' : 'checked';
    }

    try {
      const response = await fetch(
        signerToken ? `/api/signers/fields/${signingField.id}` : `/api/documents/${documentId}/fields/${signingField.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(signerToken ? { token: signerToken, value } : { value }),
        },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Failed to save field:', errorData);
        alert(`Failed to save field: ${errorData.error || 'Unknown error'}`);
        return;
      }

      const result = await response.json();
      console.log('Field saved successfully:', result);

      setFields((prev) =>
        prev.map((f) =>
          f.id === signingField.id ? { ...f, value } : f
        )
      );

      setShowSigningModal(false);
      setSigningField(null);
      setInputValue('');
      onFieldsUpdate?.();
    } catch (err) {
      console.error('Save field error:', err);
      alert(`Error saving field: ${err instanceof Error ? err.message : 'Network error'}`);
    }
  };

  // ======================================================
  // Drag and Drop - Drop New Field from Palette
  // ======================================================
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    if (mode !== 'edit') return;

    try {
      const fieldDataStr = e.dataTransfer.getData('application/json');
      if (!fieldDataStr) return;

      const fieldData = JSON.parse(fieldDataStr);

      // Calculate drop position relative to PDF
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const dropX = e.clientX - rect.left + container.scrollLeft;
      const dropY = e.clientY - rect.top + container.scrollTop;

      // Convert to PDF coordinates (unscale)
      const pdfX = dropX / scale;
      const pdfY = dropY / scale;

      // Create field via API
      const baseUrl = isTemplate ? `/api/templates/${documentId}/fields/create` : `/api/documents/${documentId}/fields/create`;
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fieldType: fieldData.fieldType,
          label: fieldData.fieldType,
          x: pdfX,
          y: pdfY,
          width: fieldData.defaultWidth,
          height: fieldData.defaultHeight,
          pageNumber: currentPage,
          assignedToId: fieldData.assignedToId,
        }),
      });

      if (!res.ok) throw new Error('Failed to create field');

      const { field } = await res.json();
      setFields((prev) => [...prev, field]);
      onFieldsUpdate?.();
    } catch (err) {
      console.error('Drop field error:', err);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (mode === 'edit') {
      setIsDraggingOver(true);
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
  };

  // ======================================================
  // Field Dragging (Reposition)
  // ======================================================
  const handleFieldDragStart = (e: React.MouseEvent, fieldId: string) => {
    if (mode !== 'edit') return;
    e.stopPropagation();

    setDraggedFieldId(fieldId);
    setDragStartPos({ x: e.clientX, y: e.clientY });
  };

  const handleFieldDrag = useCallback((e: MouseEvent) => {
    if (!draggedFieldId || !dragStartPos) return;

    const deltaX = (e.clientX - dragStartPos.x) / scale;
    const deltaY = (e.clientY - dragStartPos.y) / scale;

    setFields((prev) =>
      prev.map((f) =>
        f.id === draggedFieldId
          ? { ...f, x: f.x + deltaX, y: f.y + deltaY }
          : f
      )
    );

    setDragStartPos({ x: e.clientX, y: e.clientY });
  }, [draggedFieldId, dragStartPos, scale]);

  const handleFieldDragEnd = useCallback(async () => {
    if (!draggedFieldId) return;

    const field = fields.find((f) => f.id === draggedFieldId);
    if (!field) return;

    // Update field position in database
    try {
      const baseUrl = isTemplate ? `/api/templates/${documentId}/fields/${draggedFieldId}` : `/api/documents/${documentId}/fields/${draggedFieldId}`;
      const response = await fetch(baseUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          x: field.x,
          y: field.y
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Failed to save field position:', errorData);
        
        // If field doesn't exist (404/500), reload fields from server to sync state
        if (response.status === 404 || response.status === 500) {
          console.log('Field no longer exists, reloading fields...');
          await loadFields(true); // Force refetch from API
          setDraggedFieldId(null);
          setDragStartPos(null);
          return;
        }
        
        alert(`Failed to save field position: ${errorData.error || 'Unknown error'}`);
        await loadFields(true); // Force refetch from API
      }
    } catch (err) {
      console.error('Update field position error:', err);
      alert(`Failed to save field position: ${err instanceof Error ? err.message : 'Network error'}`);
      await loadFields(true); // Force refetch from API
    }

    setDraggedFieldId(null);
    setDragStartPos(null);
  }, [draggedFieldId, fields, documentId, loadFields, isTemplate]);

  // ======================================================
  // Field Resizing
  // ======================================================
  const handleResizeStart = (e: React.MouseEvent, fieldId: string) => {
    if (mode !== 'edit') return;
    e.stopPropagation();

    const field = fields.find((f) => f.id === fieldId);
    if (!field) return;

    setResizingField(fieldId);
    setResizeStartPos({
      x: e.clientX,
      y: e.clientY,
      width: field.width,
      height: field.height,
    });
  };

  const handleResize = useCallback((e: MouseEvent) => {
    if (!resizingField || !resizeStartPos) return;

    const deltaX = (e.clientX - resizeStartPos.x) / scale;
    const deltaY = (e.clientY - resizeStartPos.y) / scale;

    setFields((prev) =>
      prev.map((f) =>
        f.id === resizingField
          ? {
              ...f,
              width: Math.max(20, resizeStartPos.width + deltaX),
              height: Math.max(15, resizeStartPos.height + deltaY),
            }
          : f
      )
    );
  }, [resizingField, resizeStartPos, scale]);

  const handleResizeEnd = useCallback(async () => {
    if (!resizingField) return;

    const field = fields.find((f) => f.id === resizingField);
    if (!field) return;

    // Update field size in database
    try {
      const baseUrl = isTemplate ? `/api/templates/${documentId}/fields/${resizingField}` : `/api/documents/${documentId}/fields/${resizingField}`;
      const response = await fetch(baseUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          width: field.width,
          height: field.height
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Failed to save field size:', errorData);
        
        // If field doesn't exist (404/500), reload fields from server to sync state
        if (response.status === 404 || response.status === 500) {
          console.log('Field no longer exists, reloading fields...');
          await loadFields(true); // Force refetch from API
          setResizingField(null);
          setResizeStartPos(null);
          return;
        }
        
        alert(`Failed to save field size: ${errorData.error || 'Unknown error'}`);
        await loadFields(true); // Force refetch from API
      }
    } catch (err) {
      console.error('Update field size error:', err);
      alert(`Failed to save field size: ${err instanceof Error ? err.message : 'Network error'}`);
      await loadFields(true); // Force refetch from API
    }

    setResizingField(null);
    setResizeStartPos(null);
  }, [resizingField, fields, documentId, loadFields, isTemplate]);

  // ======================================================
  // Mouse Event Listeners for Dragging/Resizing
  // ======================================================
  useEffect(() => {
    if (draggedFieldId) {
      window.addEventListener('mousemove', handleFieldDrag);
      window.addEventListener('mouseup', handleFieldDragEnd);
      return () => {
        window.removeEventListener('mousemove', handleFieldDrag);
        window.removeEventListener('mouseup', handleFieldDragEnd);
      };
    }
  }, [draggedFieldId, handleFieldDrag, handleFieldDragEnd]);

  useEffect(() => {
    if (resizingField) {
      window.addEventListener('mousemove', handleResize);
      window.addEventListener('mouseup', handleResizeEnd);
      return () => {
        window.removeEventListener('mousemove', handleResize);
        window.removeEventListener('mouseup', handleResizeEnd);
      };
    }
  }, [resizingField, handleResize, handleResizeEnd]);

  // ======================================================
  // Get fields for current page
  // ======================================================
  const currentPageFields = fields.filter(
    (f) => f.pageNumber === currentPage || !f.pageNumber
  );

  const commitPageChange = () => {
    if (pageInput.trim() === "") {
      // Restore actual page number if empty
      setPageInput(String(currentPage));
      return;
    }

    const num = parseInt(pageInput, 10);

    if (isNaN(num) || num < 1) {
      setCurrentPage(1);
      setPageInput("1");
      return;
    }

    if (num > totalPages) {
      setCurrentPage(totalPages);
      setPageInput(String(totalPages));
      return;
    }

    setCurrentPage(num);
  };

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  // ======================================================
  // Render
  // ======================================================
  return (
    <div className="w-full flex flex-col gap-2">
      {/* === Controls Bar === */}
      <div className="flex flex-wrap items-center gap-3">
        {mode === 'edit' && (
          <Button
            onClick={runOCR}
            className="bg-blue-600 hover:bg-blue-700 text-white"
            disabled={ocrLoading || pdfLoading}
          >
            {ocrLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Detecting Fields...
              </>
            ) : (
              <>
                <Pen className="h-4 w-4 mr-2" />
                Run OCR Detection
              </>
            )}
          </Button>
        )}

        {/* Page Navigation */}
        {totalPages > 1 && (
          <div className="flex items-center gap-2">

            {/* Previous Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              {"<"}
            </Button>

            {/* Editable Page Input */}
            <div className="flex items-center gap-1 text-sm text-gray-600">
              <Input
                type="text"
                value={pageInput}
                onChange={(e) => {
                  const raw = e.target.value;

                  // Allow empty while typing
                  if (raw === "") {
                    setPageInput("");
                    return;
                  }

                  // Allow only digits
                  if (/^\d+$/.test(raw)) {
                    setPageInput(raw);
                  }
                }}

                // On Enter → commit
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    commitPageChange();
                  }
                }}

                // Leaving the box → commit
                onBlur={() => {
                  commitPageChange();
                }}

                className="w-10 h-8 text-center"
              />
              of {totalPages}
            </div>

            {/* Next Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              {">"}
            </Button>
          </div>
        )}


        {/* Zoom Controls */}
        <div className="flex items-center gap-1 ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setScale((s) => Math.max(0.5, s - 0.1))}
          >
            -
          </Button>
          <span className="text-sm text-gray-600 min-w-[50px] text-center">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setScale((s) => Math.min(3, s + 0.1))}
          >
            +
          </Button>
        </div>
      </div>

      {/* === PDF + Field Overlay Container === */}
      <div
        ref={containerRef}
        className={`relative border rounded-lg overflow-auto ${
          isDraggingOver ? 'bg-blue-50 border-blue-400 border-2' : 'bg-gray-100'
        } w-full`}
        style={{
          maxHeight: '80vh',
        }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <div className="relative w-full flex justify-center">
          <div style={{ width: pdfSize.width, height: pdfSize.height, position: "relative" }}>
            {/* Loading overlay */}
            {pdfLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-20">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
              </div>
            )}

            {/* PDF Canvas */}
            <canvas
              ref={canvasRef}
              className="absolute top-0 left-0"
              style={{ zIndex: 1 }}
            />

            {/* Field Overlays */}
            <div
              className="absolute top-0 left-0 pointer-events-none"
              style={{
                width: pdfSize.width,
                height: pdfSize.height,
                zIndex: 10,
              }}
            >
              {currentPageFields.map((field) => {
                const colors = FIELD_COLORS[field.fieldType] || FIELD_COLORS.TEXT;
                const isSelected = selectedField?.id === field.id;
                const isAssignedToMe = mode === 'sign' && field.assignedToId === currentSignerId;
                const isFilled = !!field.value;
                const isDragging = draggedFieldId === field.id;
                const isResizing = resizingField === field.id;

                // Get assigned signer name
                const assignedSigner = signers.find(s => s.id === field.assignedToId);

                return (
                  <div
                    key={field.id}
                    className={`absolute transition-all pointer-events-auto ${
                      mode === 'view' ? 'border-0 bg-transparent' : `border-2 rounded ${colors.bg} ${colors.border}`
                    } ${
                      isSelected ? 'ring-2 ring-blue-400 ring-offset-2' : ''
                    } ${
                      mode === 'view' ? '' : isFilled ? 'opacity-90' : 'opacity-70 hover:opacity-100'
                    } ${
                      mode === 'edit' && !isDragging && !isResizing ? 'cursor-move' :
                      mode === 'view' ? 'cursor-default' : 'cursor-pointer'
                    } ${
                      isDragging || isResizing ? 'opacity-60 shadow-lg' : ''
                    }`}
                    style={{
                      top: field.y * scale,
                      left: field.x * scale,
                      width: field.width * scale,
                      height: field.height * scale,
                      minWidth: 30,
                      minHeight: 20,
                    }}
                    onClick={(e) => handleFieldClick(e, field)}
                    onMouseDown={mode === 'edit' ? (e) => handleFieldDragStart(e, field.id) : undefined}
                  >
                    {/* Field Type Badge */}
                    {mode !== 'view' && (
                      <div
                        className={`absolute -top-5 left-0 ${colors.bg} ${colors.text} text-[10px] px-1.5 py-0.5 rounded-t flex items-center gap-1 whitespace-nowrap`}
                      >
                        {FIELD_ICONS[field.fieldType]}
                        {field.label}
                        {field.required && <span className="text-red-500">*</span>}
                      </div>
                    )}

                    {/* Delete Button (Edit Mode Only) */}
                    {mode === 'edit' && (
                      <button
                        className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-md z-30 transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteField(field.id);
                        }}
                        title="Delete field"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}

                    {/* Assigned Signer Badge (Edit Mode) */}
                    {mode === 'edit' && assignedSigner && (
                      <div className="absolute -bottom-5 left-0 z-20">
                        <div
                          className="bg-gray-700 text-white text-[10px] px-1.5 py-0.5 rounded-b flex items-center gap-1 whitespace-nowrap cursor-pointer hover:bg-gray-800"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowQuickAssign(showQuickAssign === field.id ? null : field.id);
                          }}
                        >
                          <User className="h-2.5 w-2.5" />
                          {assignedSigner.name || assignedSigner.email}
                          <ChevronDown className="h-2.5 w-2.5" />
                        </div>

                        {/* Quick Assign Dropdown */}
                        {showQuickAssign === field.id && (
                          <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded shadow-lg min-w-[150px] z-30">
                            <div className="text-[10px] font-semibold px-2 py-1 border-b bg-gray-50">
                              Assign to:
                            </div>
                            {signers.map((signer) => (
                              <div
                                key={signer.id}
                                className={`px-2 py-1.5 text-[11px] hover:bg-blue-50 cursor-pointer ${
                                  signer.id === field.assignedToId ? 'bg-blue-100 font-semibold' : ''
                                }`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAssignSigner(field.id, signer.id);
                                  setShowQuickAssign(null);
                                }}
                              >
                                {signer.name || signer.email}
                              </div>
                            ))}
                            <div
                              className="px-2 py-1.5 text-[11px] hover:bg-red-50 cursor-pointer border-t text-red-600"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAssignSigner(field.id, '');
                                setShowQuickAssign(null);
                              }}
                            >
                              Unassign
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Unassigned Warning (Edit Mode) */}
                    {mode === 'edit' && !assignedSigner && (
                      <div className="absolute -bottom-5 left-0 z-20">
                        <div
                          className="bg-red-600 text-white text-[10px] px-1.5 py-0.5 rounded-b flex items-center gap-1 whitespace-nowrap animate-pulse cursor-pointer hover:bg-red-700"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowQuickAssign(showQuickAssign === field.id ? null : field.id);
                          }}
                        >
                          ⚠ Unassigned
                          <ChevronDown className="h-2.5 w-2.5" />
                        </div>

                        {/* Quick Assign Dropdown */}
                        {showQuickAssign === field.id && (
                          <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded shadow-lg min-w-[150px] z-30">
                            <div className="text-[10px] font-semibold px-2 py-1 border-b bg-gray-50">
                              Assign to:
                            </div>
                            {signers.map((signer) => (
                              <div
                                key={signer.id}
                                className="px-2 py-1.5 text-[11px] hover:bg-blue-50 cursor-pointer"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAssignSigner(field.id, signer.id);
                                  setShowQuickAssign(null);
                                }}
                              >
                                {signer.name || signer.email}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Filled Value Display */}
                    {isFilled && (
                      <div className="absolute inset-0 flex items-center justify-center overflow-hidden p-1">
                        {(field.fieldType === 'SIGNATURE' || field.fieldType === 'INITIALS') &&
                        field.value?.startsWith('data:image') ? (
                          <img
                            src={field.value}
                            alt={field.fieldType}
                            className="max-h-full max-w-full object-contain"
                          />
                        ) : field.fieldType === 'CHECKBOX' ? (
                          <Check className="h-4 w-4 text-green-600" />
                        ) : (
                          <span className="text-xs truncate">{field.value}</span>
                        )}
                      </div>
                    )}

                    {/* Sign Here Indicator */}
                    {mode === 'sign' && isAssignedToMe && !isFilled && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-xs text-gray-500 animate-pulse">
                          Click to {field.fieldType.toLowerCase()}
                        </span>
                      </div>
                    )}

                    {/* Resize Handle (Edit Mode Only) */}
                    {mode === 'edit' && isSelected && (
                      <div
                        className="absolute -right-1 -bottom-1 w-3 h-3 bg-blue-500 border border-white rounded-full cursor-nwse-resize"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleResizeStart(e, field.id);
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* === Field Summary === */}
      <div className="text-sm text-gray-600">
        {fields.length} fields detected
        {mode === 'sign' && currentSignerId && (
          <>
            {' '}
            | {fields.filter((f) => f.assignedToId === currentSignerId && f.value).length}/
            {fields.filter((f) => f.assignedToId === currentSignerId).length} completed
          </>
        )}
      </div>

      {/* === Signing Modal === */}
      <Dialog open={showSigningModal} onOpenChange={setShowSigningModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {signingField?.fieldType === 'SIGNATURE'
                ? 'Add Your Signature'
                : signingField?.fieldType === 'INITIALS'
                ? 'Add Your Initials'
                : signingField?.fieldType === 'DATE'
                ? 'Enter Date'
                : signingField?.fieldType === 'CHECKBOX'
                ? 'Check this field?'
                : 'Enter Value'}
            </DialogTitle>
          </DialogHeader>

          <div className="py-4">
            {/* Signature/Initials Canvas */}
            {(signingField?.fieldType === 'SIGNATURE' ||
              signingField?.fieldType === 'INITIALS') && (
              <div className="space-y-2">
                <canvas
                  ref={signatureCanvasRef}
                  width={400}
                  height={signingField.fieldType === 'SIGNATURE' ? 150 : 80}
                  className="border-2 border-gray-300 rounded bg-white cursor-crosshair w-full touch-none"
                  onMouseDown={startDrawing}
                  onMouseMove={draw}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  onTouchStart={startDrawing}
                  onTouchMove={draw}
                  onTouchEnd={stopDrawing}
                />
                <Button variant="outline" size="sm" onClick={clearSignature}>
                  Clear
                </Button>
              </div>
            )}

            {/* Date Input */}
            {signingField?.fieldType === 'DATE' && (
              <Input
                type="date"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className="w-full"
              />
            )}

            {/* Text Input */}
            {signingField?.fieldType === 'TEXT' && (
              <Input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Enter text..."
                className="w-full"
              />
            )}

            {/* Checkbox Confirmation */}
            {signingField?.fieldType === 'CHECKBOX' && (
              <p className="text-center text-gray-600">
                Click confirm to check this field.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSigningModal(false)}>
              Cancel
            </Button>
            <Button onClick={saveFieldValue}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
