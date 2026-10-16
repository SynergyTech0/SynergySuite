"use client";

// Google-style share dialog: per-person roles + company access. Reused by every
// editor in the suite (docs, sheets, slides) so sharing looks/works identically.
import { useEffect, useState } from "react";

type Grant = { email: string; role: string };
const ROLE_OPTS = [
  { v: "viewer", l: "Viewer" },
  { v: "commenter", l: "Commenter" },
  { v: "editor", l: "Editor" },
];

export default function ShareDialog({
  docId,
  meEmail,
  onScope,
  onClose,
}: {
  docId: string;
  meEmail: string;
  onScope?: (s: "private" | "company") => void;
  onClose: () => void;
}) {
  const [companyRole, setCompanyRole] = useState<string>("none");
  const [grants, setGrants] = useState<Grant[]>([]);
  const [owner, setOwner] = useState(meEmail);
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState("editor");
  const [err, setErr] = useState("");

  const load = async () => {
    const res = await fetch(`/api/docs/${docId}/share`);
    if (res.ok) {
      const d = await res.json();
      setCompanyRole(d.company_role || "none");
      setGrants(d.grants ?? []);
      if (d.owner_email) setOwner(d.owner_email);
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const setCompany = async (role: string) => {
    setCompanyRole(role);
    await fetch(`/api/docs/${docId}/share`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyRole: role }),
    });
    onScope?.(role === "none" ? "private" : "company");
  };

  const setPerson = async (email: string, role: string) => {
    const res = await fetch(`/api/docs/${docId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    if (!res.ok) {
      setErr((await res.json().catch(() => ({}))).error || "Could not update");
      return;
    }
    setErr("");
    load();
  };

  const add = async () => {
    const email = addEmail.trim().toLowerCase();
    if (!email.includes("@")) {
      setErr("Enter a valid email");
      return;
    }
    setAddEmail("");
    await setPerson(email, addRole);
  };

  const roleSelect = "text-xs border border-slate-200 rounded-md px-1.5 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300";

  return (
    <div className="fixed inset-0 z-40 bg-slate-900/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Share</h2>
          <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700">✕</button>
        </div>

        <div className="flex gap-2 mb-3">
          <input
            value={addEmail}
            onChange={(e) => setAddEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Add people by email"
            className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <select value={addRole} onChange={(e) => setAddRole(e.target.value)} className={roleSelect}>
            {ROLE_OPTS.map((r) => (
              <option key={r.v} value={r.v}>{r.l}</option>
            ))}
          </select>
          <button onClick={add} className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-3">Add</button>
        </div>
        {err && <p className="text-xs text-red-500 mb-2">{err}</p>}

        <div className="space-y-1.5 mb-4 max-h-52 overflow-y-auto">
          <div className="flex items-center gap-2 text-sm">
            <span className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 grid place-items-center text-xs font-bold">{(owner[0] || "?").toUpperCase()}</span>
            <span className="text-slate-700 truncate">{owner}{owner === meEmail ? " (you)" : ""}</span>
            <span className="ml-auto text-xs text-slate-400">Owner</span>
          </div>
          {grants.map((g) => (
            <div key={g.email} className="flex items-center gap-2 text-sm">
              <span className="w-7 h-7 rounded-full bg-slate-100 text-slate-600 grid place-items-center text-xs font-bold">{(g.email[0] || "?").toUpperCase()}</span>
              <span className="text-slate-700 truncate">{g.email}</span>
              <select value={g.role} onChange={(e) => setPerson(g.email, e.target.value)} className={`${roleSelect} ml-auto`}>
                {ROLE_OPTS.map((r) => (
                  <option key={r.v} value={r.v}>{r.l}</option>
                ))}
                <option value="none">Remove</option>
              </select>
            </div>
          ))}
        </div>

        <div className="border-t border-slate-100 pt-3">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center text-sm">🏢</span>
            <div>
              <div className="text-sm text-slate-800">Everyone at your company</div>
              <div className="text-[11px] text-slate-400">Anyone signed in to your company</div>
            </div>
            <select value={companyRole} onChange={(e) => setCompany(e.target.value)} className={`${roleSelect} ml-auto`}>
              <option value="none">No access</option>
              {ROLE_OPTS.map((r) => (
                <option key={r.v} value={r.v}>{r.l}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="text-sm bg-slate-100 hover:bg-slate-200 rounded-lg px-4 py-2 text-slate-700">Done</button>
        </div>
      </div>
    </div>
  );
}
