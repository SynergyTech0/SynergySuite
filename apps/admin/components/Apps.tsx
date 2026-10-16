"use client";
// Apps: every suite app, whether it answers, where it lives, and whether it takes part in eDiscovery.
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AppStatus } from "@/lib/apps";
import { api } from "./client";
import { Badge, type AppCtx } from "./shared";

export function StatusDot({ up }: { up: boolean }) {
  return <span className={`dot ${up ? "green" : "red"}`} title={up ? "Up" : "Not answering"} aria-label={up ? "Up" : "Not answering"} />;
}

const LABEL: Record<AppStatus["compliance"], [string, string]> = {
  connected: ["Connected", "green"],
  token: ["Token mismatch", "red"],
  unsupported: ["Not supported", ""],
  unreachable: ["No answer", "amber"],
  error: ["Error", "red"],
  "n/a": ["—", ""],
};

export function complianceBadge(a: AppStatus) {
  if (a.compliance === "n/a") return <span className="muted">—</span>;
  if (!a.up) return <span title={a.complianceDetail}><Badge>Unknown</Badge></span>;
  const [text, tone] = LABEL[a.compliance];
  return <span title={a.complianceDetail}><Badge tone={tone}>{text}</Badge></span>;
}

export function Apps({ app }: { app: AppCtx }) {
  const [list, setList] = useState<AppStatus[] | null>(null);
  const [token, setToken] = useState(true);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (fresh = false) => {
    setBusy(true);
    try {
      const r = await api<{ apps: AppStatus[]; token: boolean }>(`/api/apps${fresh ? "?fresh=1" : ""}`);
      setList(r.apps);
      setToken(r.token);
    } catch (e) {
      app.say((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [app]);
  useEffect(() => void load(), [load]);

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Apps</h1>
          <p className="muted">Each app is checked on the internal network. eDiscovery asks each one to search with the compliance token.</p>
        </div>
        <button className="btn" onClick={() => load(true)} disabled={busy}><RefreshCw size={15} /> {busy ? "Checking…" : "Check again"}</button>
      </div>
      {!token ? (
        <div className="notice warn">
          <div>
            <p><strong>COMPLIANCE_TOKEN is not set.</strong> Without it the Admin center can&apos;t search the apps, and apps can&apos;t read holds from it.</p>
            <p>Set the same long random value as <code>COMPLIANCE_TOKEN</code> for the Admin center and every app.</p>
          </div>
        </div>
      ) : null}
      <section className="panel flush">
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr><th>App</th><th>Status</th><th>Address</th><th>Internal address</th><th>eDiscovery</th></tr>
            </thead>
            <tbody>
              {!list ? (
                <tr><td colSpan={5} className="muted">Checking every app…</td></tr>
              ) : list.map((a) => (
                <tr key={a.id}>
                  <td>
                    <div className="cellstack">
                      <span className="rname">{a.name}{a.core ? "" : <span className="muted small"> · add-on</span>}</span>
                      <span className="rsub">{a.m365}</span>
                    </div>
                  </td>
                  <td className="nowrap"><StatusDot up={a.up} /> {a.up ? `Up${a.ms !== null ? ` · ${a.ms} ms` : ""}` : "Not answering"}</td>
                  <td className="clip"><a className="link" href={a.url} target="_blank" rel="noreferrer">{a.url.replace(/^https?:\/\//, "")}</a></td>
                  <td className="clip"><code>{a.internalUrl}</code></td>
                  <td>
                    <div className="cellstack">
                      <span>{complianceBadge(a)}</span>
                      {a.compliance !== "n/a" && a.up ? <span className="rsub">{a.complianceDetail}</span> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
