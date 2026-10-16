"use client";
// Matters (eDiscovery cases): the list, and one matter with its holds, saved searches and exports.
import { Download, FileArchive, Gavel, Pencil, Play, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ExportRecord, HoldRecord, Matter, MatterDetail, SavedSearch } from "@/lib/types";
import { api, formatDate, formatDateTime, formatSize, plural } from "./client";
import { Confirm, Modal } from "./Modal";
import { AppPicker, Badge, Facts, PeoplePicker, appLabel, appsText, type AppCtx } from "./shared";

export function Matters({ app }: { app: AppCtx }) {
  const [list, setList] = useState<Matter[] | null>(null);
  const [status, setStatus] = useState<"open" | "closed" | "">("open");
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    void api<Matter[]>(`/api/matters${status ? `?status=${status}` : ""}`).then(setList).catch((e) => app.say(e.message));
  }, [app, status]);

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Matters</h1>
          <p className="muted">
            {app.me.role === "admin" ? "Every eDiscovery case in the organization." : "The eDiscovery cases you own or are a member of."} Each one holds its legal holds, searches and exports.
          </p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> New matter</button>
      </div>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Show">
          {([["open", "Open"], ["closed", "Closed"], ["", "All"]] as const).map(([v, t]) => (
            <button key={t} className={status === v ? "on" : ""} aria-pressed={status === v} onClick={() => setStatus(v)}>{t}</button>
          ))}
        </div>
      </div>
      <section className="panel flush">
        <div className="tablewrap">
          <table className="table">
            <thead><tr><th>Matter</th><th>Status</th><th>Owner</th><th className="num">Active holds</th><th className="num">On hold</th><th>Opened</th></tr></thead>
            <tbody>
              {!list ? <tr><td colSpan={6} className="muted">Loading…</td></tr>
                : !list.length ? (
                  <tr><td colSpan={6}>
                    <div className="empty">
                      <p><strong>No {status || ""} matters.</strong></p>
                      <p>Open a matter for each legal case or investigation, then place holds on the people involved and search their content.</p>
                    </div>
                  </td></tr>
                ) : list.map((m) => (
                  <tr key={m.id} className="click" onClick={() => app.go({ view: "matters", id: m.id })}>
                    <td>
                      <div className="cellstack">
                        <a className="rname link" href={`#/matters/${m.id}`} onClick={(e) => e.stopPropagation()}>{m.name}</a>
                        {m.description ? <span className="rsub clip">{m.description}</span> : null}
                      </div>
                    </td>
                    <td><StatusBadge status={m.status} /></td>
                    <td className="clip">{m.owner}</td>
                    <td className="num">{m.activeHolds}</td>
                    <td className="num">{m.custodians}</td>
                    <td className="muted nowrap">{formatDate(m.createdAt)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
      {creating ? <MatterEditor app={app} onClose={() => setCreating(false)} onSaved={(m) => { setCreating(false); app.go({ view: "matters", id: m.id }); }} /> : null}
    </div>
  );
}

export function StatusBadge({ status }: { status: "open" | "closed" }) {
  return status === "open" ? <Badge tone="blue">Open</Badge> : <Badge>Closed</Badge>;
}

function MatterEditor({ app, matter, onClose, onSaved }: { app: AppCtx; matter?: Matter; onClose: () => void; onSaved: (m: Matter) => void }) {
  const [members, setMembers] = useState<string[]>(matter?.members ?? []);
  const [error, setError] = useState("");
  return (
    <Modal title={matter ? "Edit matter" : "New matter"} onClose={onClose} wide>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const json: Record<string, unknown> = { name: f.get("name"), description: f.get("description"), members };
          if (matter && f.get("owner")) json.owner = f.get("owner");
          try {
            onSaved(await api<Matter>(matter ? `/api/matters/${matter.id}` : "/api/matters", { method: matter ? "PATCH" : "POST", json }));
          } catch (x) {
            setError((x as Error).message);
          }
        }}
      >
        <label><span>Name</span><input name="name" required defaultValue={matter?.name} autoFocus placeholder="e.g. Northwind contract dispute" /></label>
        <label><span>Description</span><textarea name="description" rows={3} defaultValue={matter?.description} placeholder="What the case is about, the counsel involved, reference numbers" /></label>
        {matter ? <label><span>Owner</span><input name="owner" type="email" defaultValue={matter.owner} /></label> : null}
        <label>
          <span>Members (eDiscovery managers who work on it)</span>
          <PeoplePicker label="Members" value={members} onChange={setMembers} />
        </label>
        <p className="muted small">Admins see every matter. An eDiscovery manager sees only the matters they own or are a member of.</p>
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">{matter ? "Save" : "Create matter"}</button>
        </div>
      </form>
    </Modal>
  );
}

const TABS = [["overview", "Overview"], ["holds", "Holds"], ["searches", "Searches"], ["exports", "Exports"]] as const;

export function MatterView({ app, id, tab }: { app: AppCtx; id: string; tab: string | null }) {
  const [m, setM] = useState<MatterDetail | null>(null);
  const [missing, setMissing] = useState("");
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [holdEdit, setHoldEdit] = useState<HoldRecord | "new" | null>(null);
  const [releasing, setReleasing] = useState<HoldRecord | null>(null);
  const current = TABS.some(([t]) => t === tab) ? tab! : "overview";

  const load = useCallback(() => {
    void api<MatterDetail>(`/api/matters/${id}`).then(setM).catch((e) => setMissing(e.message));
  }, [id]);
  useEffect(load, [load]);

  // Exports run in the background; watch them until they finish.
  const busy = m?.exports.some((e) => e.status === "pending" || e.status === "running");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [busy, load]);

  if (missing) return <div className="page"><div className="empty"><p><strong>{missing}</strong></p><a className="link" href="#/matters">All matters</a></div></div>;
  if (!m) return <p className="muted pad">Loading…</p>;
  const open = m.status === "open";
  const activeHolds = m.holds.filter((h) => h.active);

  const startExport = async (s: SavedSearch) => {
    try {
      await api(`/api/searches/${s.id}/export`, { method: "POST" });
      app.say("Export started; it runs in the background");
      app.go({ view: "matters", id: m.id, tab: "exports" });
      load();
    } catch (e) {
      app.say((e as Error).message);
    }
  };

  return (
    <div className="page">
      <div className="crumbs"><a href="#/matters">Matters</a> <span>/</span> <span>{m.name}</span></div>
      <div className="pagehead">
        <div>
          <h1>{m.name} <StatusBadge status={m.status} /></h1>
          <p className="muted">Owned by {m.owner} · opened {formatDate(m.createdAt)}{m.closedAt ? ` · closed ${formatDate(m.closedAt)} by ${m.closedBy}` : ""}</p>
        </div>
        <div className="toolbar">
          <button className="btn" onClick={() => setEditing(true)}><Pencil size={15} /> Edit</button>
          {open ? <button className="btn" onClick={() => setClosing(true)}>Close matter</button>
            : <button className="btn" onClick={async () => { try { await api(`/api/matters/${m.id}`, { method: "PATCH", json: { status: "open" } }); app.say("Matter reopened"); load(); } catch (e) { app.say((e as Error).message); } }}>Reopen</button>}
        </div>
      </div>
      <nav className="tabs" aria-label="Matter">
        {TABS.map(([t, text]) => (
          <a key={t} href={`#/matters/${m.id}/${t}`} className={current === t ? "on" : ""} aria-current={current === t ? "page" : undefined}>
            {text}
            {t === "holds" ? <span className="count">{activeHolds.length}</span> : t === "searches" ? <span className="count">{m.searches.length}</span> : t === "exports" ? <span className="count">{m.exports.length}</span> : null}
          </a>
        ))}
      </nav>

      {!open ? <div className="notice"><div><p>This matter is closed, so its holds no longer keep anything. Reopen it to make them apply again.</p></div></div> : null}

      {current === "overview" ? (
        <>
          <section className="panel">
            <h3>About</h3>
            <Facts items={[
              ["Description", m.description ? <span className="pre">{m.description}</span> : ""],
              ["Owner", m.owner],
              ["Members", m.members.length ? m.members.join(", ") : <span className="muted">Only the owner</span>],
              ["Created by", `${m.createdBy}, ${formatDateTime(m.createdAt)}`],
            ]} />
          </section>
          <div className="stats">
            <a className="stat" href={`#/matters/${m.id}/holds`}><div className="k">Active holds</div><div className="v">{activeHolds.length}</div><div className="s">{plural(m.custodians, "person", "people")} on hold</div></a>
            <a className="stat" href={`#/matters/${m.id}/searches`}><div className="k">Saved searches</div><div className="v">{m.searches.length}</div></a>
            <a className="stat" href={`#/matters/${m.id}/exports`}><div className="k">Exports</div><div className="v">{m.exports.length}</div><div className="s">{m.exports.filter((e) => e.status === "done").length} ready to download</div></a>
            <div className="stat"><div className="k">Released holds</div><div className="v">{m.holds.length - activeHolds.length}</div><div className="s">Kept on record</div></div>
          </div>
        </>
      ) : null}

      {current === "holds" ? (
        <section className="panel flush">
          <h3>Holds {open ? <button className="btn small primary" onClick={() => setHoldEdit("new")}><Gavel size={14} /> Place a hold</button> : null}</h3>
          <HoldTable app={app} holds={m.holds} onEdit={(h) => setHoldEdit(h)} onRelease={(h) => setReleasing(h)} />
        </section>
      ) : null}

      {current === "searches" ? (
        <section className="panel flush">
          <h3>Saved searches <a className="btn small primary" href="#/search"><Search size={14} /> New search</a></h3>
          {!m.searches.length ? (
            <div className="empty"><p>Run a content search and choose <strong>Save to matter</strong> to keep it here, then export what it finds.</p></div>
          ) : (
            <div className="tablewrap">
              <table className="table">
                <thead><tr><th>Search</th><th>Custodians</th><th>Apps</th><th>Dates</th><th className="num">Found</th><th /></tr></thead>
                <tbody>
                  {m.searches.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <div className="cellstack">
                          <span className="rname">{s.name}</span>
                          <span className="rsub">{s.query ? <code>{s.query}</code> : "No keywords"} · saved by {s.createdBy}, {formatDate(s.createdAt)}</span>
                        </div>
                      </td>
                      <td className="clip">{s.custodians.length ? s.custodians.join(", ") : <span className="muted">Everyone</span>}</td>
                      <td className="clip">{appsText(app, s.apps)}</td>
                      <td className="nowrap">{s.from || s.to ? `${s.from ? formatDate(s.from) : "…"} – ${s.to ? formatDate(s.to) : "…"}` : <span className="muted">Any</span>}</td>
                      <td className="num">{Object.values(s.counts).reduce((a, b) => a + b, 0).toLocaleString()}</td>
                      <td className="num nowrap">
                        <a className="btn small" href={`#/search/${s.id}`}><Play size={13} /> Run</a>{" "}
                        <button className="btn small" onClick={() => startExport(s)}><FileArchive size={13} /> Export</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {current === "exports" ? (
        <section className="panel flush">
          <h3>Exports</h3>
          <ExportTable app={app} exports={m.exports} />
        </section>
      ) : null}

      {editing ? <MatterEditor app={app} matter={m} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); app.say("Saved"); load(); }} /> : null}
      {closing ? (
        <Confirm
          title="Close this matter?"
          action="Close matter"
          danger={activeHolds.length > 0}
          message={activeHolds.length
            ? <>Its {plural(activeHolds.length, "active hold")} will stop keeping content for {plural(m.custodians, "person", "people")}: apps may delete what they delete again, and retention rules apply to them. The holds stay on record, and reopening the matter puts them back in force.</>
            : <>Nothing is on hold in this matter. Its searches and exports stay available.</>}
          onConfirm={async () => {
            try {
              await api(`/api/matters/${m.id}`, { method: "PATCH", json: { status: "closed" } });
              app.say("Matter closed");
              load();
            } catch (e) {
              app.say((e as Error).message);
            }
          }}
          onClose={() => setClosing(false)}
        />
      ) : null}
      {holdEdit ? (
        <HoldEditor app={app} matter={m} hold={holdEdit === "new" ? undefined : holdEdit} onClose={() => setHoldEdit(null)} onSaved={(h) => { setHoldEdit(null); app.say(holdEdit === "new" ? `Hold placed on ${plural(h.custodians.length, "person", "people")}` : "Hold updated"); load(); }} />
      ) : null}
      {releasing ? <ReleaseHold app={app} hold={releasing} onClose={() => setReleasing(null)} onDone={load} /> : null}
    </div>
  );
}

export function HoldTable({ app, holds, showMatter, onEdit, onRelease }: {
  app: AppCtx; holds: HoldRecord[]; showMatter?: boolean; onEdit: (h: HoldRecord) => void; onRelease: (h: HoldRecord) => void;
}) {
  if (!holds.length) {
    return <div className="empty"><p>No holds yet. A hold keeps everything its custodians have in the apps it covers, even what they delete, until it is released.</p></div>;
  }
  return (
    <div className="tablewrap">
      <table className="table">
        <thead><tr><th>Hold</th>{showMatter ? <th>Matter</th> : null}<th>Custodians</th><th>Apps</th><th>Status</th><th>Placed</th><th /></tr></thead>
        <tbody>
          {holds.map((h) => {
            const inForce = h.active && h.matterStatus === "open";
            return (
              <tr key={h.id}>
                <td className="rname">{h.name}</td>
                {showMatter ? <td className="clip"><a className="link" href={`#/matters/${h.matterId}/holds`}>{h.matterName}</a></td> : null}
                <td>
                  <div className="chips" style={{ maxWidth: 360 }}>
                    {h.custodians.slice(0, 4).map((c) => <span key={c} className="chip plain">{c}</span>)}
                    {h.custodians.length > 4 ? <span className="muted small" title={h.custodians.join(", ")}>+{h.custodians.length - 4} more</span> : null}
                  </div>
                </td>
                <td className="clip">{appsText(app, h.apps)}</td>
                <td>
                  {inForce ? <Badge tone="amber">On hold</Badge> : h.active ? <span title="The matter is closed"><Badge>Matter closed</Badge></span> : <Badge>Released</Badge>}
                </td>
                <td className="nowrap">
                  <div className="cellstack">
                    <span>{formatDate(h.createdAt)}</span>
                    <span className="rsub">{h.createdBy}</span>
                    {h.releasedAt ? <span className="rsub">Released {formatDate(h.releasedAt)} by {h.releasedBy}</span> : null}
                  </div>
                </td>
                <td className="num nowrap">
                  {h.active && h.matterStatus === "open" ? (
                    <>
                      <button className="btn small" onClick={() => onEdit(h)}>Edit</button>{" "}
                      <button className="btn small" onClick={() => onRelease(h)}>Release</button>
                    </>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function HoldEditor({ app, matter, hold, onClose, onSaved }: {
  app: AppCtx; matter: { id: string; name: string }; hold?: HoldRecord; onClose: () => void; onSaved: (h: HoldRecord) => void;
}) {
  const [custodians, setCustodians] = useState<string[]>(hold?.custodians ?? []);
  const [apps, setApps] = useState<string[]>(hold?.apps ?? []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={hold ? "Edit hold" : `Place a hold in ${matter.name}`} onClose={onClose} wide>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          try {
            onSaved(await api<HoldRecord>(hold ? `/api/holds/${hold.id}` : `/api/matters/${matter.id}/holds`, {
              method: hold ? "PATCH" : "POST",
              json: { name: f.get("name"), custodians, apps },
            }));
          } catch (x) {
            setError((x as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label><span>Name</span><input name="name" defaultValue={hold?.name ?? `${matter.name} hold`} required /></label>
        <label>
          <span>Custodians: the people whose content is kept</span>
          <PeoplePicker label="Custodians" value={custodians} onChange={setCustodians} />
        </label>
        <fieldset>
          <legend>Apps</legend>
          <AppPicker app={app} value={apps} onChange={setApps} />
        </fieldset>
        <div className="notice warn">
          <div><p>While the hold is in force, nothing these people own in these apps is permanently deleted, by them or by retention rules. What they delete disappears from their view but is kept for search and export.</p></div>
        </div>
        <p className="error" role="alert">{error}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !custodians.length}>{hold ? "Save hold" : "Place hold"}</button>
        </div>
      </form>
    </Modal>
  );
}

export function ReleaseHold({ app, hold, onClose, onDone }: { app: AppCtx; hold: HoldRecord; onClose: () => void; onDone: () => void }) {
  return (
    <Confirm
      title="Release this hold?"
      action="Release hold"
      danger
      message={<>From now on, content of {plural(hold.custodians.length, "person", "people")} in {appsText(app, hold.apps).toLowerCase() === "all apps" ? "every app" : appsText(app, hold.apps)} can be deleted again, unless another hold covers it. What they deleted while on hold may be removed for good. The hold stays on record as released.</>}
      onConfirm={async () => {
        try {
          await api(`/api/holds/${hold.id}/release`, { method: "POST" });
          app.say("Hold released");
          onDone();
        } catch (e) {
          app.say((e as Error).message);
        }
      }}
      onClose={onClose}
    />
  );
}

const EXPORT_TONE: Record<ExportRecord["status"], [string, string]> = {
  pending: ["Waiting", ""], running: ["Running", "blue"], done: ["Ready", "green"], failed: ["Failed", "red"],
};

const MAX_PER_APP = 5000;

function ExportTable({ app, exports }: { app: AppCtx; exports: ExportRecord[] }) {
  if (!exports.length) return <div className="empty"><p>No exports yet. Export a saved search from the Searches tab.</p></div>;
  return (
    <div className="tablewrap">
      <table className="table">
        <thead><tr><th>Search</th><th>Status</th><th>Items</th><th>Requested</th><th className="num">Size</th><th /></tr></thead>
        <tbody>
          {exports.map((e) => {
            const [text, tone] = EXPORT_TONE[e.status];
            const per = Object.entries(e.counts);
            const items = per.reduce((n, [, c]) => n + c.items, 0);
            const found = per.filter(([, c]) => c.items > 0);
            const failed = per.filter(([, c]) => c.error);
            const cut = per.filter(([, c]) => c.truncated);
            return (
              <tr key={e.id}>
                <td className="rname">{e.searchName || "Search"}</td>
                <td>
                  <div className="cellstack">
                    <span><Badge tone={tone}>{text}</Badge></span>
                    {e.error ? <span className="rsub" style={{ whiteSpace: "normal" }}>{e.error}</span> : null}
                  </div>
                </td>
                <td style={{ maxWidth: 420 }}>
                  <div className="cellstack">
                    <span>{e.status === "done" || e.status === "failed" ? plural(items, "item") : "…"}</span>
                    {found.length ? <span className="rsub">{found.map(([a, c]) => `${appLabel(app, a)} ${c.items.toLocaleString()}`).join(" · ")}</span> : null}
                    {cut.length ? <span className="rsub" style={{ color: "#8a5d00", whiteSpace: "normal" }}>Cut short at {MAX_PER_APP.toLocaleString()} items: {cut.map(([a]) => appLabel(app, a)).join(", ")}</span> : null}
                    {failed.length ? (
                      <span className="rsub" style={{ color: "var(--danger)", whiteSpace: "normal" }} title={failed.map(([a, c]) => `${appLabel(app, a)}: ${c.error}`).join("\n")}>
                        Not included: {failed.map(([a]) => appLabel(app, a)).join(", ")}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="nowrap">
                  <div className="cellstack">
                    <span>{formatDateTime(e.createdAt)}</span>
                    <span className="rsub">{e.requestedBy}</span>
                  </div>
                </td>
                <td className="num nowrap">{formatSize(e.size)}</td>
                <td className="num nowrap">
                  {e.status === "done" ? <a className="btn small" href={`/api/exports/${e.id}/download`} title={e.sha256 ? `SHA-256 ${e.sha256}` : undefined}><Download size={13} /> Download</a> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
