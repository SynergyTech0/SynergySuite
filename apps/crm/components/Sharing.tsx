"use client";
// Who else can see a record. Sharing gives read access; changing it stays with the owner and managers.
import { Share2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { RecordType } from "@/lib/types";
import { api } from "./client";
import type { AppCtx } from "./shared";

type Share = { principal: string; name: string };

export function SharePanel({ app, kind, id, canShare }: { app: AppCtx; kind: RecordType; id: string; canShare: boolean }) {
  const [shares, setShares] = useState<Share[] | null>(null);
  const [pick, setPick] = useState("");
  const path = `/api/shares/${kind}/${id}`;
  useEffect(() => {
    void api<Share[]>(path).then(setShares).catch(() => setShares([]));
  }, [path, app.version]);
  if (!shares || (!canShare && !shares.length)) return null;

  const save = async (principals: string[]) => {
    try {
      setShares(await api<Share[]>(path, { method: "PUT", json: { principals } }));
    } catch (e) {
      app.say((e as Error).message);
    }
  };
  const have = new Set(shares.map((s) => s.principal));
  const choices = app.members.filter((m) => !have.has(m.email) && m.email !== app.me.email);
  const managersSeeAll = app.repRead === "own" ? "Managers and admins see every record." : "Everyone in the CRM can see every record right now.";

  return (
    <section className="panel">
      <h3><Share2 size={14} /> Shared with</h3>
      {shares.length ? (
        <ul className="people">
          {shares.map((s) => (
            <li key={s.principal}>
              <span className="grow">{s.principal === "*" ? "Everyone in the CRM" : s.name}</span>
              {canShare ? (
                <button className="iconbtn" aria-label={`Stop sharing with ${s.name}`} onClick={() => save(shares.filter((x) => x.principal !== s.principal).map((x) => x.principal))}>
                  <X size={14} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : <p className="muted small">Only the owner can see this. {managersSeeAll}</p>}
      {canShare ? (
        <form
          style={{ display: "flex", gap: 8, marginTop: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (pick) void save([...shares.map((s) => s.principal), pick]).then(() => setPick(""));
          }}
        >
          <select aria-label="Share with" value={pick} onChange={(e) => setPick(e.target.value)} className="grow">
            <option value="">Share with…</option>
            {!have.has("*") ? <option value="*">Everyone in the CRM</option> : null}
            {choices.map((m) => <option key={m.email} value={m.email}>{m.name || m.email}</option>)}
          </select>
          <button className="btn small" type="submit" disabled={!pick}>Share</button>
        </form>
      ) : null}
    </section>
  );
}
