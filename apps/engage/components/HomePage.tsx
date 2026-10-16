"use client";
import { ExternalLink, Globe, Link2, Megaphone, Pencil, Plus, Sparkles, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import apps from "@synergy/config/apps.json";
import type { Home, Post, QuickLink } from "@/lib/types";
import { Avatar } from "./bits";
import { COLOR_HEX, ago, api, personHref, topicHref } from "./client";
import { CatchUp } from "./CatchUp";
import { Modal } from "./Modal";
import { useApp } from "./Shell";

type HomeData = Home & { sites: { name: string; description: string; url: string }[]; sitesAvailable: boolean; ai: boolean };

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** The company's own suite apps, for the "Your apps" card. */
function suiteLink(id: string, domain: string | undefined, port: number): string {
  return domain ? `https://${id}.${domain}` : `http://localhost:${port}`;
}

/** The intranet home page (Viva Connections): news, links, sites, communities and apps. */
export function HomePage({ domain }: { domain?: string }) {
  const { me, say, reloadCommunities } = useApp();
  const [data, setData] = useState<HomeData | null>(null);
  const [editLinks, setEditLinks] = useState(false);

  const load = useCallback(async () => setData(await api<HomeData>("/api/home")), []);
  useEffect(() => {
    load().catch((e) => say(e.message));
  }, [load, say]);

  if (!data) return <p className="muted center pad">Loading…</p>;
  const firstName = me.name.split(" ")[0];
  const launcher = apps.filter((a) => a.core && !["home", "auth", "engage"].includes(a.id)).slice(0, 12);

  return (
    <div className="homepage">
      <section className="hero">
        <div>
          <p className="muted">{data.company}</p>
          <h1>{greeting()}, {firstName}</h1>
        </div>
        <div className="heroactions">
          {data.ai && <CatchUp label={<><Sparkles size={15} /> Catch me up</>} />}
          <Link className="btn primary small" href="/feed">Go to your feed</Link>
        </div>
      </section>

      <div className="homegrid">
        <div className="homecol wide">
          <section className="card">
            <h3><Megaphone size={14} /> News and announcements</h3>
            {data.news.length === 0 ? (
              <p className="muted">No announcements yet. Admins of a community can mark a post as an announcement; articles show up here too.</p>
            ) : (
              <div className="news">{data.news.map((p) => <NewsItem key={p.id} post={p} />)}</div>
            )}
          </section>

          <section className="card">
            <h3><Users size={14} /> Your communities</h3>
            <div className="ctiles">
              {data.communities.map((c) => (
                <Link key={c.id} className="ctile" href={`/c/${c.slug}`}>
                  <span className="cdot big" style={{ background: COLOR_HEX[c.color] }}>{c.name[0]}</span>
                  <span className="grow">
                    <b>{c.name}</b>
                    <span className="muted small">{c.members} {c.members === 1 ? "member" : "members"}{c.lastActivity && ` · active ${ago(c.lastActivity)}`}</span>
                  </span>
                </Link>
              ))}
            </div>
            {data.suggested.length > 0 && (
              <>
                <h4>You might like</h4>
                <div className="ctiles">
                  {data.suggested.map((c) => (
                    <div key={c.id} className="ctile">
                      <span className="cdot big" style={{ background: COLOR_HEX[c.color] }}>{c.name[0]}</span>
                      <Link className="grow" href={`/c/${c.slug}`}>
                        <b>{c.name}</b>
                        <span className="muted small">{c.description || `${c.members} members`}</span>
                      </Link>
                      <button className="btn small" onClick={async () => {
                        try {
                          await api(`/api/communities/${c.id}/join`, { method: "POST" });
                          await Promise.all([load(), reloadCommunities()]);
                          say(`You joined ${c.name}`);
                        } catch (e) { say((e as Error).message); }
                      }}>Join</button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>

        <div className="homecol">
          <section className="card">
            <div className="cardhead">
              <h3><Link2 size={14} /> Quick links</h3>
              {data.me.admin && <button className="iconbtn small" aria-label="Edit quick links" onClick={() => setEditLinks(true)}><Pencil size={14} /></button>}
            </div>
            {data.quickLinks.length === 0 ? (
              <p className="muted small">{data.me.admin ? "Add the links everyone needs: HR, IT help, benefits, policies." : "No links yet."}</p>
            ) : (
              <ul className="links">
                {data.quickLinks.map((l) => (
                  <li key={l.id}><a href={l.url} target="_blank" rel="noreferrer noopener"><ExternalLink size={14} /> {l.label}</a></li>
                ))}
              </ul>
            )}
          </section>

          {(data.sites.length > 0 || !data.sitesAvailable) && (
            <section className="card">
              <h3><Globe size={14} /> Company sites</h3>
              {!data.sitesAvailable ? (
                <p className="muted small">Sites can&apos;t be reached right now.</p>
              ) : (
                <ul className="links">
                  {data.sites.map((s) => (
                    <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer noopener" title={s.description}><Globe size={14} /> {s.name}</a></li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="card">
            <h3>Your apps</h3>
            <div className="appgrid">
              {launcher.map((a) => (
                <a key={a.id} href={suiteLink(a.id, domain, a.port)} className="appbtn"><span className="appicon">{a.name[0]}</span>{a.name}</a>
              ))}
            </div>
          </section>

          {data.topics.length > 0 && (
            <section className="card">
              <h3>Trending topics</h3>
              <div className="topics">{data.topics.map((t) => <Link key={t.topic} href={topicHref(t.topic)}>#{t.topic} <span className="muted">{t.posts}</span></Link>)}</div>
            </section>
          )}

          {data.people.length > 0 && (
            <section className="card">
              <h3>People</h3>
              <div className="faces">
                {data.people.map((p) => <Link key={p.email} href={personHref(p.email)} title={p.name}><Avatar person={p} size={34} /></Link>)}
              </div>
            </section>
          )}
        </div>
      </div>
      {editLinks && <LinksEditor links={data.quickLinks} onClose={() => { setEditLinks(false); void load(); }} say={say} />}
    </div>
  );
}

function NewsItem({ post }: { post: Post }) {
  const headline = post.title || post.body.split("\n")[0];
  const rest = post.title ? post.body : post.body.split("\n").slice(1).join(" ");
  return (
    <Link className="newsitem" href={`/posts/${post.id}`}>
      <span className="newsbar" style={{ background: COLOR_HEX[post.community?.color ?? "blue"] }} />
      <span className="grow">
        <span className="muted small">
          {post.announcement && <><Megaphone size={12} /> Announcement · </>}
          {post.community?.name ?? post.author.name} · {ago(post.createdAt)}
        </span>
        <b>{headline}</b>
        {rest && <span className="muted newstext">{rest.slice(0, 220)}</span>}
      </span>
    </Link>
  );
}

function LinksEditor({ links: initial, onClose, say }: { links: QuickLink[]; onClose: () => void; say: (t: string) => void }) {
  const [links, setLinks] = useState(initial);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const reload = async () => setLinks(await api<QuickLink[]>("/api/links"));
  return (
    <Modal title="Quick links" onClose={onClose}>
      <div className="form">
        <ul className="linkedit">
          {links.map((l, i) => (
            <li key={l.id}>
              <span className="grow"><b>{l.label}</b><span className="muted small"> {l.url}</span></span>
              <button className="iconbtn small" disabled={i === 0} aria-label="Move up" onClick={async () => {
                await api(`/api/links/${l.id}`, { method: "PATCH", json: { position: links[i - 1].position - 1 } });
                await reload();
              }}>↑</button>
              <button className="iconbtn small" aria-label={`Remove ${l.label}`} onClick={async () => { await api(`/api/links/${l.id}`, { method: "DELETE" }); await reload(); }}><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
        <form className="sharerow" onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("/api/links", { method: "POST", json: { label, url } });
            setLabel(""); setUrl("");
            await reload();
          } catch (x) { say((x as Error).message); }
        }}>
          <input placeholder="Name" value={label} onChange={(e) => setLabel(e.target.value)} />
          <input placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn primary" aria-label="Add link"><Plus size={16} /></button>
        </form>
        <div className="actions"><button className="btn" onClick={onClose}>Done</button></div>
      </div>
    </Modal>
  );
}
