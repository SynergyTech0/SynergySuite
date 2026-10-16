"use client";
// Home: the numbers that matter, and whether every app is answering.
import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppStatus } from "@/lib/apps";
import { api } from "./client";
import { StatusDot, complianceBadge } from "./Apps";
import type { AppCtx } from "./shared";

type Counts = { openMatters: number; activeHolds: number; custodiansOnHold: number; people: number | null; directory: "ok" | "unset" | "error" };

export function Home({ app }: { app: AppCtx }) {
  const [c, setC] = useState<Counts | null>(null);
  const [apps, setApps] = useState<AppStatus[] | null>(null);
  useEffect(() => {
    void api<Counts>("/api/home").then(setC).catch((e) => app.say(e.message));
    void api<{ apps: AppStatus[] }>("/api/apps").then((r) => setApps(r.apps)).catch((e) => app.say(e.message));
  }, [app]);
  const first = app.me.name.split(" ")[0] || "there";
  const up = apps?.filter((a) => a.up).length ?? 0;

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Welcome, {first}</h1>
          <p className="muted">The Synergy suite at a glance.</p>
        </div>
        <a className="btn" href={app.authConsole} target="_blank" rel="noreferrer">Sign-in console <ExternalLink size={14} /></a>
      </div>
      <div className="stats">
        <a className="stat" href="#/people">
          <div className="k">People</div>
          <div className="v">{c ? (c.people ?? "—") : "…"}</div>
          <div className="s">{c?.directory === "unset" ? "Set ADMIN_SCIM_TOKEN to list them" : c?.directory === "error" ? "Directory unavailable" : "Accounts in the sign-in service"}</div>
        </a>
        <a className="stat" href="#/matters">
          <div className="k">Open matters</div>
          <div className="v">{c ? c.openMatters : "…"}</div>
          <div className="s">eDiscovery cases</div>
        </a>
        <a className="stat" href="#/holds">
          <div className="k">Active holds</div>
          <div className="v">{c ? c.activeHolds : "…"}</div>
          <div className="s">{c ? `${c.custodiansOnHold} ${c.custodiansOnHold === 1 ? "person" : "people"} on hold` : ""}</div>
        </a>
        <a className="stat" href="#/apps">
          <div className="k">Apps answering</div>
          <div className="v">{apps ? `${up} / ${apps.length}` : "…"}</div>
          <div className="s">{apps ? `${apps.filter((a) => a.compliance === "connected").length} connected to eDiscovery` : "Checking…"}</div>
        </a>
      </div>
      <section className="panel">
        <h3>App status <a className="btn small ghost" href="#/apps">Details</a></h3>
        {!apps ? <p className="muted small">Checking every app…</p> : (
          <div className="appgrid">
            {apps.map((a) => (
              <div className="appcard" key={a.id}>
                <div className="top">
                  <StatusDot up={a.up} />
                  <a className="rname link" href={a.url} target="_blank" rel="noreferrer">{a.name}</a>
                  {a.contentApp && a.up ? complianceBadge(a) : null}
                </div>
                <span className="rsub">{a.up ? `Up${a.ms !== null ? ` · ${a.ms} ms` : ""}` : "Not answering"} · {a.m365}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
