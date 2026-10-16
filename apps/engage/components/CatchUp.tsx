"use client";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { RichText } from "./bits";
import { api } from "./client";
import { Modal } from "./Modal";

/** Asks the suite's AI model what happened this week, in the feed or in one community. */
export function CatchUp({ community, label }: { community?: string; label: React.ReactNode }) {
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const run = () => {
    setOpen(true);
    setText(null);
    api<{ text: string }>("/api/ai", { method: "POST", json: { action: "catchup", community } }).then(
      (r) => setText(r.text),
      (e) => setText((e as Error).message),
    );
  };
  return (
    <>
      <button className="btn small" onClick={run}>{label}</button>
      {open && (
        <Modal title="This week" onClose={() => setOpen(false)} wide>
          <div className="form">
            {text === null ? <p className="muted"><Sparkles size={14} /> Reading the week&apos;s posts…</p> : <RichText text={text} />}
            <p className="muted small">Written by AI from posts you can see. Check anything important in the posts themselves.</p>
          </div>
        </Modal>
      )}
    </>
  );
}
