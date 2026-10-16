"use client";
// A record's activity timeline, with the form to log a call, a note, a task or an event.
import { CalendarDays, Check, CheckCircle2, Circle, ListTodo, Phone, StickyNote, Trash2, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ACTIVITY_TYPES, label, type Activity, type ActivityType, type RecordType } from "@/lib/types";
import { api, formatDateTime } from "./client";
import { canReassign, type AppCtx } from "./shared";

export const TYPE_ICON: Record<ActivityType, React.ReactNode> = {
  task: <ListTodo size={15} />, event: <CalendarDays size={15} />, call: <Phone size={15} />, note: <StickyNote size={15} />,
};

function LogForm({ app, relatedType, relatedId, onLogged }: { app: AppCtx; relatedType: RecordType; relatedId: string; onLogged: () => void }) {
  const [type, setType] = useState<ActivityType>("note");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dated = type !== "note";
  return (
    <form
      className="logform"
      aria-label="Log activity"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = e.currentTarget;
        const get = (n: string) => (f.elements.namedItem(n) as HTMLInputElement | null)?.value ?? "";
        const due = get("dueAt");
        setBusy(true);
        setError("");
        try {
          await api("/api/activities", {
            method: "POST",
            json: {
              type, relatedType, relatedId, subject: get("subject"), body: get("body"),
              dueAt: dated && due ? new Date(due).toISOString() : "",
              assignee: get("assignee"),
              // A call logged with no date is one that just happened.
              status: type === "call" && !due ? "completed" : undefined,
            },
          });
          f.reset();
          onLogged();
        } catch (x) {
          setError((x as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="seg" role="group" aria-label="Activity type">
        {ACTIVITY_TYPES.map((t) => (
          <button type="button" key={t} className={type === t ? "on" : ""} aria-pressed={type === t} onClick={() => setType(t)}>
            {TYPE_ICON[t]} {label(t)}
          </button>
        ))}
      </div>
      <div className="logrow">
        <input type="text" name="subject" placeholder={type === "note" ? "Note title" : type === "call" ? "Call about…" : type === "task" ? "What needs doing?" : "Meeting with…"} aria-label="Subject" required maxLength={300} />
        {dated ? <input type="datetime-local" name="dueAt" aria-label="Due" /> : null}
        {dated && canReassign(app.me) ? (
          <select name="assignee" aria-label="Assigned to" defaultValue={app.me.email}>
            {app.members.map((m) => <option key={m.email} value={m.email}>{m.name || m.email}</option>)}
          </select>
        ) : null}
      </div>
      <textarea name="body" rows={2} placeholder="Details (optional)" aria-label="Details" maxLength={5000} />
      <p className="error" role="alert">{error}</p>
      <div className="actions" style={{ margin: 0 }}>
        <button className="btn primary small" disabled={busy}>{busy ? "Saving…" : `Log ${label(type).toLowerCase()}`}</button>
      </div>
    </form>
  );
}

export function Timeline({ app, relatedType, relatedId, readOnly }: { app: AppCtx; relatedType: RecordType; relatedId: string; readOnly?: boolean }) {
  const [items, setItems] = useState<Activity[] | null>(null);
  const load = useCallback(async () => {
    setItems(await api<Activity[]>(`/api/activities?relatedType=${relatedType}&relatedId=${relatedId}`));
  }, [relatedType, relatedId]);
  useEffect(() => {
    setItems(null);
    void load().catch((e) => app.say(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the record changes
  }, [load]);

  const setStatus = async (a: Activity, status: Activity["status"]) => {
    try {
      await api(`/api/activities/${a.id}`, { method: "PATCH", json: { status } });
      await load();
      app.changed();
    } catch (e) {
      app.say((e as Error).message);
    }
  };

  return (
    <section className="panel" aria-label="Activity">
      <h3>Activity</h3>
      {!readOnly ? <LogForm app={app} relatedType={relatedType} relatedId={relatedId} onLogged={() => { void load(); app.changed(); }} /> : null}
      {items === null ? <p className="muted small">Loading…</p> : items.length === 0 ? (
        <p className="muted small" style={{ margin: "10px 0 0" }}>Nothing logged yet.</p>
      ) : (
        <ul className="timeline">
          {items.map((a) => (
            <li key={a.id} className={`tl${a.status === "completed" ? " done" : ""}${a.status === "canceled" ? " canceled" : ""}`}>
              <span className="tlicon" aria-hidden>{a.status === "completed" && a.type !== "note" ? <Check size={15} /> : TYPE_ICON[a.type]}</span>
              <div className="grow">
                <div className="tlsubject">{a.subject}</div>
                <div className="tlmeta">
                  {label(a.type)}
                  {a.type !== "note" ? ` · ${label(a.status)}` : ""}
                  {a.dueAt ? ` · due ${formatDateTime(a.dueAt)}` : ""}
                  {` · ${a.assigneeName}`}
                  {` · logged ${formatDateTime(a.createdAt)}`}
                </div>
                {a.body ? <div className="tlbody">{a.body}</div> : null}
              </div>
              {a.editable ? (
                <div style={{ display: "flex", alignItems: "flex-start" }}>
                  {a.type !== "note" && a.status === "open" ? (
                    <>
                      <button className="iconbtn small" title="Mark complete" aria-label={`Mark ${a.subject} complete`} onClick={() => setStatus(a, "completed")}><CheckCircle2 size={16} /></button>
                      <button className="iconbtn small" title="Cancel" aria-label={`Cancel ${a.subject}`} onClick={() => setStatus(a, "canceled")}><XCircle size={16} /></button>
                    </>
                  ) : a.type !== "note" ? (
                    <button className="iconbtn small" title="Reopen" aria-label={`Reopen ${a.subject}`} onClick={() => setStatus(a, "open")}><Circle size={16} /></button>
                  ) : null}
                  <button
                    className="iconbtn small"
                    title="Delete"
                    aria-label={`Delete ${a.subject}`}
                    onClick={async () => {
                      if (!confirm(`Delete "${a.subject}"?`)) return;
                      try {
                        await api(`/api/activities/${a.id}`, { method: "DELETE" });
                        await load();
                        app.changed();
                      } catch (e) {
                        app.say((e as Error).message);
                      }
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
