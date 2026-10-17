"use client";
// The record lists (leads, accounts, contacts, opportunities, referral partners): search and
// filters on the left, the selected record on the right.
import { Download, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  ACCOUNT_TYPES, LEAD_SOURCES, LEAD_STATUSES, PARTNER_STATUSES, STAGES, label,
  type Account, type Contact, type Lead, type Opportunity, type Partner,
} from "@/lib/types";
import { api, formatDate, formatMoney } from "./client";
import { AccountDetail, ContactDetail, LeadDetail, OpportunityDetail, PartnerDetail } from "./Details";
import { AccountEditor, ContactEditor, LeadEditor, OpportunityEditor, PartnerEditor } from "./Editors";
import { rewardTerms } from "./Referrals";
import { Avatar, Badge, Score, type AppCtx } from "./shared";

export type Kind = "leads" | "accounts" | "contacts" | "opportunities" | "partners";
type AnyRecord = Lead | Account | Contact | Opportunity | Partner;

const TITLES: Record<Kind, string> = { leads: "Leads", accounts: "Accounts", contacts: "Contacts", opportunities: "Opportunities", partners: "Referral partners" };
const SINGULAR: Record<Kind, string> = { leads: "lead", accounts: "account", contacts: "contact", opportunities: "opportunity", partners: "partner" };

/** The filter dropdown each list offers: [query parameter, choices]. */
const FILTER: Record<Kind, [string, string, readonly string[]][]> = {
  leads: [["status", "Any status", ["open", ...LEAD_STATUSES]], ["source", "Any source", LEAD_SOURCES]],
  accounts: [["type", "Any type", ACCOUNT_TYPES]],
  contacts: [],
  opportunities: [["stage", "Any stage", ["open", ...STAGES]]],
  partners: [["status", "Any status", PARTNER_STATUSES]],
};

function Row({ kind, r }: { kind: Kind; r: AnyRecord }) {
  if (kind === "leads") {
    const l = r as Lead;
    return (
      <>
        <Avatar name={l.name} />
        <div className="grow">
          <span className="rname">{l.name}</span>
          <span className="rsub">{[l.company, l.email].filter(Boolean).join(" · ") || "—"}</span>
        </div>
        <div className="rside"><Badge value={l.status} /><Score value={l.score} /></div>
      </>
    );
  }
  if (kind === "accounts") {
    const a = r as Account;
    return (
      <>
        <Avatar name={a.name} square />
        <div className="grow">
          <span className="rname">{a.name}</span>
          <span className="rsub">{[a.industry, [a.city, a.state].filter(Boolean).join(", "), a.ownerName].filter(Boolean).join(" · ")}</span>
        </div>
        <div className="rside"><Badge value={a.type} /></div>
      </>
    );
  }
  if (kind === "partners") {
    const p = r as Partner;
    return (
      <>
        <Avatar name={p.name} square={p.kind === "company"} />
        <div className="grow">
          <span className="rname">{p.name}</span>
          <span className="rsub">{[p.company, rewardTerms(p)].filter(Boolean).join(" · ")}</span>
        </div>
        <div className="rside"><Badge value={p.status} /></div>
      </>
    );
  }
  if (kind === "contacts") {
    const c = r as Contact;
    return (
      <>
        <Avatar name={c.name} />
        <div className="grow">
          <span className="rname">{c.name}</span>
          <span className="rsub">{[c.title, c.accountName].filter(Boolean).join(" · ")}</span>
        </div>
      </>
    );
  }
  const o = r as Opportunity;
  return (
    <div className="grow">
      <span className="rname">{o.name}</span>
      <span className="rsub">{o.accountName}{o.closeDate ? ` · closes ${formatDate(o.closeDate)}` : ""}</span>
      <span style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
        <strong style={{ fontVariantNumeric: "tabular-nums" }}>{formatMoney(o.amount)}</strong>
        <Badge value={o.stage} />
      </span>
    </div>
  );
}

/** Accounts and contacts come a page at a time (lib/paging.ts); the others come whole. */
const PAGED: Kind[] = ["accounts", "contacts"];
const PAGE = 1000;

type Facets = { industries: { value: string; count: number }[]; states: { value: string; count: number }[] };

export function RecordsView({ app, kind, id }: { app: AppCtx; kind: Kind; id: string | null }) {
  const [rows, setRows] = useState<AnyRecord[] | null>(null);
  const [more, setMore] = useState(false);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Record<string, string>>({});
  const [mine, setMine] = useState(false);
  const [creating, setCreating] = useState(false);

  const params = useCallback(() => {
    const p = new URLSearchParams();
    if (query) p.set("q", query);
    for (const [k, v] of Object.entries(filter)) if (v) p.set(k, v);
    if (mine) p.set("mine", "1");
    return p.toString();
  }, [query, filter, mine]);

  const load = useCallback(async () => {
    const page = await api<AnyRecord[]>(`/api/${kind}?${params()}`);
    setRows(page);
    setMore(PAGED.includes(kind) && page.length >= PAGE);
  }, [kind, params]);

  const loadMore = async () => {
    try {
      const page = await api<AnyRecord[]>(`/api/${kind}?${params()}&offset=${rows?.length ?? 0}`);
      setRows((r) => [...(r ?? []), ...page]);
      setMore(page.length >= PAGE);
    } catch (e) {
      app.say((e as Error).message);
    }
  };

  // The account list also filters by the industries and states the accounts have.
  useEffect(() => {
    if (kind !== "accounts") return;
    void api<Facets>("/api/accounts/facets").then(setFacets).catch(() => setFacets(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- app.version refreshes after changes elsewhere
  }, [kind, app.version]);
  const facetFilters: [string, string, Facets["states"]][] = kind === "accounts" && facets
    ? ([["industry", "Any industry", facets.industries], ["state", "Any state", facets.states]] as [string, string, Facets["states"]][]).filter(([, , o]) => o.length > 0)
    : [];

  useEffect(() => {
    const t = window.setTimeout(() => void load().catch((e) => app.say(e.message)), query ? 200 : 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- app.version refreshes after changes elsewhere
  }, [load, query, app.version]);

  // A different list starts with no filters.
  useEffect(() => {
    setQuery("");
    setFilter({});
    setMine(false);
    setRows(null);
    setMore(false);
  }, [kind]);

  const saved = (r: AnyRecord) => {
    setCreating(false);
    app.changed();
    app.go(kind, r.id);
  };

  const Editor = { leads: LeadEditor, accounts: AccountEditor, contacts: ContactEditor, opportunities: OpportunityEditor, partners: PartnerEditor }[kind] as
    (p: { app: AppCtx; onClose: () => void; onSaved: (r: AnyRecord) => void }) => React.ReactNode;

  return (
    <div className={`split${id ? " withdetail" : ""}`}>
      <section className="listpane" aria-label={TITLES[kind]}>
        <div className="listhead">
          <div className="titlerow">
            <h1 className="grow">{TITLES[kind]}</h1>
            <a className="iconbtn" href={`/api/export/${kind}?${params()}`} title="Export these as CSV" aria-label={`Export ${TITLES[kind].toLowerCase()} as CSV`}>
              <Download size={17} />
            </a>
            <button className="btn primary small" aria-label={`New ${SINGULAR[kind]}`} onClick={() => setCreating(true)}>
              <Plus size={15} /> New
            </button>
          </div>
          <label className="search">
            <Search size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${TITLES[kind].toLowerCase()}`} aria-label={`Search ${TITLES[kind].toLowerCase()}`} />
          </label>
          <div className="filters">
            {FILTER[kind].map(([key, any, options]) => (
              <select key={key} aria-label={any} value={filter[key] ?? ""} onChange={(e) => setFilter((f) => ({ ...f, [key]: e.target.value }))}>
                <option value="">{any}</option>
                {options.map((o) => <option key={o} value={o}>{o === "open" ? "Open" : label(o)}</option>)}
              </select>
            ))}
            {facetFilters.map(([key, any, options]) => (
              <select key={key} aria-label={any} value={filter[key] ?? ""} onChange={(e) => setFilter((f) => ({ ...f, [key]: e.target.value }))}>
                <option value="">{any}</option>
                {options.map((o) => <option key={o.value} value={o.value}>{o.value} ({o.count.toLocaleString()})</option>)}
              </select>
            ))}
            <label className="toggle">
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mine only
            </label>
            {rows ? <span className="muted small" style={{ marginLeft: "auto" }}>{rows.length.toLocaleString()}{more ? "+" : ""} shown</span> : null}
          </div>
        </div>
        <div className="rlist">
          {rows === null ? <p className="muted pad">Loading…</p> : rows.length === 0 ? (
            <div className="empty">
              <p>{query || mine || Object.values(filter).some(Boolean) ? `No ${TITLES[kind].toLowerCase()} match.` : `No ${TITLES[kind].toLowerCase()} yet.`}</p>
              <button className="btn" onClick={() => setCreating(true)}><Plus size={15} /> New {SINGULAR[kind]}</button>
            </div>
          ) : rows.map((r) => (
            <button key={r.id} className={`rrow${r.id === id ? " sel" : ""}`} onClick={() => app.go(kind, r.id)} aria-current={r.id === id ? "true" : undefined}>
              <Row kind={kind} r={r} />
            </button>
          ))}
          {rows && more ? <button className="btn small" style={{ margin: 12 }} onClick={() => void loadMore()}>Show more</button> : null}
        </div>
      </section>
      <section className="detail" aria-label={`${SINGULAR[kind]} details`}>
        {id ? (
          kind === "leads" ? <LeadDetail key={id} app={app} id={id} onChange={load} />
          : kind === "accounts" ? <AccountDetail key={id} app={app} id={id} onChange={load} />
          : kind === "contacts" ? <ContactDetail key={id} app={app} id={id} onChange={load} />
          : kind === "partners" ? <PartnerDetail key={id} app={app} id={id} onChange={load} />
          : <OpportunityDetail key={id} app={app} id={id} onChange={load} />
        ) : (
          <div className="empty">
            <p>Select {SINGULAR[kind] === "account" || SINGULAR[kind] === "opportunity" ? "an" : "a"} {SINGULAR[kind]} to see it here.</p>
          </div>
        )}
      </section>
      {creating ? <Editor app={app} onClose={() => setCreating(false)} onSaved={saved} /> : null}
    </div>
  );
}
