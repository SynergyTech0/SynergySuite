"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Eye, EyeOff, History, KeyRound, Lock, Pencil, Plus, Trash2, Wand2, X } from "lucide-react";
import {
  KDF_ITERS,
  MIN_PASSPHRASE,
  type EntryData,
  decrypt,
  encrypt,
  generatePassword,
  newKey,
  unlockKey,
} from "@/lib/crypto";

type Config =
  | { configured: false }
  | { configured: true; salt: string; kdfIters: number; verifierIv: string; verifierCt: string };
type Blob = { id: string; iv: string; ct: string; created_by: string; updated_by: string; updated_at: string };
type Item = { id: string; updated_at: string; updated_by: string; data: EntryData; broken?: boolean };
type AuditRow = { id: string; user_email: string; action: string; entry_id: string | null; at: string };

const IDLE_LOCK_MS = 10 * 60 * 1000;
const EMPTY: EntryData = { title: "", username: "", password: "", url: "", notes: "" };

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
  return data as T;
}

const api = {
  vault: () => call<Config>("GET", "/api/vault"),
  init: (p: object) => call("POST", "/api/vault/init", p),
  rekey: (p: object) => call("POST", "/api/vault/rekey", p),
  entries: () => call<Blob[]>("GET", "/api/entries"),
  create: (b: object) => call<Blob>("POST", "/api/entries", b),
  update: (id: string, b: object) => call<Blob>("PATCH", `/api/entries/${id}`, b),
  remove: (id: string) => call("DELETE", `/api/entries/${id}`),
  report: (action: string, entryId?: string) => call("POST", "/api/audit", { action, entryId }).catch(() => {}),
  auditLog: () => call<AuditRow[]>("GET", "/api/audit"),
};

function asEntry(v: unknown): EntryData {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const s = (k: keyof EntryData) => (typeof o[k] === "string" ? (o[k] as string) : "");
  return { title: s("title"), username: s("username"), password: s("password"), url: s("url"), notes: s("notes") };
}

async function open(key: CryptoKey, b: Blob): Promise<Item> {
  try {
    return { id: b.id, updated_at: b.updated_at, updated_by: b.updated_by, data: asEntry(JSON.parse(await decrypt(key, b.iv, b.ct))) };
  } catch {
    return { id: b.id, updated_at: b.updated_at, updated_by: b.updated_by, data: { ...EMPTY, title: "(cannot decrypt this entry)" }, broken: true };
  }
}

export function VaultApp() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [key, setKey] = useState<CryptoKey | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [dialog, setDialog] = useState<"audit" | "rekey" | null>(null);
  const [toast, setToast] = useState("");
  const [fatal, setFatal] = useState("");
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flash = useCallback((e: unknown) => {
    setToast(e instanceof Error ? e.message : String(e));
    setTimeout(() => setToast(""), 5000);
  }, []);

  const loadConfig = useCallback(() => api.vault().then(setCfg), []);
  useEffect(() => {
    loadConfig().catch((e) => setFatal(e instanceof Error ? e.message : String(e)));
  }, [loadConfig]);

  const lock = useCallback(() => {
    setKey(null);
    setItems([]);
    setEditing(null);
    setDialog(null);
    void api.report("lock");
  }, []);

  // Locks itself after ten minutes without a click or key press.
  useEffect(() => {
    if (!key) return;
    const poke = () => {
      clearTimeout(idle.current);
      idle.current = setTimeout(lock, IDLE_LOCK_MS);
    };
    const events = ["mousemove", "keydown", "click"] as const;
    events.forEach((e) => window.addEventListener(e, poke));
    poke();
    return () => {
      events.forEach((e) => window.removeEventListener(e, poke));
      clearTimeout(idle.current);
    };
  }, [key, lock]);

  const unlocked = useCallback(async (k: CryptoKey) => {
    const blobs = await api.entries();
    setItems(await Promise.all(blobs.map((b) => open(k, b))));
    setKey(k);
    void api.report("unlock");
  }, []);

  const save = useCallback(
    async (item: Item | null, data: EntryData) => {
      if (!key) return;
      const sealed = await encrypt(key, JSON.stringify(data));
      const saved = item ? await api.update(item.id, sealed) : await api.create(sealed);
      setItems((prev) =>
        [...prev.filter((x) => x.id !== saved.id), { id: saved.id, updated_at: saved.updated_at, updated_by: saved.updated_by, data }].sort(
          (a, b) => Number(a.id) - Number(b.id),
        ),
      );
    },
    [key],
  );

  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    return items.filter((i) => !s || [i.data.title, i.data.username, i.data.url].some((v) => v.toLowerCase().includes(s)));
  }, [items, search]);

  if (fatal) {
    return (
      <div className="center">
        <div className="gate">
          <h1>Can&apos;t reach the vault</h1>
          <p className="muted">The vault did not answer. Nothing in it has changed.</p>
          <p className="muted small mono">{fatal}</p>
          <button className="btn" onClick={() => location.reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!cfg) return <div className="center muted">Loading…</div>;
  if (!cfg.configured) return <Setup onDone={() => loadConfig().catch(flash)} flash={flash} toast={toast} />;
  if (!key) return <Unlock cfg={cfg} onUnlocked={unlocked} flash={flash} toast={toast} />;

  return (
    <div className="vault">
      <div className="bar">
        <h1>
          <KeyRound size={20} /> Vault
        </h1>
        <button className="btn small" onClick={() => setDialog("audit")}>
          <History size={14} /> Activity
        </button>
        <button className="btn small" onClick={() => setDialog("rekey")}>
          Change passphrase
        </button>
        <button className="btn small" onClick={lock}>
          <Lock size={14} /> Lock
        </button>
      </div>
      <div className="bar">
        <input className="search grow" placeholder="Search by title, username or address" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn primary" onClick={() => setEditing("new")}>
          <Plus size={14} /> New entry
        </button>
      </div>
      <div className="entries">
        {shown.map((item) => (
          <EntryRow
            key={item.id}
            item={item}
            flash={flash}
            onEdit={() => setEditing(item)}
            onDelete={async () => {
              if (!confirm(`Delete "${item.data.title}"? This cannot be undone.`)) return;
              try {
                await api.remove(item.id);
                setItems((prev) => prev.filter((x) => x.id !== item.id));
              } catch (e) {
                flash(e);
              }
            }}
          />
        ))}
        {!shown.length && <p className="muted">{search ? "Nothing matches." : "Nothing here yet. Add the first entry."}</p>}
      </div>
      <p className="muted small">
        Encrypted in your browser: the server keeps only ciphertext. The vault locks itself after 10 minutes without activity.
      </p>
      {editing && (
        <Editor
          item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            try {
              await save(editing === "new" ? null : editing, data);
              setEditing(null);
            } catch (e) {
              flash(e);
            }
          }}
        />
      )}
      {dialog === "audit" && <Activity onClose={() => setDialog(null)} flash={flash} />}
      {dialog === "rekey" && (
        <Rekey
          oldKey={key}
          onClose={() => setDialog(null)}
          onDone={async (k) => {
            setDialog(null);
            await loadConfig();
            await unlocked(k);
            flash("Passphrase changed. Tell the other vault members the new one.");
          }}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Setup({ onDone, flash, toast }: { onDone: () => void; flash: (e: unknown) => void; toast: string }) {
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = p1.length >= MIN_PASSPHRASE && p1 === p2;
  return (
    <div className="center">
      <form
        className="gate"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ok) return;
          setBusy(true);
          try {
            const { params } = await newKey(p1, KDF_ITERS);
            await api.init(params);
            onDone();
          } catch (err) {
            flash(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1>
          <KeyRound size={20} /> Set up the team vault
        </h1>
        <p className="muted">
          Choose a strong passphrase. It encrypts everything <b>in your browser</b>: the server never sees it, and <b>nobody can recover it if it is lost</b>.
          Share it only with the people on the vault&apos;s access list.
        </p>
        <input type="password" placeholder={`Passphrase (${MIN_PASSPHRASE} characters or more)`} value={p1} onChange={(e) => setP1(e.target.value)} autoFocus />
        <input type="password" placeholder="Repeat the passphrase" value={p2} onChange={(e) => setP2(e.target.value)} />
        {p1 && p1.length < MIN_PASSPHRASE && <p className="muted small">It needs at least {MIN_PASSPHRASE} characters.</p>}
        {p2 && p1 !== p2 && <p className="muted small">The two don&apos;t match.</p>}
        <button className="btn primary" disabled={busy || !ok}>
          {busy ? "Making the key…" : "Create the vault"}
        </button>
      </form>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Unlock({
  cfg,
  onUnlocked,
  flash,
  toast,
}: {
  cfg: Extract<Config, { configured: true }>;
  onUnlocked: (k: CryptoKey) => Promise<void>;
  flash: (e: unknown) => void;
  toast: string;
}) {
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="center">
      <form
        className="gate"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!pass) return;
          setBusy(true);
          try {
            const key = await unlockKey(pass, cfg);
            if (!key) {
              void api.report("unlock.failed");
              throw new Error("That is not the vault's passphrase");
            }
            await onUnlocked(key);
          } catch (err) {
            flash(err);
          } finally {
            setBusy(false);
            setPass("");
          }
        }}
      >
        <h1>
          <Lock size={20} /> Vault is locked
        </h1>
        <p className="muted">Enter the vault passphrase. It is checked and used in your browser only.</p>
        <input type="password" placeholder="Vault passphrase" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus />
        <button className="btn primary" disabled={busy || !pass}>
          {busy ? "Unlocking…" : "Unlock"}
        </button>
      </form>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function EntryRow({ item, onEdit, onDelete, flash }: { item: Item; onEdit: () => void; onDelete: () => void; flash: (e: unknown) => void }) {
  const [revealed, setRevealed] = useState(false);
  const d = item.data;
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      void api.report("copy", item.id);
      flash(`Copied the ${what}`);
    } catch {
      flash(`Couldn't copy the ${what}`);
    }
  };
  const href = d.url ? (/^https?:\/\//i.test(d.url) ? d.url : `https://${d.url}`) : "";
  return (
    <div className={`entry${item.broken ? " broken" : ""}`}>
      <div className="main">
        <div className="title">
          {d.title || "(untitled)"}
          {href && (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {d.url}
            </a>
          )}
        </div>
        {d.username && (
          <div className="line">
            <span className="fname">{d.username}</span>
            <button className="iconbtn small" title="Copy username" onClick={() => copy(d.username, "username")}>
              <Copy size={13} />
            </button>
          </div>
        )}
        {d.password && (
          <div className="line">
            <span className="mono">{revealed ? d.password : "••••••••••••"}</span>
            <button
              className="iconbtn small"
              title={revealed ? "Hide" : "Show"}
              onClick={() => {
                if (!revealed) void api.report("reveal", item.id);
                setRevealed((r) => !r);
              }}
            >
              {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
            <button className="iconbtn small" title="Copy password" onClick={() => copy(d.password, "password")}>
              <Copy size={13} />
            </button>
          </div>
        )}
        {d.notes && <div className="muted small notes">{d.notes}</div>}
        <div className="muted small">
          Changed {new Date(item.updated_at).toLocaleString()} by {item.updated_by}
        </div>
      </div>
      {!item.broken && (
        <button className="iconbtn" title="Edit" onClick={onEdit}>
          <Pencil size={15} />
        </button>
      )}
      <button className="iconbtn" title="Delete" onClick={onDelete}>
        <Trash2 size={15} />
      </button>
    </div>
  );
}

function Editor({ item, onClose, onSave }: { item: Item | null; onClose: () => void; onSave: (d: EntryData) => Promise<void> }) {
  const [f, setF] = useState<EntryData>(item ? item.data : EMPTY);
  const [show, setShow] = useState(!item);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<EntryData>) => setF((prev) => ({ ...prev, ...p }));
  return (
    <div className="scrim" onClick={onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await onSave({ ...f, title: f.title.trim() });
          setBusy(false);
        }}
      >
        <div className="modalhead">
          <h2>{item ? "Edit entry" : "New entry"}</h2>
          <button type="button" className="iconbtn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="form">
          <label>
            <span>Title</span>
            <input autoFocus value={f.title} onChange={(e) => set({ title: e.target.value })} />
          </label>
          <label>
            <span>Username or email</span>
            <input value={f.username} onChange={(e) => set({ username: e.target.value })} autoComplete="off" />
          </label>
          <label>
            <span>Password</span>
            <div className="pwrow">
              <input type={show ? "text" : "password"} value={f.password} onChange={(e) => set({ password: e.target.value })} autoComplete="new-password" />
              <button type="button" className="btn small" onClick={() => setShow((s) => !s)}>
                {show ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
              <button
                type="button"
                className="btn small"
                title="Generate a password"
                onClick={() => {
                  set({ password: generatePassword(20) });
                  setShow(true);
                }}
              >
                <Wand2 size={13} />
              </button>
            </div>
          </label>
          <label>
            <span>Web address</span>
            <input value={f.url} onChange={(e) => set({ url: e.target.value })} />
          </label>
          <label>
            <span>Notes</span>
            <textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
          </label>
          <div className="actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy || !f.title.trim()}>
              Save
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Activity({ onClose, flash }: { onClose: () => void; flash: (e: unknown) => void }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  useEffect(() => {
    api.auditLog().then(setRows).catch(flash);
  }, [flash]);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modalhead">
          <h2>Activity</h2>
          <button className="iconbtn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="form">
          <div className="auditlist">
            {rows === null && <span className="muted">Loading…</span>}
            {rows?.map((a) => (
              <div key={a.id}>
                <span className="muted mono">{new Date(a.at).toLocaleString()}</span>
                <b>{a.user_email}</b>
                <span>
                  {a.action}
                  {a.entry_id ? ` #${a.entry_id}` : ""}
                </span>
              </div>
            ))}
            {rows && !rows.length && <span className="muted">Nothing yet.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Re-encrypts every entry under a new passphrase in the browser, then swaps them all at once on the server. */
function Rekey({ oldKey, onClose, onDone }: { oldKey: CryptoKey; onClose: () => void; onDone: (k: CryptoKey) => Promise<void> }) {
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ok = p1.length >= MIN_PASSPHRASE && p1 === p2;
  return (
    <div className="scrim" onClick={onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ok) return;
          setBusy(true);
          setError("");
          try {
            const blobs = await api.entries();
            const { key, params } = await newKey(p1, KDF_ITERS);
            const entries = [];
            for (const b of blobs) {
              let plain: string;
              try {
                plain = await decrypt(oldKey, b.iv, b.ct);
              } catch {
                throw new Error(`Entry #${b.id} can't be decrypted, so the passphrase can't be changed. Delete it first.`);
              }
              entries.push({ id: b.id, ...(await encrypt(key, plain)) });
            }
            await api.rekey({ ...params, entries });
            await onDone(key);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modalhead">
          <h2>Change the passphrase</h2>
          <button type="button" className="iconbtn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="form">
          <p className="muted">Every entry is re-encrypted in your browser. Everyone else will need the new passphrase.</p>
          <input type="password" placeholder={`New passphrase (${MIN_PASSPHRASE} characters or more)`} value={p1} onChange={(e) => setP1(e.target.value)} autoFocus />
          <input type="password" placeholder="Repeat it" value={p2} onChange={(e) => setP2(e.target.value)} />
          <p className="error">{error}</p>
          <div className="actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy || !ok}>
              {busy ? "Re-encrypting…" : "Change"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
