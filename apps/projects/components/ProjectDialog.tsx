"use client";
import { useEffect, useState } from "react";
import type { Project } from "@/lib/types";
import { BILLINGS, BILLING_LABELS, STATUSES, STATUS_LABELS } from "@/lib/types";
import { amount, api, hrs } from "./client";
import { Modal } from "./Modal";

type Board = { id: string; title: string };

/** New project, or a manager editing one. */
export function ProjectDialog({ project, onSaved, onClose }: { project?: Project; onSaved: (p: Project) => void; onClose: () => void }) {
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [boardError, setBoardError] = useState("");
  const [error, setError] = useState("");
  const [billing, setBilling] = useState(project?.billing ?? "time");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Board[]>("/api/planner/boards").then(setBoards).catch((e) => setBoardError((e as Error).message));
  }, []);

  const save = async (form: HTMLFormElement) => {
    const f = new FormData(form);
    // Only the fields on screen: the rate and the fixed fee swap places with the billing type.
    const body: Record<string, unknown> = {};
    for (const k of ["name", "clientName", "clientEmail", "description", "status", "billing", "currency", "start", "finish",
      "budgetHours", "budget", "defaultRate", "fixedFee", "plannerBoardId"]) {
      if (f.has(k)) body[k] = String(f.get(k) ?? "");
    }
    if (!boards && project) delete body.plannerBoardId;
    setBusy(true);
    setError("");
    try {
      const p = project
        ? await api<Project>(`/api/projects/${project.id}`, { method: "PATCH", json: body })
        : await api<Project>("/api/projects", { method: "POST", json: body });
      onSaved(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={project ? "Project settings" : "New project"} onClose={onClose} wide>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save(e.currentTarget);
        }}
      >
        <label><span>Name</span><input name="name" defaultValue={project?.name} autoFocus required maxLength={200} /></label>
        <div className="row2">
          <label><span>Client</span><input name="clientName" defaultValue={project?.clientName} placeholder="Who the work is for" /></label>
          <label><span>Client billing email</span><input name="clientEmail" type="email" defaultValue={project?.clientEmail} placeholder="Invoices in Books go to this customer" /></label>
        </div>
        <label><span>Description</span><textarea name="description" defaultValue={project?.description} rows={3} /></label>
        <div className="row3">
          <label><span>Status</span>
            <select name="status" defaultValue={project?.status ?? "active"}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </label>
          <label><span>Start</span><input name="start" type="date" defaultValue={project?.start ?? ""} /></label>
          <label><span>Finish</span><input name="finish" type="date" defaultValue={project?.finish ?? ""} /></label>
        </div>
        <div className="row3">
          <label><span>Billing</span>
            <select name="billing" value={billing} onChange={(e) => setBilling(e.target.value as Project["billing"])}>
              {BILLINGS.map((b) => <option key={b} value={b}>{BILLING_LABELS[b]}</option>)}
            </select>
          </label>
          {billing === "fixed" ? (
            <label><span>Fixed fee</span><input name="fixedFee" inputMode="decimal" defaultValue={amount(project?.fixedFeeCents)} /></label>
          ) : (
            <label><span>Default hourly rate</span><input name="defaultRate" inputMode="decimal" defaultValue={amount(project?.defaultRateCents)} placeholder="Unless a person has their own" /></label>
          )}
          <label><span>Currency</span><input name="currency" defaultValue={project?.currency ?? "USD"} maxLength={3} /></label>
        </div>
        <div className="row2">
          <label><span>Budget hours</span><input name="budgetHours" inputMode="decimal" defaultValue={hrs(project?.budgetMinutes)} /></label>
          <label><span>Budget amount</span><input name="budget" inputMode="decimal" defaultValue={amount(project?.budgetCents)} /></label>
        </div>
        <label>
          <span>Planner board</span>
          <select name="plannerBoardId" defaultValue={project?.plannerBoardId ?? ""} disabled={!boards}>
            <option value="">None</option>
            {(boards ?? []).map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
            {project?.plannerBoardId && boards && !boards.some((b) => b.id === project.plannerBoardId) && (
              <option value={project.plannerBoardId}>A board you can&apos;t open</option>
            )}
          </select>
          {boardError && <span>Planner boards aren&apos;t available: {boardError}</span>}
        </label>
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{project ? "Save" : "Create project"}</button>
        </div>
      </form>
    </Modal>
  );
}
