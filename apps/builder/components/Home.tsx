"use client";
/** The start page: your apps and the apps shared with you, and making a new one. */
import { useEffect, useState } from "react";
import { api, type AppDetail, type AppSummary } from "@/lib/client";
import type { DataSource } from "@/lib/model";
import { AddData, Modal } from "./Studio";

export function Home() {
  const [apps, setApps] = useState<AppSummary[] | null>(null);
  const [error, setError] = useState("");
  const [making, setMaking] = useState<null | "blank" | "data">(null);

  const load = () =>
    api<{ apps: AppSummary[] }>("/api/apps")
      .then((r) => setApps(r.apps))
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);

  const create = async (body: Record<string, unknown>) => {
    try {
      const r = await api<{ app: AppDetail }>("/api/apps", { body });
      window.location.href = `/studio/${r.app.id}`;
    } catch (e) {
      setError((e as Error).message);
      setMaking(null);
    }
  };

  const remove = async (a: AppSummary) => {
    if (!confirm(`Delete ${a.name}? People it's shared with lose it too.`)) return;
    try {
      await api(`/api/apps/${a.id}`, { method: "DELETE" });
      void load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const mine = apps?.filter((a) => a.role !== "user") ?? [];
  const shared = apps?.filter((a) => a.role === "user") ?? [];

  return (
    <div className="home">
      <header>
        <h1>Builder</h1>
        <p className="muted">Make apps for your team on your Synergy Base data, without code: screens, forms and galleries, with formulas like a spreadsheet.</p>
      </header>
      {error && (
        <div className="error-bar">
          {error}
          <button onClick={() => setError("")}>×</button>
        </div>
      )}
      <h2>Start</h2>
      <div className="cards">
        <button className="card new" onClick={() => setMaking("data")}>
          <span className="plus">▦</span>
          Start from a Base table
          <span className="muted small">A browse, view and edit app in one step</span>
        </button>
        <button className="card new" onClick={() => setMaking("blank")}>
          <span className="plus">+</span>
          Blank app
          <span className="muted small">Tablet or phone layout</span>
        </button>
      </div>
      <h2>Your apps</h2>
      {!apps ? (
        <p className="muted">Loading…</p>
      ) : !mine.length ? (
        <p className="muted">No apps yet.</p>
      ) : (
        <div className="cards">
          {mine.map((a) => (
            <AppCard key={a.id} a={a} onDelete={() => void remove(a)} />
          ))}
        </div>
      )}
      {!!shared.length && (
        <>
          <h2>Shared with you</h2>
          <div className="cards">
            {shared.map((a) => (
              <AppCard key={a.id} a={a} />
            ))}
          </div>
        </>
      )}
      {making === "blank" && <NewBlank onClose={() => setMaking(null)} onCreate={(name, layout) => void create({ name, layout })} />}
      {making === "data" && <NewFromData onClose={() => setMaking(null)} onCreate={(ds, layout) => void create({ fromTable: ds.tableId, layout })} />}
    </div>
  );
}

function AppCard({ a, onDelete }: { a: AppSummary; onDelete?: () => void }) {
  const editable = a.role !== "user";
  return (
    <div className="card">
      <a className="card-main" href={a.published ? `/play/${a.id}` : `/studio/${a.id}`}>
        <span className="app-icon" style={{ background: a.color }}>
          {a.name.slice(0, 1).toUpperCase()}
        </span>
        <strong>{a.name}</strong>
        {a.description && <span className="muted small clamp">{a.description}</span>}
        <span className="muted small">
          {a.published ? `Version ${a.publishedVersion}` : "Draft"} · {new Date(a.updatedAt).toLocaleDateString()}
        </span>
      </a>
      <div className="card-actions">
        {a.published && (
          <a className="button" href={`/play/${a.id}`}>
            Play
          </a>
        )}
        {editable && (
          <a className="button" href={`/studio/${a.id}`}>
            Edit
          </a>
        )}
        {a.role === "owner" && onDelete && (
          <button className="danger" onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function LayoutPick({ value, onChange }: { value: "tablet" | "phone"; onChange: (v: "tablet" | "phone") => void }) {
  return (
    <div className="layout-pick">
      {(["tablet", "phone"] as const).map((l) => (
        <label key={l} className={value === l ? "on" : ""}>
          <input type="radio" name="layout" checked={value === l} onChange={() => onChange(l)} />
          <span className={`layout-shape ${l}`} />
          {l === "tablet" ? "Tablet" : "Phone"}
        </label>
      ))}
    </div>
  );
}

function NewBlank({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, layout: "tablet" | "phone") => void }) {
  const [name, setName] = useState("");
  const [layout, setLayout] = useState<"tablet" | "phone">("tablet");
  return (
    <Modal title="Blank app" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onCreate(name.trim() || "App1", layout);
        }}
      >
        <label className="prop-row">
          <span>Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="App1" />
        </label>
        <LayoutPick value={layout} onChange={setLayout} />
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit">
            Create
          </button>
        </div>
      </form>
    </Modal>
  );
}

function NewFromData({ onClose, onCreate }: { onClose: () => void; onCreate: (ds: Omit<DataSource, "name">, layout: "tablet" | "phone") => void }) {
  const [layout, setLayout] = useState<"tablet" | "phone">("phone");
  const [busy, setBusy] = useState(false);
  return busy ? (
    <Modal title="Start from a Base table" onClose={onClose}>
      <p className="muted">Making your app…</p>
    </Modal>
  ) : (
    <AddData
      title="Start from a Base table"
      onClose={onClose}
      onAdd={(ds) => {
        setBusy(true);
        onCreate(ds, layout);
      }}
    >
      <LayoutPick value={layout} onChange={setLayout} />
    </AddData>
  );
}
