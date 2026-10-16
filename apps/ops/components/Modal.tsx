"use client";
import { X } from "lucide-react";
import { useEffect } from "react";

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modalhead">
          <h2>{title}</h2>
          <button className="iconbtn" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Confirm({ title, message, action, danger, onConfirm, onClose }: {
  title: string; message: React.ReactNode; action: string; danger?: boolean; onConfirm: () => Promise<void>; onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="form">
        <p>{message}</p>
        <div className="actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className={`btn ${danger ? "danger" : "primary"}`}
            autoFocus
            onClick={async () => {
              await onConfirm();
              onClose();
            }}
          >
            {action}
          </button>
        </div>
      </div>
    </Modal>
  );
}
