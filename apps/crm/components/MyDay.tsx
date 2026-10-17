"use client";
// My Day: open tasks, events and calls assigned to me, by when they are due (in this browser's time zone).
import { Circle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { bucketMyDay } from "@/lib/myday";
import { label, type Activity, type RecordType } from "@/lib/types";
import { api, formatDateTime, type View } from "./client";
import type { AppCtx } from "./shared";
import { TYPE_ICON } from "./Timeline";

const VIEW_OF: Record<RecordType, View> = { account: "accounts", contact: "contacts", lead: "leads", opportunity: "opportunities", partner: "partners" };
const SECTIONS = [["overdue", "Overdue"], ["today", "Today"], ["upcoming", "Upcoming"], ["noDate", "No date"]] as const;

export function MyDay({ app }: { app: AppCtx }) {
  const [items, setItems] = useState<Activity[] | null>(null);
  const load = useCallback(async () => setItems(await api<Activity[]>("/api/activities?mine=1")), []);
  useEffect(() => {
    void load().catch((e) => app.say(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- app.version refreshes after changes elsewhere
  }, [load, app.version]);

  const complete = async (a: Activity) => {
    setItems((xs) => xs?.filter((x) => x.id !== a.id) ?? xs);
    try {
      await api(`/api/activities/${a.id}`, { method: "PATCH", json: { status: "completed" } });
      app.say(`Completed "${a.subject}"`);
      app.changed();
    } catch (e) {
      app.say((e as Error).message);
      void load();
    }
  };

  const today = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  const buckets = items ? bucketMyDay(items, new Date()) : null;
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="pagehead">
        <div>
          <h1>My Day</h1>
          <p className="muted" style={{ margin: "2px 0 0" }}>{today}</p>
        </div>
      </div>
      {!buckets ? <p className="muted">Loading…</p> : items!.length === 0 ? (
        <div className="empty">
          <p>Nothing open is assigned to you.</p>
          <p className="small">Log a task, call or event on a lead, account, contact or deal and it shows up here.</p>
        </div>
      ) : SECTIONS.map(([key, title]) => buckets[key].length ? (
        <section key={key} className={`bucket ${key}`} aria-label={title}>
          <h3>{title} <span>({buckets[key].length})</span></h3>
          {buckets[key].map((a) => (
            <div key={a.id} className="task">
              <button className="checkbtn" aria-label={`Complete ${a.subject}`} title="Mark complete" onClick={() => complete(a)}>
                <Circle size={20} />
              </button>
              <div className="grow">
                <span className="tlsubject">{a.subject}</span>
                <span className="tlmeta">
                  <span style={{ display: "inline-flex", verticalAlign: "-2px", marginRight: 4 }}>{TYPE_ICON[a.type]}</span>
                  {label(a.type)} · {label(a.relatedType)}:{" "}
                  <button className="link" onClick={() => app.go(VIEW_OF[a.relatedType], a.relatedId)}>{a.relatedName || "(deleted)"}</button>
                  {a.dueAt ? <> · <span className={`due${key === "overdue" ? " late" : ""}`}>{formatDateTime(a.dueAt)}</span></> : null}
                </span>
                {a.body ? <span className="tlbody small">{a.body}</span> : null}
              </div>
            </div>
          ))}
        </section>
      ) : null)}
    </div>
  );
}
