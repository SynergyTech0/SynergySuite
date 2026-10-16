"use client";
import { useEffect, useRef, useState } from "react";
import type { Person } from "@/lib/types";
import { Avatar } from "./Avatar";
import { api } from "./client";
import { Modal } from "./Modal";

type Fields = Pick<Person, "name" | "jobTitle" | "department" | "office" | "phone" | "mobile" | "manager" | "about">;

/** What everyone in the organization sees about you in the directory. */
export function ProfileDialog({ me, onClose, onSaved }: { me: { email: string; name: string }; onClose: () => void; onSaved: () => void }) {
  const [p, setP] = useState<Person | null>(null);
  const [error, setError] = useState("");
  const [stamp, setStamp] = useState(0);
  const photoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<Person>("/api/profile").then(setP, (e) => setError(e.message));
  }, []);

  const set = (k: keyof Fields, v: string) => setP((x) => (x ? { ...x, [k]: v } : x));
  const field = (k: keyof Fields, label: string, type = "text") => (
    <label>
      <span>{label}</span>
      <input type={type} value={p?.[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
    </label>
  );

  const photo = async (file: File | null) => {
    try {
      await api("/api/profile/photo", { method: file ? "PUT" : "DELETE", body: file ?? undefined });
      setP((x) => (x ? { ...x, hasPhoto: !!file } : x));
      setStamp(Date.now());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal title="My profile" onClose={onClose} wide>
      {!p ? (
        <div className="form"><p className="error">{error}</p>{!error && <p className="muted">Loading…</p>}</div>
      ) : (
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("/api/profile", { method: "PUT", json: p });
              onSaved();
              onClose();
            } catch (x) {
              setError((x as Error).message);
            }
          }}
        >
          <div className="cardhead">
            <Avatar name={p.name || me.name} size={64} src={p.hasPhoto ? `/api/directory/${encodeURIComponent(me.email)}/photo?v=${stamp}` : null} />
            <div>
              <p><strong>{me.email}</strong></p>
              <p className="small muted">Everyone in your organization can see this.</p>
              <button type="button" className="linkbtn small" onClick={() => photoRef.current?.click()}>{p.hasPhoto ? "Change photo" : "Add photo"}</button>
              {p.hasPhoto && <button type="button" className="linkbtn small" onClick={() => void photo(null)}>Remove</button>}
              <input ref={photoRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" hidden onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void photo(f);
              }} />
            </div>
          </div>
          <div className="grid2">
            {field("name", "Name")}
            {field("jobTitle", "Job title")}
            {field("department", "Department")}
            {field("office", "Office")}
            {field("phone", "Work phone", "tel")}
            {field("mobile", "Mobile", "tel")}
          </div>
          {field("manager", "Manager's email", "email")}
          <label>
            <span>About me</span>
            <textarea rows={3} value={p.about} onChange={(e) => set("about", e.target.value)} />
          </label>
          <p className="error" role="alert">{error}</p>
          <div className="actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary">Save</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
