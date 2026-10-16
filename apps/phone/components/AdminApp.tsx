"use client";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api } from "./client";

type NumberRow = { number: string; label: string; display: string; assignedTo: string | null; trunkId: string };
type Trunk = {
  id: string; name: string; kind: "provider" | "pbx"; address: string; transport: "udp" | "tcp" | "tls"; username: string; hasPassword: boolean;
  inboundAddresses: string[]; inboundUsername: string; hasInboundPassword: boolean; synced: boolean; syncedAt: string | null; syncError: string | null;
  numbers: NumberRow[];
};

/** Trunks (phone companies and PBXs), their numbers, and who has which number. */
export function AdminApp({ sipHost }: { sipHost: string }) {
  const [trunks, setTrunks] = useState<Trunk[] | null>(null);
  const [media, setMedia] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api<{ trunks: Trunk[]; mediaServer: boolean }>("/api/admin/trunks");
      setTrunks(r.trunks);
      setMedia(r.mediaServer);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const fail = (e: unknown) => setError((e as Error).message);

  return (
    <div className="admin">
      <header className="adminhead">
        <a className="iconbtn" href="/" aria-label="Back to Phone"><ArrowLeft size={18} /></a>
        <h1>Phone admin</h1>
        <span className="grow" />
        <button className="btn primary" onClick={() => setAdding(true)}><Plus size={16} /> Add a trunk</button>
      </header>
      {error && <p className="error pad">{error} <button className="linkbtn" onClick={() => setError("")}>Dismiss</button></p>}
      {!media && (
        <div className="notice warn pad">
          <AlertTriangle size={16} /> The media server keys aren&apos;t set on the Phone server (LIVEKIT_API_KEY and LIVEKIT_API_SECRET, the same ones Meet uses), so nothing here can reach it yet.
        </div>
      )}
      <section className="help">
        <h2>How calls reach Synergy</h2>
        <p className="muted">
          A trunk is your phone company (any SIP provider) or your office PBX (Asterisk, FreeSWITCH, 3CX…). Point the trunk&apos;s
          incoming calls at <code>{sipHost ? `sip:${sipHost}` : "this server's SIP address"}</code> (port 5060), add its numbers here, and give each
          number to a person. Calls between colleagues need no trunk at all.
        </p>
      </section>

      {adding && <TrunkForm onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); void load(); }} onError={fail} />}

      {trunks?.length === 0 && !adding && <div className="empty"><p>No trunks yet. Colleagues can already call each other; add a trunk for real phone numbers.</p></div>}
      {trunks?.map((t) => <TrunkCard key={t.id} t={t} onChange={load} onError={fail} />)}
    </div>
  );
}

function TrunkForm({ t, onCancel, onSaved, onError }: { t?: Trunk; onCancel: () => void; onSaved: () => void; onError: (e: unknown) => void }) {
  const [kind, setKind] = useState<"provider" | "pbx">(t?.kind ?? "provider");
  const [busy, setBusy] = useState(false);
  return (
    <form className="card trunkform" onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const v = Object.fromEntries(f.entries()) as Record<string, string>;
      setBusy(true);
      try {
        const json = { ...v, kind, inboundAddresses: v.inboundAddresses ?? "" };
        if (t) await api(`/api/admin/trunks/${t.id}`, { method: "PATCH", json });
        else await api("/api/admin/trunks", { method: "POST", json });
        onSaved();
      } catch (err) {
        onError(err);
      } finally {
        setBusy(false);
      }
    }}>
      <h2>{t ? `Edit ${t.name}` : "Add a trunk"}</h2>
      <div className="seg">
        <button type="button" className={kind === "provider" ? "on" : ""} onClick={() => setKind("provider")}>Phone company</button>
        <button type="button" className={kind === "pbx" ? "on" : ""} onClick={() => setKind("pbx")}>Office PBX</button>
      </div>
      <label>Name<input name="name" required defaultValue={t?.name ?? ""} placeholder={kind === "pbx" ? "Office PBX" : "Telnyx"} /></label>
      <fieldset>
        <legend>Calls out</legend>
        <label>Address<input name="address" defaultValue={t?.address ?? ""} placeholder={kind === "pbx" ? "pbx.office.lan:5060" : "sip.telnyx.com"} /></label>
        <label>Transport
          <select name="transport" defaultValue={t?.transport ?? "udp"}>
            <option value="udp">UDP</option><option value="tcp">TCP</option><option value="tls">TLS</option>
          </select>
        </label>
        <label>Username<input name="username" defaultValue={t?.username ?? ""} autoComplete="off" /></label>
        <label>Password<input name="password" type="password" autoComplete="new-password" placeholder={t?.hasPassword ? "Saved; type to change" : ""} /></label>
      </fieldset>
      <fieldset>
        <legend>Calls in</legend>
        <label>Only from these addresses<input name="inboundAddresses" defaultValue={t?.inboundAddresses.join(", ") ?? ""} placeholder="The provider's signalling IPs, e.g. 192.76.120.10, 64.16.250.10" /></label>
        <label>Or require this login: username<input name="inboundUsername" defaultValue={t?.inboundUsername ?? ""} autoComplete="off" /></label>
        <label>Password<input name="inboundPassword" type="password" autoComplete="new-password" placeholder={t?.hasInboundPassword ? "Saved; type to change" : ""} /></label>
        <p className="muted small">Leave both empty to take calls for your numbers from anywhere; your provider&apos;s IPs are safer.</p>
      </fieldset>
      <div className="inline">
        <button className="btn primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function TrunkCard({ t, onChange, onError }: { t: Trunk; onChange: () => void; onError: (e: unknown) => void }) {
  const [editing, setEditing] = useState(false);
  const [numbers, setNumbers] = useState("");
  if (editing) return <TrunkForm t={t} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); onChange(); }} onError={onError} />;
  return (
    <section className="card trunk">
      <div className="inline">
        <h2 className="grow">{t.name} <span className="muted small">{t.kind === "pbx" ? "Office PBX" : "Phone company"}{t.address ? ` · ${t.address}` : " · takes calls in only"}</span></h2>
        {t.synced ? (
          <span className="ok small inline"><CheckCircle2 size={15} /> Live</span>
        ) : (
          <span className="error small inline"><AlertTriangle size={15} /> {t.syncError ? "Not live" : "No numbers yet"}</span>
        )}
        <button className="btn small" title="Send this trunk to the media server again" onClick={() => api(`/api/admin/trunks/${t.id}`, { method: "POST" }).then(onChange, onError)}><RefreshCw size={14} /> Push again</button>
        <button className="btn small" onClick={() => setEditing(true)}>Edit</button>
        <button className="iconbtn" aria-label={`Delete ${t.name}`} onClick={() => {
          if (confirm(`Delete ${t.name} and its ${t.numbers.length} numbers? Calls to them stop arriving.`)) void api(`/api/admin/trunks/${t.id}`, { method: "DELETE" }).then(onChange, onError);
        }}><Trash2 size={16} /></button>
      </div>
      {t.syncError && <p className="error small">The media server said: {t.syncError}</p>}
      <table className="numbers">
        <thead><tr><th>Number</th><th>Person</th><th>Label</th><th /></tr></thead>
        <tbody>
          {t.numbers.map((n) => <NumberLine key={n.number} n={n} onChange={onChange} onError={onError} />)}
          {!t.numbers.length && <tr><td colSpan={4} className="muted">No numbers on this trunk yet.</td></tr>}
        </tbody>
      </table>
      <form className="inline" onSubmit={(e) => {
        e.preventDefault();
        void api(`/api/admin/trunks/${t.id}/numbers`, { method: "POST", json: { numbers } }).then(() => { setNumbers(""); onChange(); }, onError);
      }}>
        <input value={numbers} onChange={(e) => setNumbers(e.target.value)} placeholder="Add numbers: +1 555 123 4567, +1 555 123 4568" aria-label="Numbers to add" className="grow" />
        <button className="btn small" disabled={!numbers.trim()}>Add numbers</button>
      </form>
    </section>
  );
}

function NumberLine({ n, onChange, onError }: { n: NumberRow; onChange: () => void; onError: (e: unknown) => void }) {
  const [who, setWho] = useState(n.assignedTo ?? "");
  const [label, setLabel] = useState(n.label);
  const dirty = who !== (n.assignedTo ?? "") || label !== n.label;
  return (
    <tr>
      <td className="mono">{n.display}</td>
      <td><input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Nobody: email to give it to" aria-label={`Person for ${n.display}`} /></td>
      <td><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Sales line" aria-label={`Label for ${n.display}`} /></td>
      <td className="inline">
        <button className="btn small" disabled={!dirty} onClick={() => api(`/api/admin/numbers/${encodeURIComponent(n.number)}`, { method: "PATCH", json: { assignedTo: who.trim() || null, label } }).then(onChange, onError)}>Save</button>
        <button className="iconbtn" aria-label={`Remove ${n.display}`} onClick={() => {
          if (confirm(`Remove ${n.display}? Calls to it stop arriving.`)) void api(`/api/admin/numbers/${encodeURIComponent(n.number)}`, { method: "DELETE" }).then(onChange, onError);
        }}><Trash2 size={15} /></button>
      </td>
    </tr>
  );
}
