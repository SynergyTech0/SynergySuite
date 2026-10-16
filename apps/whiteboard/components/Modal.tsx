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

/** A one-field dialog: rename a board. */
export function Prompt({
  title, label, initial = "", action, onSubmit, onClose, selectStem,
}: {
  title: string; label: string; initial?: string; action: string; selectStem?: boolean;
  onSubmit: (value: string) => Promise<void>; onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const input = form.elements.namedItem("value") as HTMLInputElement;
          const err = form.querySelector(".error") as HTMLElement;
          try {
            await onSubmit(input.value);
            onClose();
          } catch (x) {
            err.textContent = (x as Error).message;
          }
        }}
      >
        <label>
          <span>{label}</span>
          <input
            name="value"
            defaultValue={initial}
            autoFocus
            onFocus={(e) => {
              const dot = e.currentTarget.value.lastIndexOf(".");
              if (selectStem && dot > 0) e.currentTarget.setSelectionRange(0, dot);
              else e.currentTarget.select();
            }}
          />
        </label>
        <p className="error" role="alert" />
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">{action}</button>
        </div>
      </form>
    </Modal>
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
