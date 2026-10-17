"use client";
import { Check, UserMinus, X } from "lucide-react";
import { useState } from "react";
import type { GroupDetail, GroupSummary } from "@/lib/types";
import { KIND_LABEL } from "@/lib/types";
import { api, colorFor, initials, person } from "./client";
import { Confirm } from "./Modal";
import type { MeInfo } from "./GroupsApp";

export function Members({ g, me, onChanged, onLeft }: { g: GroupDetail; me: MeInfo; onChanged: (g?: GroupDetail) => void; onLeft: () => void }) {
  const owner = g.role === "owner" || g.role === "admin";
  const [error, setError] = useState("");
  const [adding, setAdding] = useState("");
  const [role, setRole] = useState<"member" | "owner">("member");
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [leaving, setLeaving] = useState(false);
  const meDirect = g.directMembers.find((m) => m.member === me.email);

  const call = async (fn: () => Promise<GroupDetail | void>) => {
    setError("");
    try {
      const next = await fn();
      onChanged(next || undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      {owner && g.requests.length > 0 && (
        <section className="box">
          <h2>Asking to join</h2>
          <div className="list">
            {g.requests.map((r) => (
              <div key={r.email} className="item">
                <span className="avatar round" style={{ background: colorFor(r.email) }}>{initials(r.email)}</span>
                <div className="grow">
                  <div>{person(r.email)} <span className="muted small">{r.email}</span></div>
                  {r.message && <div className="muted small">{r.message}</div>}
                </div>
                <button className="btn small" onClick={() => call(() => api(`/api/groups/${g.id}/requests`, { method: "POST", json: { email: r.email, approve: true } }))}>
                  <Check size={14} /> Let in
                </button>
                <button className="btn small ghost" onClick={() => call(() => api(`/api/groups/${g.id}/requests`, { method: "POST", json: { email: r.email, approve: false } }))}>
                  <X size={14} /> Decline
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {owner && (
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            if (!adding.trim()) return;
            void call(async () => {
              const next = await api<GroupDetail>(`/api/groups/${g.id}/members`, { method: "POST", json: { members: adding, role } });
              setAdding("");
              return next;
            });
          }}
        >
          <input
            className="cellin grow"
            style={{ maxWidth: 460 }}
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            placeholder={g.kind === "distribution" ? "Emails, inside or outside the organization" : "Emails, separated by commas"}
            aria-label="Add people"
            onFocus={() => groups === null && api<{ groups: GroupSummary[] }>("/api/groups").then((d) => setGroups(d.groups.filter((x) => x.id !== g.id)), () => setGroups([]))}
          />
          <select className="cellin" value={role} onChange={(e) => setRole(e.target.value as "member" | "owner")} aria-label="As">
            <option value="member">as members</option>
            <option value="owner">as owners</option>
          </select>
          <button className="btn primary small" disabled={!adding.trim()}>Add</button>
          {groups && groups.length > 0 && role === "member" && (
            <select
              className="cellin"
              value=""
              aria-label="Add a whole group"
              onChange={(e) => e.target.value && setAdding((a) => [a.trim(), `group:${e.target.value}`].filter(Boolean).join(", "))}
            >
              <option value="">Add a whole group…</option>
              {groups.map((x) => <option key={x.id} value={x.id}>{x.name} ({KIND_LABEL[x.kind]})</option>)}
            </select>
          )}
        </form>
      )}
      {error && <p className="error">{error}</p>}
      <div className="tablewrap">
        <table className="grid">
          <thead>
            <tr><th>Name</th><th>Role</th><th className="num">{owner ? "" : " "}</th></tr>
          </thead>
          <tbody>
            {g.directMembers.map((m) => (
              <tr key={m.member}>
                <td>
                  <div className="toolbar" style={{ flexWrap: "nowrap" }}>
                    <span className={m.group ? "avatar" : "avatar round"} style={{ background: colorFor(m.group?.name ?? m.member), width: 30, height: 30, fontSize: 12 }}>
                      {initials(m.group?.name ?? m.member)}
                    </span>
                    {m.group ? (
                      <span>
                        <a href={`/g/${m.group.id}`}>{m.group.name}</a> <span className="muted small">{KIND_LABEL[m.group.kind]}: everyone in it</span>
                      </span>
                    ) : (
                      <span>
                        {person(m.member, me.email)} <span className="muted small">{m.member}</span>
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  {owner && !m.group ? (
                    <select
                      className="cellin"
                      value={m.role}
                      aria-label={`Role of ${m.member}`}
                      onChange={(e) => call(() => api(`/api/groups/${g.id}/members`, { method: "PATCH", json: { member: m.member, role: e.target.value } }))}
                    >
                      <option value="owner">Owner</option>
                      <option value="member">Member</option>
                    </select>
                  ) : (
                    <span className={`pill${m.role === "owner" ? " owner" : ""}`}>{m.role === "owner" ? "Owner" : "Member"}</span>
                  )}
                </td>
                <td className="num">
                  {owner && m.member !== me.email && (
                    <button
                      className="iconbtn small"
                      title="Remove"
                      aria-label={`Remove ${m.member}`}
                      onClick={() => call(() => api(`/api/groups/${g.id}/members?member=${encodeURIComponent(m.member)}`, { method: "DELETE" }))}
                    >
                      <UserMinus size={15} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!g.role && <p className="muted small">Only the owners are shown until you join.</p>}
      {meDirect && (
        <p>
          <button className="btn small" onClick={() => setLeaving(true)}>Leave {g.kind === "team" ? "team" : "group"}</button>
        </p>
      )}
      {g.role === "member" && !meDirect && <p className="muted small">You are in this group through another group.</p>}
      {leaving && (
        <Confirm
          title={`Leave ${g.name}?`}
          message={g.kind === "team" ? "You'll lose its channels, files and calendar until someone adds you back." : "You'll stop getting what is sent to it."}
          action="Leave"
          danger
          onClose={() => setLeaving(false)}
          onConfirm={async () => {
            try {
              await api(`/api/groups/${g.id}/members?member=${encodeURIComponent(me.email)}`, { method: "DELETE" });
              onLeft();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
      )}
    </>
  );
}
