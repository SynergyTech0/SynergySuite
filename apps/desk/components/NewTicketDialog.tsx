"use client";
import { useState } from "react";
import { PRIORITIES, type Ticket } from "@/lib/types";
import { api, cap } from "./client";
import { Modal } from "./Modal";

// A ticket staff open by hand, e.g. for a phone call, or (self) one someone opens for themselves.
// It isn't emailed to anyone.
export function NewTicketDialog({ onClose, onCreated, self = false }: { onClose: () => void; onCreated: (t: Ticket) => Promise<void>; self?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title={self ? "New request" : "New ticket"} onClose={onClose} wide>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            const t = await api<Ticket>("/api/tickets", {
              method: "POST",
              json: {
                subject: f.get("subject"), requesterEmail: f.get("email"), requesterName: f.get("name"),
                priority: f.get("priority"), body: f.get("body"),
              },
            });
            await onCreated(t);
          } catch (x) {
            setError((x as Error).message);
            setBusy(false);
          }
        }}
      >
        <label><span>Subject</span><input name="subject" required autoFocus maxLength={300} /></label>
        {!self && (
          <div className="grid2">
            <label><span>Requester email</span><input name="email" type="email" required /></label>
            <label><span>Requester name</span><input name="name" /></label>
          </div>
        )}
        <label>
          <span>Priority</span>
          <select name="priority" defaultValue="normal">
            {PRIORITIES.map((p) => <option key={p} value={p}>{cap(p)}</option>)}
          </select>
        </label>
        <label><span>Description</span><textarea name="body" rows={6} placeholder={self ? "What do you need?" : "What does the requester need?"} /></label>
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{self ? "Send request" : "Create ticket"}</button>
        </div>
      </form>
    </Modal>
  );
}
