"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  MouseEvent,
} from "react";
import PdfPage from "@/components/pdf/PdfPage";
import { usePdf } from "@/hooks/usePdf";
import { Rnd } from "react-rnd";


import {
  Type,
  Signature,
  MousePointer,
  CheckSquare,
  Calendar,
  Circle,
  Highlighter,
  Image,
  Undo,
  Redo,
  ZoomIn,
  ZoomOut,
  Save,
  Download,
  Printer,
  Maximize,
} from "lucide-react";

/* ---------------------------------------------------------
   ICON REGISTRY
--------------------------------------------------------- */
const icons: any = {
  Type,
  Signature,
  MousePointer,
  CheckSquare,
  Calendar,
  Circle,
  Highlighter,
  Image,
  Undo,
  Redo,
  ZoomIn,
  ZoomOut,
  Save,
  Download,
  Printer,
  Maximize,
};

const insertTools = [
  { icon: "Type", label: "Text Box" },
  { icon: "Signature", label: "Signature" },
  { icon: "CheckSquare", label: "Checkbox" },
  { icon: "Calendar", label: "Date" },
  { icon: "Circle", label: "Shape" },
  { icon: "Highlighter", label: "Highlight" },
  { icon: "Image", label: "Image" },
];

// Define per-tool color configuration (border, fill, etc.)
const TOOL_STYLES: Record<
  OverlayItem["type"],
  { color: string; dashed?: boolean }
> = {
  text: { color: "#007aff", dashed: true },       // Blue
  date: { color: "#14b48c", dashed: true },       // Teal
  signature: { color: "#ffae00" },                // Orange
  checkbox: { color: "#9b59b6", dashed: true },   // Purple
  image: {color: "#5969b6ff", dashed: true},      // Red
};

function ToolButton({icon,label,onClick,group,activeTool,setActiveTool,
}: {
  icon: keyof typeof icons;
  label: string;
  onClick?: () => void;
  group?: "insert" | "other";
  activeTool?: string | null;
  setActiveTool?: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const Icon = icons[icon];
  const isActive = group === "insert" && activeTool === label;

  return (
    <button
      onClick={() => {
        if (group === "insert" && setActiveTool) {
          setActiveTool((prev) => (prev === label ? null : label));
        }
        onClick?.();
      }}
      className={`relative flex items-center justify-center w-8 h-8 rounded-md border transition-colors group ${
        isActive
          ? "bg-blue-600 text-white border-blue-600"
          : "text-gray-700 border-gray-200 hover:bg-gray-100"
      }`}
      title=""
    >
      <Icon size={16} />
      <span className="absolute bottom-[-1.75rem] left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black px-2 py-1 text-xs text-white opacity-0 pointer-events-none group-hover:opacity-100 transition">
        {label}
      </span>
    </button>
  );
}

/* ---------------------------------------------------------
   TYPES
--------------------------------------------------------- */
type OverlayItem = {
  id: string;
  type: "text" | "signature" | "date" | "checkbox" | "image";
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  value?: string;
  isEditing?: boolean;
};

type HistoryEntry = {
  id: string;
  prev: OverlayItem | null;
  next: OverlayItem | null;
};

/* ---------------------------------------------------------
   MAIN COMPONENT
--------------------------------------------------------- */
export default function PdfViewer({
  url,
  documentId, // <-- FIXED TYPE SUPPORT
}: {
  url: string;
  documentId?: string;
}) {
  /* ---------------------------------------------------------
     LOAD PDF
  --------------------------------------------------------- */
  const { pdf, loading, error, numPages } = usePdf(url);
  const [scale, setScale] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const [basePageWidth, setBasePageWidth] = useState<number | null>(null);
  const [activeInsertTool, setActiveInsertTool] = useState<string | null>(null);
  const [overlays, setOverlays] = useState<OverlayItem[]>([]);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  // -------------------------
  // Image management
  // -------------------------
  const [recentImages, setRecentImages] = useState<string[]>([
    "/placeholder1.png",
    "/placeholder2.png",
    "/placeholder3.png",
  ]); // placeholders for now

  // -------------------------
  // Image tool popover
  // -------------------------
  const [showImagePopover, setShowImagePopover] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null);
  const imageButtonRef = useRef<HTMLButtonElement | null>(null);


  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleUploadImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const imageUrl = ev.target?.result as string;
      // add new image to recent list
      setRecentImages((prev) => [imageUrl, ...prev.slice(0, 2)]);
      // create overlay with this image
      const newOverlay: OverlayItem = {
        id: genId(),
        type: "image",
        x: 50,
        y: 50,
        width: 120,
        height: 120,
        zIndex: overlaysRef.current.length + 1,
        value: imageUrl,
        isEditing: false,
      };
      setOverlays((prev) => [...prev, newOverlay]);
      recordCreate(newOverlay);
    };
    reader.readAsDataURL(file);
  };


  const containerRef = useRef<HTMLDivElement | null>(null);
  const pdfContentRef = useRef<HTMLDivElement | null>(null);

  /* ---------------------------------------------------------
     HISTORY
  --------------------------------------------------------- */
  const [historyStack, setHistoryStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const isReplayingRef = useRef(false);

  const textAreaRefs = useRef<Map<string, HTMLTextAreaElement | null>>(
    new Map()
  );
  const editStartSnapshotRef = useRef<OverlayItem | null>(null);

  const imagePopoverRef = useRef<HTMLDivElement | null>(null);

  const overlaysRef = useRef<OverlayItem[]>([]);
  useEffect(() => {
    overlaysRef.current = overlays;
  }, [overlays]);

  const formatIsoToMdY = (iso?: string) => {
    if (!iso) return "";
    const parts = iso.split("-");
    if (parts.length !== 3) return iso;
    const [y, m, d] = parts;
    // ensure numbers (removes leading zeros if any)
    const mm = String(Number(m)).padStart(2, "0");
    const dd = String(Number(d)).padStart(2, "0");
    return `${mm}/${dd}/${y}`;
  };

  // generate id
  const genId = () => `ov-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  /* ---------------------------------------------------------
     PAGE WIDTH → FIT TO SCREEN
  --------------------------------------------------------- */
  const fitToWidth = useCallback(() => {
    if (!containerRef.current || !basePageWidth) return;

    const style = getComputedStyle(containerRef.current);
    const padLeft = parseFloat(style.paddingLeft || "0");
    const padRight = parseFloat(style.paddingRight || "0");
    const innerWidth =
      containerRef.current.clientWidth - padLeft - padRight;

    const newScale = innerWidth / basePageWidth;
    setFitScale(newScale);
    setScale(newScale);
  }, [basePageWidth]);

  const handleFirstPageRendered = useCallback(
    (dims: { width: number }) => {
      if (!basePageWidth) setBasePageWidth(dims.width);
    },
    [basePageWidth]
  );

  useEffect(() => {
    if (basePageWidth) fitToWidth();
  }, [basePageWidth, fitToWidth]);

  /* ---------------------------------------------------------
     ESC Key Cancels Insert Tool
  --------------------------------------------------------- */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveInsertTool(null);
        setMousePos(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowImagePopover(false);
    };
    const handleClickOutside = (e: globalThis.MouseEvent) => {
      const target = e.target as Node;
      if (
        imageButtonRef.current &&
        !imageButtonRef.current.contains(target) &&
        !(target as HTMLElement).closest(".image-popover")
      ) {
        setShowImagePopover(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);


  /* ---------------------------------------------------------
     HISTORY UTILITIES
  --------------------------------------------------------- */
  const pushHistory = useCallback((entry: HistoryEntry) => {
    if (isReplayingRef.current) return;

    setHistoryStack((prev) => [...prev, entry]);
    setRedoStack([]);
  }, []);

  const recordCreate = (item: OverlayItem) =>
    pushHistory({ id: item.id, prev: null, next: item });

  const recordDelete = (item: OverlayItem) =>
    pushHistory({ id: item.id, prev: item, next: null });

  const recordUpdate = useCallback(
    (id: string, prev: OverlayItem, next: OverlayItem) => {
      // if identical, don't record
      const same = JSON.stringify(prev) === JSON.stringify(next);
      if (same) return;
      pushHistory({ id, prev, next });
    },
    [pushHistory]
  );

  // -------------------------
  // Undo / Redo
  // -------------------------
  const handleUndo = useCallback(() => {
    if (historyStack.length === 0) return;
    const last = historyStack[historyStack.length - 1];

    setHistoryStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev, last]);

    isReplayingRef.current = true;

    setOverlays((prev) => {
      if (last.prev == null && last.next) {
        return prev.filter((o) => o.id !== last.id);
      }
      if (last.next == null && last.prev) {
        return [...prev, last.prev];
      }
      if (last.prev && last.next) {
        return prev.map((o) => (o.id === last.id ? last.prev! : o));
      }
      return prev;
    });

    setTimeout(() => {
      isReplayingRef.current = false;
    }, 0);
  }, [historyStack]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const last = redoStack[redoStack.length - 1];

    setRedoStack((prev) => prev.slice(0, -1));
    setHistoryStack((prev) => [...prev, last]);

    isReplayingRef.current = true;

    setOverlays((prev) => {
      if (last.prev == null && last.next) {
        return [...prev, last.next];
      }
      if (last.next == null && last.prev) {
        return prev.filter((o) => o.id !== last.id);
      }
      if (last.prev && last.next) {
        return prev.map((o) => (o.id === last.id ? last.next! : o));
      }
      return prev;
    });

    setTimeout(() => {
      isReplayingRef.current = false;
    }, 0);
  }, [redoStack]);

  /* ---------------------------------------------------------
     KEYBOARD SHORTCUTS
  --------------------------------------------------------- */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        handleUndo();
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        (e.key === "y" || (e.shiftKey && e.key === "Z"))
      ) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleUndo, handleRedo]);

  // Map toolbar labels to internal overlay types
  const TOOL_MAP: Record<string, OverlayItem["type"]> = {
    "Text Box": "text",
    Signature: "signature",
    Date: "date",
    Checkbox: "checkbox",
    // Shape: "shape",
    // Highlighter: "highlighter",
    Image: "image",
  };

  // Default width and height per tool type
  const TOOL_SIZES: Record<OverlayItem["type"], { width: number; height: number }> = {
    text: { width: 160, height: 48 },
    signature: { width: 160, height: 48 },
    date: { width: 120, height: 36 },
    checkbox: { width: 24, height: 24 },
    image: {width: 150, height: 150}
  };

  // -------------------------
  // Add overlay on canvas click (single placement)
  // -------------------------
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (!activeInsertTool) return;

      if (activeInsertTool === "Image") {
        openImagePicker();
        return;
      }

      const target = (pdfContentRef.current ||
        e.currentTarget) as HTMLElement;
      const rect = target.getBoundingClientRect();

      const x = e.clientX - rect.left + target.scrollLeft;
      const y = e.clientY - rect.top + target.scrollTop;

      const type = TOOL_MAP[activeInsertTool] || "text";

      const { width, height } = TOOL_SIZES[type] || { width: 160, height: 48 };

      const newOverlay: OverlayItem = {
        id: genId(),
        type,
        x,
        y,
        width,
        height,
        zIndex: overlaysRef.current.length + 1,
        value:
          type === "date"
            ? new Date().toISOString().split("T")[0] // default: today
            : type === "checkbox"
            ? ""
            : "",
        isEditing: type === "text" || type === "date",
      };

      setOverlays((prev) => [...prev, newOverlay]);
      recordCreate(newOverlay);

      setActiveInsertTool(null);
      setMousePos(null);
    },
    [activeInsertTool, overlays.length]
  );

  const handleDeleteOverlay = useCallback(
    (item: OverlayItem) => {
      recordDelete(item);
      setOverlays((prev) => prev.filter((o) => o.id !== item.id));
    },
    []
  );

  // cursor while insert tool is active
  const cursorStyle =
    activeInsertTool &&
    (activeInsertTool === "Text Box" || activeInsertTool === "Signature")
      ? "crosshair"
      : "default";
  
  // track which overlay id is currently being dragged (true while dragging)
  const draggingIdsRef = useRef<Set<string>>(new Set());
  // track pointer down start coords for click-vs-drag detection per overlay
  const pointerDownRef = useRef<Record<string, { x: number; y: number } | null>>({});
  // track whether pointer moved (beyond threshold) since down for each overlay
  const pointerMovedRef = useRef<Record<string, boolean>>({});

  // -------------------------
  // Rnd handlers: capture prev state on start, record on stop
  // -------------------------
  const dragStartRef = useRef<Map<string, OverlayItem>>(new Map());
  const resizeStartRef = useRef<Map<string, OverlayItem>>(new Map());

  const handleDragStart = (id: string) => {
    const found = overlays.find((o) => o.id === id);
    if (found) {
      dragStartRef.current.set(id, { ...found });
      // mark as dragging so click logic ignores toggles while dragging
      draggingIdsRef.current.add(id);
    }
  };

  const handleDragStop = (id: string, x: number, y: number) => {
    const prev = dragStartRef.current.get(id);
    if (!prev) {
      draggingIdsRef.current.delete(id);
      return;
    }

    const current = overlaysRef.current.find((o) => o.id === id);
    const next = { ...(current || prev), x, y };
    // pushHistory({ id, prev, next });
    recordUpdate(id, prev, next);

    setOverlays((prev) => {
      const nextArr = prev.map((o) => (o.id === id ? next : o));
      overlaysRef.current = nextArr;
      return nextArr;
    });

    dragStartRef.current.delete(id);
    // clear dragging state shortly after drag stops
    setTimeout(() => draggingIdsRef.current.delete(id), 0);
  };

  const handleResizeStart = (id: string) => {
    const found = overlaysRef.current.find((o) => o.id === id);
    if (found) resizeStartRef.current.set(id, { ...found });
  };

  const handleResizeStop = (
    id: string,
    width: number,
    height: number,
    x: number,
    y: number
  ) => {
    const prev = resizeStartRef.current.get(id);

    // If checkbox -> force square (use max to avoid clipping content)
    const itemNow = overlaysRef.current.find((o) => o.id === id);
    if (itemNow?.type === "checkbox") {
      const s = Math.max(width, height);
      width = s;
      height = s;
    }

    setOverlays((prevArr) =>
      prevArr.map((o) =>
        o.id === id ? { ...o, width, height, x, y } : o
      )
    );
    const now = overlays.find((o) => o.id === id);
    if (prev && now) recordUpdate(id, prev, { ...now, width, height, x, y } as OverlayItem);
    resizeStartRef.current.delete(id);
  };


  // -------------------------
  // Text editing: record prev snapshot on double-click, record update on blur
  // -------------------------
  const handleTextDoubleClick = useCallback((id: string) => {
    editStartSnapshotRef.current = { ...overlaysRef.current.find((o) => o.id === id)! };

    setOverlays((prev) =>
      prev.map((o) =>
        o.id === id ? { ...o, isEditing: true } : o
      )
    );
  }, []);

  const handleTextBlur = (id: string) => {
    // Get latest overlay state
    const after = overlaysRef.current.find((o) => o.id === id);
    // End editing mode in UI
    setOverlays((prev) =>
      prev.map((o) => (o.id === id ? { ...o, isEditing: false } : o))
    );
    if (!after) {
      editStartSnapshotRef.current = null;
      return;
    }
    // Build a prev state that has empty text (guaranteed one-click-clear)
    const prevForTextClear: OverlayItem = { ...after, value: "" };
    const nextForText: OverlayItem = { ...after };
    // If prev and next are identical (no visible change), do nothing
    if (JSON.stringify(prevForTextClear) === JSON.stringify(nextForText)) {
      editStartSnapshotRef.current = null;
      return;
    }
    // // Remove any previous text-edit history entries for this overlay so we don't stack multiple text edits
    // removeExistingTextEditHistoryForId(id);
    // Push a single history entry that will revert to empty string on undo
    recordUpdate(id, prevForTextClear, nextForText);
    editStartSnapshotRef.current = null;
  };

  const handleTextChange = (id: string, value: string) => {
    setOverlays((prev) =>
      prev.map((o) => (o.id === id ? { ...o, value } : o))
    );
  };

  /* ---------------------------------------------------------
     MOUSE
  --------------------------------------------------------- */
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!activeInsertTool) return;

    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();

    setMousePos({
      x: e.clientX - rect.left + target.scrollLeft,
      y: e.clientY - rect.top + target.scrollTop,
    });
  };

  // -------------------------
  // Ghost preview color (dynamic per tool)
  // -------------------------
  const activeType = activeInsertTool ? TOOL_MAP[activeInsertTool] : undefined;
  const toolColor = activeType ? TOOL_STYLES[activeType]?.color || "#999" : "#999";
  const ghostBorder = `2px solid ${toolColor}80`; // semi-transparent border
  const ghostBg = `${toolColor}0F`; // faint background fill
  const ghostSize = activeType ? TOOL_SIZES[activeType] : undefined;
  const ghostWidth = ghostSize?.width || 160;
  const ghostHeight = ghostSize?.height || 48;

  const [showImagePicker, setShowImagePicker] = useState(false);

  const openImagePicker = () => setShowImagePicker(true);
  const closeImagePicker = () => setShowImagePicker(false);

  // -------------------------
  // Render
  // -------------------------
  return (
    <div className="flex flex-col w-full h-full min-w-0">
      {/* TOOLBAR */}
      <div className="flex flex-nowrap items-center justify-between gap-3 p-2 mb-2 bg-white sticky top-0 z-20">
        <div className="flex items-center gap-2">
          {insertTools.map((tool) =>
            tool.label === "Image" ? (
              <button
                key={tool.label}
                ref={imageButtonRef}
                onClick={(e) => {
                  e.stopPropagation();

                  const buttonRect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();

                  setShowImagePopover((prev) => {
                    const next = !prev;
                    setActiveInsertTool(next ? "Image" : null);

                    // Compute position relative to viewport
                    if (next) {
                      setPopoverPosition({
                        top: buttonRect.bottom + 8,
                        left: buttonRect.left + buttonRect.width / 2,
                      });
                    }
                    return next;
                  });
                }}

                className={`relative flex items-center justify-center w-8 h-8 rounded-md border transition-colors group ${
                  activeInsertTool === "Image"
                    ? "bg-blue-600 text-white border-blue-600"
                    : "text-gray-700 border-gray-200 hover:bg-gray-100"
                }`}
                title=""
              >
                <Image size={16} />
                <span className="absolute bottom-[-1.75rem] left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black px-2 py-1 text-xs text-white opacity-0 pointer-events-none group-hover:opacity-100 transition">
                  Image
                </span>
              </button>
            ) : (
              <ToolButton
                key={tool.label}
                icon={tool.icon as keyof typeof icons}
                label={tool.label}
                group="insert"
                activeTool={activeInsertTool}
                setActiveTool={setActiveInsertTool}
              />
            ))}
        </div>

        <div className="flex items-center gap-2">
          <ToolButton icon="Undo" label="Undo" onClick={handleUndo} />
          <ToolButton icon="Redo" label="Redo" onClick={handleRedo} />
        </div>

        <div className="flex items-center gap-1">
          <ToolButton
            icon="ZoomOut"
            label="Zoom Out"
            onClick={() =>
              setScale((s) => Math.max(0.25 * fitScale, s / 1.25))
            }
          />
          <span className="text-sm w-12 text-center">
            {Math.round((scale / fitScale) * 100)}%
          </span>
          <ToolButton
            icon="ZoomIn"
            label="Zoom In"
            onClick={() =>
              setScale((s) => Math.min(4 * fitScale, s * 1.25))
            }
          />
          <ToolButton icon="Maximize" label="Fit" onClick={fitToWidth} />
        </div>

        <div className="flex items-center gap-2">
          <ToolButton icon="Save" label="Save" />
          <ToolButton icon="Download" label="Download" />
          <ToolButton icon="Printer" label="Print" />
        </div>
      </div>
      
      {/* IMAGE TOOL POPOVER */}
      {showImagePopover && popoverPosition && (
        <div
          ref={imagePopoverRef}
          className="absolute image-popover bg-white border border-gray-200 shadow-lg rounded-md p-3 w-64 z-[1000]"
          style={{
            top: popoverPosition.top,
            left: popoverPosition.left,
            transform: "translateX(-50%)", // ✅ centers using computed midpoint
          }}
        >
          {/* Small arrow pointing up */}
          <div
            className="absolute w-3 h-3 bg-white border-l border-t border-gray-200 rotate-45"
            style={{
              top: "-6px",
              left: "calc(50% - 6px)",
            }}
          ></div>

          <h3 className="text-xs font-semibold mb-2">Select an image</h3>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {recentImages.map((src, idx) => (
              <button
                key={idx}
                className="border rounded hover:border-blue-500 overflow-hidden"
                onClick={() => {
                  const newOverlay: OverlayItem = {
                    id: genId(),
                    type: "image",
                    x: 80,
                    y: 80,
                    width: 120,
                    height: 120,
                    zIndex: overlaysRef.current.length + 1,
                    value: src,
                    isEditing: false,
                  };
                  setOverlays((prev) => [...prev, newOverlay]);
                  recordCreate(newOverlay);
                  setShowImagePopover(false);
                }}
              >
                <img
                  src={src}
                  alt="Recent"
                  className="w-full h-16 object-cover"
                />
              </button>
            ))}
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full bg-blue-600 text-white py-1 rounded hover:bg-blue-700 text-xs"
          >
            Upload new image
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleUploadImage}
          />
        </div>
      )}

      {/* CANVAS */}
      <div
        ref={containerRef}
        className="flex-1 bg-gray-100 overflow-auto relative"
        style={{ height: "100%", width: "100%", padding: "1rem", cursor: cursorStyle }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setMousePos(null)}
        onClick={handleCanvasClick}
      >
        <div
          ref={pdfContentRef}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            width: "fit-content",
            margin: "0 auto",
            minWidth: "100%",
          }}
        >
          {loading && <div>Loading document…</div>}
          {error && (
            <div className="text-red-600">
              Failed to load PDF: {String(error)}
            </div>
          )}

          {Array.from({ length: numPages || 0 }).map((_, idx) => (
            <div key={idx} style={{ marginBottom: "1rem" }}>
              <PdfPage
                url={url}
                pageNumber={idx + 1}
                scale={scale}
                onRendered={idx === 0 ? handleFirstPageRendered : undefined}
              />
            </div>
          ))}
        </div>

        {/* GHOST PREVIEW */}
        {activeInsertTool && mousePos && (
          <div
            style={{
              position: "absolute",
              left: mousePos.x,
              top: mousePos.y,
              width: ghostWidth,
              height: ghostHeight,
              border: ghostBorder,
              backgroundColor: ghostBg,
              pointerEvents: "none",
              zIndex: 9999,
              borderRadius: "4px",
            }}
          />
        )}


        {/* overlays */}
        {overlays.map((item) => (
          <Rnd
            key={item.id}
            default={{ x: item.x, y: item.y, width: item.width, height: item.height }}
            className="group/overlay"
            style={{
              zIndex: item.zIndex,
              position: "absolute",
              backgroundColor: "transparent",
              cursor: draggingIdsRef.current.has(item.id) ? "grabbing" : item.isEditing ? "text" : "move",
            }}
            onDragStart={() => handleDragStart(item.id)}
            onDragStop={(e, d) => handleDragStop(item.id, d.x, d.y)}
            onResizeStart={() => handleResizeStart(item.id)}
            enableResizing={item.isEditing}
            onResizeStop={(e, dir, ref, delta, position) => {
              const width = parseFloat(ref.style.width || `${item.width}`);
              const height = parseFloat(ref.style.height || `${item.height}`);
              handleResizeStop(item.id, width, height, position.x, position.y);
            }}
            disableDragging={item.isEditing}
            lockAspectRatio={item.type === "checkbox"}
            minWidth={item.type === "checkbox" ? 16 : 20}
            minHeight={item.type === "checkbox" ? 16 : 16}
          >
            <div
              className={`
                relative w-full h-full transition-all duration-150
                ${
                  item.isEditing
                    ? "border border-solid"
                    : item.type === "checkbox"
                    ? "border-none group-hover/overlay:border group-hover/overlay:border-dashed"
                    : item.type === "image"
                    ? "border-none group-hover/overlay:border group-hover/overlay:border-dashed"
                    : !item.value?.trim()
                    ? "border border-dashed"
                    : "border-none group-hover/overlay:border group-hover/overlay:border-dashed"
                }
              `}
              style={{
                borderColor: TOOL_STYLES[item.type]?.color || "#999",
                cursor: item.isEditing ? "text" : "move",
                transition: "border-color 0.15s ease",
              }}
            >
              {item.type === "text" ? (
                <textarea
                  ref={(el) => {
                    if (el) textAreaRefs.current.set(item.id, el);
                    else textAreaRefs.current.delete(item.id);
                  }}
                  style={{
                    background: "transparent",
                    resize: "none",
                    overflow: "hidden",
                  }}
                  className={`w-full h-full p-1 text-xs text-gray-900 bg-transparent outline-none ${
                    item.isEditing ? "cursor-text" : "cursor-move select-none"
                  }`}
                  placeholder="Double-click to edit…"
                  value={item.value || ""}
                  readOnly={!item.isEditing}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    handleTextDoubleClick(item.id);
                  }}
                  onBlur={() => handleTextBlur(item.id)}
                  onChange={(e) => handleTextChange(item.id, e.target.value)}
                />
              ) : item.type === "signature" ? (
                <div
                  className="flex items-center justify-center text-gray-600 text-xs h-full select-none cursor-move"
                  onClick={(e) => e.stopPropagation()}
                >
                  Signature
                </div>
              ) : item.type === "date" ? (
                <div
                  className="flex items-center justify-start h-full cursor-pointer select-none text-xs"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setOverlays((prev) =>
                      prev.map((o) => (o.id === item.id ? { ...o, isEditing: true } : o))
                    );
                  }}
                >
                  {item.isEditing ? (
                    <input
                      type="date"
                      className="w-full h-full rounded px-1 text-xs"
                      style={{
                        border: `1px solid ${TOOL_STYLES[item.type]?.color || "#007aff"}`,
                      }}
                      // keep the raw yyyy-mm-dd in the input value (browser expects that)
                      value={item.value || new Date().toISOString().split("T")[0]}
                      onChange={(e) => {
                        const newValue = e.target.value; // yyyy-mm-dd
                        setOverlays((prev) =>
                          prev.map((o) => (o.id === item.id ? { ...o, value: newValue } : o))
                        );
                      }}
                      onBlur={() => {
                        const todayIso = new Date().toISOString().split("T")[0];
                        setOverlays((prev) =>
                          prev.map((o) =>
                            o.id === item.id
                              ? { ...o, isEditing: false, value: o.value || todayIso }
                              : o
                          )
                        );
                      }}
                    />
                  ) : (
                    // Display left-aligned formatted date using our helper (avoids timezone shifts)
                    <span className="pl-2 w-full text-left">
                      {formatIsoToMdY(item.value || new Date().toISOString().split("T")[0])}
                    </span>
                  )}
                </div>
              ) : item.type === "checkbox" ? (
                <div
                  className="flex items-center justify-center h-full w-full select-none cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    // toggle allowed but not required; keep it simple
                    if (!item.isEditing) {
                      setOverlays((prev) =>
                        prev.map((o) => (o.id === item.id ? { ...o, value: o.value === "checked" ? "" : "checked" } : o))
                      );
                    }
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setOverlays((prev) =>
                      prev.map((o) =>
                        o.id === item.id ? { ...o, isEditing: true } : o
                      )
                    );
                  }}
                  onBlur={() => {
                    setOverlays((prev) =>
                      prev.map((o) =>
                        o.id === item.id ? { ...o, isEditing: false } : o
                      )
                    );
                  }}
                  tabIndex={0}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: 4,
                      width: "100%",
                      height: "100%",
                    }}
                  >
                    <div
                      style={{
                        width: Math.max(12, (item.width || 24) * 0.6),
                        height: Math.max(12, (item.height || 24) * 0.6),
                        minWidth: 12,
                        minHeight: 12,
                        border: "1px solid black",
                        backgroundColor: "transparent", // transparent background always
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {item.value === "checked" && (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          style={{ width: 12, height: 12 }}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="black"
                          strokeWidth={3}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      )}
                    </div>
                  </div>
                </div>
              ) : item.type === "image" ? (
                <div
                  className="w-full h-full relative"
                  tabIndex={0}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setOverlays((prev) =>
                      prev.map((o) =>
                        o.id === item.id ? { ...o, isEditing: true } : o
                      )
                    );
                  }}
                  onBlur={() => {
                    // exit edit mode on blur (same behavior as text/date)
                    setOverlays((prev) =>
                      prev.map((o) =>
                        o.id === item.id ? { ...o, isEditing: false } : o
                      )
                    );
                  }}
                >
                  {item.value ? (
                    <img
                      src={item.value}
                      alt="Overlay"
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "fill", // ✅ fills box naturally
                        userSelect: "none",
                        pointerEvents: "none",
                      }}
                      draggable={false}
                    />
                  ) : (
                    <div className="w-full h-full bg-gray-200 flex items-center justify-center text-gray-500 text-xs">
                      No image
                    </div>
                  )}
                </div>
              ) : null}

              {/* delete button */}
              {(item.type === "signature" ||
                item.isEditing ||
                (item.type !== "checkbox" && !item.value?.trim() && item.type !== "date")) && (
                <button
                  type="button"
                  aria-label="Delete overlay"
                  className="absolute -top-2 -right-2 w-3 h-3 flex items-center justify-center bg-red-500 text-white rounded-full text-[10px] font-bold shadow z-[9999] cursor-pointer hover:scale-110 transition-transform duration-100"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteOverlay(item);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          </Rnd>
        ))}
      </div>
    </div>
  );
}
