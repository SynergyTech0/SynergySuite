"use client";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { summary, uploadAccess } from "@/lib/accessUpload";
import type { DatabaseInfo } from "@/lib/catalog";

/** The start page: a new blank database, and every database the user can open. */
export function Home({ databases: initial }: { databases: DatabaseInfo[] }) {
  const [databases, setDatabases] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function importAccess(file: File) {
    setBusy(`Importing ${file.name}…`);
    setError("");
    try {
      const r = await uploadAccess("/api/databases/access", file);
      if (!r?.database) return setBusy("");
      try {
        sessionStorage.setItem(`base-import-${r.database.id}`, JSON.stringify({ title: summary(r), notes: r.notes }));
      } catch {
        // Private windows may refuse storage; the import itself is done.
      }
      location.href = `/d/${r.database.id}`;
    } catch (e) {
      setBusy("");
      setError((e as Error).message);
    }
  }

  async function create() {
    const name = prompt("Name the new database", `Database${databases.length + 1}`);
    if (!name) return;
    try {
      const { database } = await api<{ database: DatabaseInfo }>("/api/databases", { body: { name } });
      location.href = `/d/${database.id}`;
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(d: DatabaseInfo) {
    if (!confirm(`Delete "${d.name}" and every table in it? This can't be undone.`)) return;
    try {
      await api(`/api/databases/${d.id}`, { method: "DELETE" });
      setDatabases((prev) => prev.filter((x) => x.id !== d.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="home">
      <header>
        <h1>Base</h1>
        <p className="muted">Databases and lists: tables of records you can sort, filter, link and share.</p>
      </header>
      {error && <p className="error">{error}</p>}
      <div className="cards">
        <button className="card new" onClick={create}>
          <span className="plus">+</span>
          Blank database
        </button>
        <button className="card new" onClick={() => fileRef.current?.click()} disabled={!!busy}>
          <span className="plus">⇪</span>
          {busy || "Import an Access database"}
          <span className="muted small">.accdb or .mdb</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".accdb,.mdb"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void importAccess(f);
          }}
        />
        {databases.map((d) => (
          <div className="card" key={d.id}>
            <a href={`/d/${d.id}`} className="card-main">
              <span className="icon">▦</span>
              <strong>{d.name}</strong>
              <span className="muted small">
                {d.role === "owner" ? "" : `${d.role === "editor" ? "Can edit" : "Can view"} · `}Changed {new Date(d.updatedAt).toLocaleDateString("en-US", { dateStyle: "medium" })}
              </span>
            </a>
            {d.role === "owner" && (
              <button className="card-del" aria-label={`Delete ${d.name}`} onClick={() => remove(d)}>
                🗑
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
