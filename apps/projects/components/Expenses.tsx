"use client";
import { Paperclip, Plus, Send, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Expense, ProjectSummary } from "@/lib/types";
import { EXPENSE_CATEGORIES } from "@/lib/types";
import { api, money, shortDate, todayStr } from "./client";
import { Modal } from "./Modal";
import type { Me } from "./ProjectsApp";

export function Expenses({ projects }: { me: Me; projects: ProjectSummary[] }) {
  const [rows, setRows] = useState<Expense[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Expense | "new" | null>(null);
  const load = useCallback(() => {
    api<Expense[]>("/api/expenses").then(setRows).catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setError("");
    try {
      await fn();
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const open = projects.filter((p) => p.status !== "done" && p.status !== "cancelled");

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>My expenses</h1>
          <p className="sub muted">Costs you paid for a project. Submitted expenses go to the project&apos;s managers; approved billable ones can go on the client&apos;s invoice.</p>
        </div>
        <button className="btn primary" disabled={!open.length} onClick={() => setEditing("new")}><Plus size={15} /> New expense</button>
      </div>
      <div className="body">
        <p className="error" role="alert">{error}</p>
        {!rows ? <p className="muted">Loading…</p> : !rows.length ? <div className="empty">No expenses yet.</div> : (
          <div className="tablewrap">
            <table className="grid">
              <thead><tr><th>Day</th><th>Project</th><th>Category</th><th>Description</th><th className="num">Amount</th><th>Status</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const editable = r.status === "draft" || r.status === "rejected";
                  return (
                    <tr key={r.id} className={editable ? "click" : ""} onClick={() => editable && setEditing(r)}>
                      <td>{shortDate(r.day)}</td>
                      <td><span className="muted small">{r.projectCode}</span> {r.projectName}</td>
                      <td>{r.category}</td>
                      <td className="muted">{r.description}{r.rejectReason && <span className="error"> Sent back: {r.rejectReason}</span>}</td>
                      <td className="num">{money(r.amountCents, r.currency)}</td>
                      <td>{r.invoiced ? <span className="pill billed">Billed</span> : <span className={`pill ${r.status}`}>{r.status[0].toUpperCase() + r.status.slice(1)}</span>}</td>
                      <td className="num" onClick={(e) => e.stopPropagation()}>
                        {r.receiptName && <a className="iconbtn small" title={r.receiptName} aria-label="Open receipt" href={`/api/expenses/${r.id}/receipt`} target="_blank" rel="noreferrer"><Paperclip size={14} /></a>}
                        {editable && <button className="btn small" onClick={() => void act(() => api(`/api/expenses/${r.id}`, { method: "PATCH", json: { status: "submitted" } }))}><Send size={13} /> Submit</button>}
                        {r.status === "submitted" && <button className="btn small" onClick={() => void act(() => api(`/api/expenses/${r.id}`, { method: "PATCH", json: { status: "draft" } }))}><Undo2 size={13} /> Take back</button>}
                        {editable && <button className="iconbtn small" aria-label="Delete expense" onClick={() => window.confirm("Delete this expense?") && void act(() => api(`/api/expenses/${r.id}`, { method: "DELETE" }))}><Trash2 size={14} /></button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing && <ExpenseDialog expense={editing === "new" ? null : editing} projects={open} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </>
  );
}

function ExpenseDialog({ expense, projects, onClose, onSaved }: { expense: Expense | null; projects: ProjectSummary[]; onClose: () => void; onSaved: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={expense ? "Edit expense" : "New expense"} onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const file = f.get("receipt") as File | null;
          const body = {
            projectId: f.get("projectId"), day: f.get("day"), category: f.get("category"), amount: f.get("amount"),
            description: f.get("description"), billable: f.get("billable") === "on",
          };
          setBusy(true);
          setError("");
          try {
            const saved = expense
              ? await api<Expense>(`/api/expenses/${expense.id}`, { method: "PATCH", json: body })
              : await api<Expense>("/api/expenses", { method: "POST", json: body });
            if (file && file.size) {
              await api(`/api/expenses/${saved.id}/receipt?name=${encodeURIComponent(file.name)}`, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
            }
            if (f.get("submit") === "on") await api(`/api/expenses/${saved.id}`, { method: "PATCH", json: { status: "submitted" } });
            onSaved();
          } catch (x) {
            setError((x as Error).message);
            setBusy(false);
          }
        }}
      >
        <label><span>Project</span>
          <select name="projectId" defaultValue={expense?.projectId ?? projects[0]?.id} disabled={!!expense}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}
          </select>
        </label>
        <div className="row2">
          <label><span>Date</span><input name="day" type="date" defaultValue={expense?.day ?? todayStr()} required /></label>
          <label><span>Amount</span><input name="amount" inputMode="decimal" defaultValue={expense ? String(expense.amountCents / 100) : ""} required autoFocus /></label>
        </div>
        <label><span>Category</span>
          <select name="category" defaultValue={expense?.category ?? "Travel"}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label><span>Description</span><input name="description" defaultValue={expense?.description} maxLength={1000} /></label>
        <label><span>Receipt (picture or PDF, up to 10 MB){expense?.receiptName ? `: ${expense.receiptName} attached` : ""}</span><input name="receipt" type="file" accept="image/*,application/pdf" /></label>
        <label className="check"><input name="billable" type="checkbox" defaultChecked={expense?.billable ?? true} /> Bill it to the client</label>
        {!expense && <label className="check"><input name="submit" type="checkbox" /> Submit it for approval now</label>}
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>Save</button>
        </div>
      </form>
    </Modal>
  );
}
