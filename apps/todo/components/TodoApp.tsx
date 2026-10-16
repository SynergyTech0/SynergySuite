"use client";
import {
  Bell, CalendarDays, ChevronDown, ChevronRight, Circle, CircleCheck, House, Lightbulb, List as ListIcon, MoreHorizontal,
  Pencil, Plus, Repeat as RepeatIcon, Search, Share2, Star, Sun, Trash2, UserRound, LogOut, StickyNote,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Counts, List, SmartView, Task } from "@/lib/types";
import { COLOR_HEX, api, dueLabel, longDate, person, REPEAT_LABELS, timeLabel, todayStr } from "./client";
import { Confirm, Prompt } from "./Modal";
import { ShareDialog } from "./ShareDialog";
import { TaskDetails } from "./TaskDetails";

type Sel = { kind: "smart"; view: SmartView } | { kind: "list"; id: string };

const SMART: { view: SmartView; label: string; icon: React.ReactNode }[] = [
  { view: "myday", label: "My Day", icon: <Sun size={18} /> },
  { view: "important", label: "Important", icon: <Star size={18} /> },
  { view: "planned", label: "Planned", icon: <CalendarDays size={18} /> },
  { view: "assigned", label: "Assigned to me", icon: <UserRound size={18} /> },
  { view: "all", label: "All tasks", icon: <House size={18} /> },
];

export function TodoApp({ me }: { me: { email: string; name: string } }) {
  const [today, setToday] = useState(todayStr);
  const [sel, setSel] = useState<Sel>({ kind: "smart", view: "myday" });
  const [lists, setLists] = useState<List[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showDone, setShowDone] = useState(true);
  const [dialog, setDialog] = useState<React.ReactNode>(null);
  const [menu, setMenu] = useState(false);
  const [suggest, setSuggest] = useState<Task[] | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const addRef = useRef<HTMLInputElement>(null);

  const say = useCallback((text: string, undo?: () => void) => {
    setToast({ text, undo });
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 5000);
  }, []);

  // My Day turns over at midnight, wherever the browser is.
  useEffect(() => {
    const t = window.setInterval(() => setToday(todayStr()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const loadLists = useCallback(async () => {
    const r = await api<{ lists: List[]; counts: Counts }>(`/api/lists?today=${today}`);
    setLists(r.lists);
    setCounts(r.counts);
  }, [today]);

  const loadTasks = useCallback(async () => {
    const p = new URLSearchParams({ today });
    if (query) p.set("q", query);
    // Search looks through every list.
    if (query) p.set("view", "all");
    else if (sel.kind === "list") p.set("list", sel.id);
    else p.set("view", sel.view);
    setTasks(await api<Task[]>(`/api/tasks?${p}`));
  }, [sel, today, query]);

  const reload = useCallback(async () => {
    await Promise.all([loadLists(), loadTasks()]);
  }, [loadLists, loadTasks]);

  useEffect(() => {
    void loadLists().catch((e) => say(e.message));
  }, [loadLists, say]);

  useEffect(() => {
    const t = window.setTimeout(() => void loadTasks().catch((e) => say(e.message)), query ? 200 : 0);
    return () => window.clearTimeout(t);
  }, [loadTasks, query, say]);

  useEffect(() => {
    setTasks(null);
    setSuggest(null);
    setMenu(false);
  }, [sel]);

  // A link to one task (suite search links /?list=…&task=…) opens its list with the task open.
  useEffect(() => {
    const u = new URL(location.href);
    const listId = u.searchParams.get("list");
    const taskId = u.searchParams.get("task");
    if (!listId && !taskId) return;
    if (listId) setSel({ kind: "list", id: listId });
    if (taskId) setOpenId(taskId);
    history.replaceState(null, "", "/");
  }, []);

  // Shared lists change under you: refresh when the tab comes back.
  useEffect(() => {
    const onFocus = () => void reload().catch(() => {});
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);

  // Reminders: ask the server every 30 seconds; it hands each one out once.
  useEffect(() => {
    const check = async () => {
      try {
        const due = await api<{ id: string; title: string; listName: string }[]>("/api/reminders", { method: "POST", json: {} });
        for (const r of due) {
          say(`Reminder: ${r.title}`);
          if ("Notification" in window && Notification.permission === "granted") {
            const n = new Notification(r.title, { body: `Reminder from ${r.listName}`, tag: r.id, icon: "/app-icon.svg" });
            n.onclick = () => {
              window.focus();
              setOpenId(r.id);
            };
          }
        }
      } catch {
        // offline or signed out: try again next time
      }
    };
    void check();
    const t = window.setInterval(check, 30_000);
    return () => window.clearInterval(t);
  }, [say]);

  const list = sel.kind === "list" && !query ? lists.find((l) => l.id === sel.id) : undefined;
  const smart = sel.kind === "smart" ? SMART.find((s) => s.view === sel.view)! : undefined;
  const title = query ? `Searching for “${query}”` : list?.name ?? smart?.label ?? "";
  const accent = list ? COLOR_HEX[list.color] : "#0f6cbd";
  const shared = lists.filter((l) => l.members.length > 0 || l.owner !== me.email);
  const openTask = tasks?.find((t) => t.id === openId) ?? null;

  const patch = useCallback(
    async (t: Task, change: Partial<Record<string, unknown>>) => {
      // Show the change at once; the server's answer replaces it.
      setTasks((ts) => ts?.map((x) => (x.id === t.id ? ({ ...x, ...change } as Task) : x)) ?? ts);
      try {
        const r = await api<Task & { next?: Task }>(`/api/tasks/${t.id}`, { method: "PATCH", json: { ...change, today } });
        if (r.next) say(`Repeats: the next one is due ${dueLabel(r.next.due!, today)}`);
        await reload();
        return r;
      } catch (e) {
        say((e as Error).message);
        await loadTasks();
      }
    },
    [today, reload, loadTasks, say],
  );

  const complete = (t: Task) => {
    const done = !t.completedAt;
    void patch(t, { completed: done, completedAt: done ? new Date().toISOString() : null });
    if (done) {
      say(`Completed “${t.title}”`, () => void patch({ ...t, completedAt: new Date().toISOString() }, { completed: false, completedAt: null }));
    }
  };

  const add = async (raw: string) => {
    const titleText = raw.trim();
    if (!titleText) return;
    const body: Record<string, unknown> = { title: titleText, today };
    if (sel.kind === "list") body.listId = sel.id;
    else if (sel.view === "myday") body.myDay = true;
    else if (sel.view === "important") body.important = true;
    else if (sel.view === "planned") body.due = today;
    const t = await api<Task>("/api/tasks", { method: "POST", json: body });
    if (sel.kind === "smart" && sel.view === "assigned") await api(`/api/tasks/${t.id}`, { method: "PATCH", json: { assignedTo: me.email, today } });
    await reload();
  };

  const remove = (t: Task) =>
    setDialog(
      <Confirm
        title="Delete task?"
        message={<>&ldquo;{t.title}&rdquo; will be deleted for everyone on the list. This can&apos;t be undone.</>}
        action="Delete task"
        danger
        onClose={() => setDialog(null)}
        onConfirm={async () => {
          await api(`/api/tasks/${t.id}`, { method: "DELETE" });
          if (openId === t.id) setOpenId(null);
          await reload();
        }}
      />,
    );

  const newList = () =>
    setDialog(
      <Prompt
        title="New list"
        label="List name"
        action="Create list"
        onClose={() => setDialog(null)}
        onSubmit={async (name) => {
          const l = await api<List>("/api/lists", { method: "POST", json: { name } });
          await loadLists();
          setSel({ kind: "list", id: l.id });
          setTimeout(() => addRef.current?.focus(), 50);
        }}
      />,
    );

  const open = (tasks ?? []).filter((t) => !t.completedAt);
  const done = (tasks ?? []).filter((t) => t.completedAt);

  // Planned is grouped by when things are due.
  const groups = useMemo(() => {
    if (!(sel.kind === "smart" && sel.view === "planned") || query) return null;
    const out: { label: string; tasks: Task[] }[] = [];
    const push = (label: string, t: Task) => {
      const g = out.find((x) => x.label === label);
      if (g) g.tasks.push(t);
      else out.push({ label, tasks: [t] });
    };
    for (const t of open) {
      const d = t.due;
      if (!d) continue; // still showing the last list's tasks while this one loads
      if (d < today) push("Earlier", t);
      else if (d === today) push("Today", t);
      else push(dueLabel(d, today) === "Tomorrow" ? "Tomorrow" : d <= weekEnd(today) ? "This week" : "Later", t);
    }
    return out;
  }, [open, sel, today, query]);

  const row = (t: Task) => (
    <TaskRow
      key={t.id}
      t={t}
      today={today}
      me={me.email}
      showList={sel.kind === "smart" || !!query}
      open={openId === t.id}
      onOpen={() => setOpenId(t.id)}
      onComplete={() => complete(t)}
      onStar={() => void patch(t, { important: !t.important })}
    />
  );

  return (
    <div className={`todo${openTask ? " withdetails" : ""}`} style={{ "--list": accent } as React.CSSProperties}>
      <nav className="nav" aria-label="Lists">
        <label className="search">
          <Search size={16} />
          <input type="search" placeholder="Search" aria-label="Search tasks" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {SMART.map((s) => (
          <button
            key={s.view}
            className={`navitem${sel.kind === "smart" && sel.view === s.view && !query ? " active" : ""}`}
            aria-current={sel.kind === "smart" && sel.view === s.view ? "page" : undefined}
            onClick={() => {
              setQuery("");
              setSel({ kind: "smart", view: s.view });
            }}
          >
            {s.icon}
            <span className="grow fname">{s.label}</span>
            {!!counts?.[s.view] && <span className="count">{counts[s.view]}</span>}
          </button>
        ))}
        <hr />
        {lists.map((l) => (
          <button
            key={l.id}
            className={`navitem${sel.kind === "list" && sel.id === l.id && !query ? " active" : ""}`}
            aria-current={sel.kind === "list" && sel.id === l.id ? "page" : undefined}
            onClick={() => {
              setQuery("");
              setSel({ kind: "list", id: l.id });
            }}
          >
            {l.isDefault && l.owner === me.email ? <House size={18} style={{ color: COLOR_HEX[l.color] }} /> : <ListIcon size={18} style={{ color: COLOR_HEX[l.color] }} />}
            <span className="grow fname">{l.name}</span>
            {shared.includes(l) && <Share2 size={13} className="muted" aria-label="Shared" />}
            {!!l.open && <span className="count">{l.open}</span>}
          </button>
        ))}
        <button className="navitem newlist" onClick={newList}>
          <Plus size={18} /> New list
        </button>
      </nav>

      <main className="main">
        <header className="head">
          <div className="titlerow">
            <h1>{title}</h1>
            {list && list.owner === me.email && !list.isDefault && (
              <button className="iconbtn" aria-label="Share list" onClick={() => setDialog(<ShareDialog list={list} me={me.email} onClose={() => setDialog(null)} onChanged={loadLists} />)}>
                <Share2 size={18} />
              </button>
            )}
            {list && (
              <div className="menuwrap">
                <button className="iconbtn" aria-label="List options" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
                  <MoreHorizontal size={18} />
                </button>
                {menu && (
                  <div className="menu" onMouseLeave={() => setMenu(false)}>
                    {list.owner === me.email && !list.isDefault && (
                      <button onClick={() => {
                        setMenu(false);
                        setDialog(<Prompt title="Rename list" label="List name" initial={list.name} action="Rename" onClose={() => setDialog(null)}
                          onSubmit={async (name) => {
                            await api(`/api/lists/${list.id}`, { method: "PATCH", json: { name } });
                            await loadLists();
                          }} />);
                      }}>
                        <Pencil size={16} /> Rename list
                      </button>
                    )}
                    {list.owner === me.email && (
                      <div className="swatches" role="group" aria-label="List color">
                        {Object.entries(COLOR_HEX).map(([name, hex]) => (
                          <button key={name} className={`swatch${list.color === name ? " on" : ""}`} style={{ background: hex }} aria-label={name} aria-pressed={list.color === name}
                            onClick={async () => {
                              await api(`/api/lists/${list.id}`, { method: "PATCH", json: { color: name } });
                              await loadLists();
                            }} />
                        ))}
                      </div>
                    )}
                    <button onClick={() => setShowDone((s) => !s)}>
                      <CircleCheck size={16} /> {showDone ? "Hide completed tasks" : "Show completed tasks"}
                    </button>
                    {list.owner !== me.email && (
                      <button onClick={() => {
                        setMenu(false);
                        setDialog(<Confirm title={`Leave ${list.name}?`} message="You'll stop seeing this list and its tasks." action="Leave list" danger onClose={() => setDialog(null)}
                          onConfirm={async () => {
                            await api(`/api/lists/${list.id}/members?email=${encodeURIComponent(me.email)}`, { method: "DELETE" });
                            setSel({ kind: "smart", view: "myday" });
                            await loadLists();
                          }} />);
                      }}>
                        <LogOut size={16} /> Leave list
                      </button>
                    )}
                    {list.owner === me.email && !list.isDefault && (
                      <button className="dangertext" onClick={() => {
                        setMenu(false);
                        setDialog(<Confirm title={`Delete ${list.name}?`} message={`Its tasks will be deleted${list.members.length ? " for everyone it's shared with" : ""}. This can't be undone.`} action="Delete list" danger onClose={() => setDialog(null)}
                          onConfirm={async () => {
                            await api(`/api/lists/${list.id}`, { method: "DELETE" });
                            setSel({ kind: "smart", view: "myday" });
                            await loadLists();
                          }} />);
                      }}>
                        <Trash2 size={16} /> Delete list
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            <span className="grow" />
            {sel.kind === "smart" && sel.view === "myday" && !query && (
              <button className={`btn ghost${suggest ? " on" : ""}`} onClick={async () => setSuggest(suggest ? null : await api<Task[]>(`/api/suggestions?today=${today}`))}>
                <Lightbulb size={16} /> Suggestions
              </button>
            )}
          </div>
          {sel.kind === "smart" && sel.view === "myday" && !query && <p className="muted">{longDate(today)}</p>}
          {list && list.members.length > 0 && <p className="muted small">Shared with {[list.owner, ...list.members].filter((e) => e !== me.email).map((e) => person(e, me.email)).join(", ")}</p>}
        </header>

        {!query && !(sel.kind === "smart" && sel.view === "all") && (
          <form
            className="addtask"
            onSubmit={async (e) => {
              e.preventDefault();
              const input = addRef.current!;
              const v = input.value;
              input.value = "";
              try {
                await add(v);
              } catch (x) {
                input.value = v;
                say((x as Error).message);
              }
            }}
          >
            <Plus size={20} aria-hidden />
            <input ref={addRef} placeholder={sel.kind === "smart" && sel.view === "myday" ? "Add a task for today" : "Add a task"} aria-label="Add a task" autoComplete="off" />
          </form>
        )}

        <div className="tasks">
          {tasks && !tasks.length && <Empty sel={sel} query={query} />}
          {groups
            ? groups.map((g) => (
                <section key={g.label} aria-label={g.label}>
                  <h3 className={g.label === "Earlier" ? "late" : ""}>{g.label}<span>{g.tasks.length}</span></h3>
                  {g.tasks.map(row)}
                </section>
              ))
            : open.map(row)}
          {done.length > 0 && (
            <section aria-label="Completed">
              <button className="donehead" onClick={() => setShowDone((s) => !s)} aria-expanded={showDone}>
                {showDone ? <ChevronDown size={16} /> : <ChevronRight size={16} />} Completed <span>{done.length}</span>
              </button>
              {showDone && done.map(row)}
            </section>
          )}
        </div>

        {suggest && (
          <aside className="suggest" aria-label="Suggestions">
            <h3>Suggestions</h3>
            {!suggest.length && <p className="muted small">Nothing left over from earlier days, and nothing due today.</p>}
            {suggest.map((t) => (
              <div className="srow" key={t.id}>
                <div className="grow">
                  <div>{t.title}</div>
                  <div className="meta">{t.listName}{t.due && <> · <span className={t.due < today ? "late" : ""}>{dueLabel(t.due, today)}</span></>}</div>
                </div>
                <button className="iconbtn" aria-label={`Add “${t.title}” to My Day`} onClick={async () => {
                  await patch(t, { myDay: true });
                  setSuggest((s) => s?.filter((x) => x.id !== t.id) ?? null);
                }}>
                  <Plus size={18} />
                </button>
              </div>
            ))}
          </aside>
        )}
      </main>

      {openTask && (
        <TaskDetails
          key={openTask.id}
          t={openTask}
          today={today}
          me={me.email}
          lists={lists}
          onPatch={(change) => patch(openTask, change)}
          onReload={reload}
          onDelete={() => remove(openTask)}
          onClose={() => setOpenId(null)}
          onError={say}
        />
      )}

      {dialog}
      {toast && (
        <div className="toast" role="status">
          {toast.text}
          {toast.undo && (
            <button className="linkbtn light" onClick={() => {
              toast.undo!();
              setToast(null);
            }}>Undo</button>
          )}
        </div>
      )}
    </div>
  );
}

function weekEnd(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + (7 - date.getDay()) % 7);
  return todayStr(date);
}

function TaskRow({ t, today, me, showList, open, onOpen, onComplete, onStar }: {
  t: Task; today: string; me: string; showList: boolean; open: boolean; onOpen: () => void; onComplete: () => void; onStar: () => void;
}) {
  const doneSteps = t.steps.filter((s) => s.done).length;
  const meta: React.ReactNode[] = [];
  if (t.myDay && showList) meta.push(<span key="d"><Sun size={12} /> My Day</span>);
  if (showList) meta.push(<span key="l">{t.listName}</span>);
  if (t.steps.length) meta.push(<span key="s">{doneSteps} of {t.steps.length}</span>);
  if (t.due) meta.push(<span key="due" className={!t.completedAt && t.due < today ? "late" : t.due === today ? "today" : ""}><CalendarDays size={12} /> {dueLabel(t.due, today)}</span>);
  if (t.reminderAt && !t.completedAt) meta.push(<span key="r"><Bell size={12} /> {timeLabel(t.reminderAt)}</span>);
  if (t.repeat) meta.push(<span key="rep" aria-label={`Repeats ${t.repeat}`}><RepeatIcon size={12} /></span>);
  if (t.notes) meta.push(<span key="n" aria-label="Has notes"><StickyNote size={12} /></span>);
  if (t.assignedTo) meta.push(<span key="a"><UserRound size={12} /> {person(t.assignedTo, me)}</span>);
  return (
    <div className={`task${open ? " open" : ""}${t.completedAt ? " done" : ""}`}>
      <button className="checkbtn" aria-label={t.completedAt ? `Mark “${t.title}” not completed` : `Complete “${t.title}”`} onClick={onComplete}>
        {t.completedAt ? <CircleCheck size={20} /> : <Circle size={20} />}
      </button>
      <button className="taskbody" onClick={onOpen}>
        <span className="tasktitle">{t.title}</span>
        {meta.length > 0 && <span className="meta">{meta.reduce<React.ReactNode[]>((acc, m, i) => (i ? [...acc, <i key={`dot${i}`}>·</i>, m] : [m]), [])}</span>}
      </button>
      <button className={`iconbtn star${t.important ? " on" : ""}`} aria-label={t.important ? `Remove importance from “${t.title}”` : `Mark “${t.title}” as important`} aria-pressed={t.important} onClick={onStar}>
        <Star size={18} fill={t.important ? "currentColor" : "none"} />
      </button>
    </div>
  );
}

function Empty({ sel, query }: { sel: Sel; query: string }) {
  if (query) return <div className="empty"><Search size={36} strokeWidth={1.4} /><p>No tasks match.</p></div>;
  const text: Record<string, [React.ReactNode, string]> = {
    myday: [<Sun key="i" size={40} strokeWidth={1.4} />, "Focus on your day. Add tasks here, or pick from Suggestions."],
    important: [<Star key="i" size={40} strokeWidth={1.4} />, "Star tasks to see them here."],
    planned: [<CalendarDays key="i" size={40} strokeWidth={1.4} />, "Tasks with due dates show up here."],
    assigned: [<UserRound key="i" size={40} strokeWidth={1.4} />, "Tasks assigned to you in shared lists show up here."],
    all: [<House key="i" size={40} strokeWidth={1.4} />, "Nothing to do. Enjoy it."],
    list: [<ListIcon key="i" size={40} strokeWidth={1.4} />, "Add your first task above."],
  };
  const [icon, line] = text[sel.kind === "list" ? "list" : sel.view];
  return <div className="empty">{icon}<p>{line}</p></div>;
}
