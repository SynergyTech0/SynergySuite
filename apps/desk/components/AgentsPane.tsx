"use client";
import { ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "./client";
import type { Me } from "./DeskApp";

type Agent = { email: string; name: string; role: "admin" | "agent"; scope: "all" | "assigned" };

// Admins decide who works the desk. Everyone else only sees the tickets they asked for.
export function AgentsPane({ me, say }: { me: Me; say: (t: string) => void }) {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [email, setEmail] = useState("");
  const load = useCallback(async () => setAgents(await api<Agent[]>("/api/agents")), []);
  useEffect(() => void load().catch((e) => say(e.message)), [load, say]);

  const save = async (a: Partial<Agent> & { email: string }, verb: string) => {
    try {
      await api("/api/agents", { method: "POST", json: a });
      await load();
      say(verb);
    } catch (e) {
      say((e as Error).message);
    }
  };
  const access = (a: Agent) => (a.role === "admin" ? "admin" : a.scope);

  return (
    <>
      <section className="listpane">
        <div className="listhead">
          <div className="titlerow"><h1 className="grow">Agents</h1></div>
          <p className="muted small hint">Only agents work tickets. Anyone else who opens Desk sees just the requests they made, in Desk and in suite search.</p>
          <form
            className="titlerow"
            onSubmit={(e) => {
              e.preventDefault();
              if (email.trim()) void save({ email: email.trim() }, `${email.trim()} added`).then(() => setEmail(""));
            }}
          >
            <input className="grow" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" aria-label="Add an agent by email" />
            <button className="btn small primary" type="submit">Add agent</button>
          </form>
        </div>
        <div className="listbody">
          {!agents ? <p className="muted pad">Loading…</p> : (
            <ul className="tlist">
              {agents.map((a) => (
                <li key={a.email}>
                  <div className="trow">
                    <div className="trowtop"><span className="tfrom">{a.name || a.email}{a.email === me.email ? " (you)" : ""}</span></div>
                    {a.name ? <div className="tpreview">{a.email}</div> : null}
                    <div className="trowtop" style={{ marginTop: 6 }}>
                      <select
                        className="grow"
                        aria-label={`Access for ${a.email}`}
                        value={access(a)}
                        onChange={(e) => {
                          const v = e.target.value;
                          void save(v === "admin" ? { email: a.email, role: "admin" } : { email: a.email, role: "agent", scope: v as Agent["scope"] }, "Saved");
                        }}
                      >
                        <option value="admin">Admin</option>
                        <option value="all">Agent: every ticket</option>
                        <option value="assigned">Agent: only tickets assigned to them</option>
                      </select>
                      <button
                        className="iconbtn"
                        aria-label={`Remove ${a.email}`}
                        onClick={async () => {
                          try {
                            await api(`/api/agents/${encodeURIComponent(a.email)}`, { method: "DELETE" });
                            await load();
                            say(`${a.email} is no longer an agent`);
                          } catch (e) {
                            say((e as Error).message);
                          }
                        }}
                      ><Trash2 size={15} /></button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <section className="detail">
        <div className="empty">
          <ShieldCheck size={40} strokeWidth={1.2} />
          <p>Admins add and remove agents. An agent sees every ticket, or only the ones assigned to them; internal notes and draft articles are for agents only.</p>
        </div>
      </section>
    </>
  );
}
