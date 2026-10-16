"use client";
import {
  Building2, Cake, Download, Globe, Mail, MapPin, MoreHorizontal, Pencil, Phone, Plus, Search, Star, StickyNote,
  Tag, Trash2, Upload, UserRound, Users, Camera, ArrowLeft, Contact as ContactIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Contact, ContactInput, Group, Person } from "@/lib/types";
import { Avatar } from "./Avatar";
import { api, cap, formatBirthday, letterOf, mailUrl } from "./client";
import { ContactEditor } from "./ContactEditor";
import { Confirm, Modal, Prompt } from "./Modal";
import { ProfileDialog } from "./ProfileDialog";

type View = { kind: "all" } | { kind: "favorites" } | { kind: "group"; id: string } | { kind: "directory" };
type Mode = { kind: "none" } | { kind: "view"; id: string } | { kind: "edit"; id: string } | { kind: "new"; draft?: Partial<ContactInput> } | { kind: "person"; email: string };

const LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ#"];

export function ContactsApp({ me }: { me: { email: string; name: string } }) {
  const [view, setView] = useState<View>({ kind: "all" });
  const [mode, setMode] = useState<Mode>({ kind: "none" });
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [people, setPeople] = useState<{ people: Person[]; source: string } | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<React.ReactNode>(null);
  const [toast, setToast] = useState("");
  const [menu, setMenu] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const say = useCallback((t: string) => {
    setToast(t);
    window.setTimeout(() => setToast((x) => (x === t ? "" : x)), 3000);
  }, []);

  const loadGroups = useCallback(async () => setGroups(await api<Group[]>("/api/groups")), []);

  const load = useCallback(async () => {
    if (view.kind === "directory") {
      setPeople(await api(`/api/directory?q=${encodeURIComponent(query)}`));
      return;
    }
    const p = new URLSearchParams();
    if (query) p.set("q", query);
    if (view.kind === "favorites") p.set("favorites", "1");
    if (view.kind === "group") p.set("group", view.id);
    setContacts(await api<Contact[]>(`/api/contacts?${p}`));
  }, [view, query]);

  // A new list closes whatever was open from the last one (but not a contact being written).
  // A link to one directory entry switches to the Directory view, then opens the entry there.
  const opening = useRef<Mode | null>(null);
  useEffect(() => {
    setChecked(new Set());
    const open = opening.current;
    opening.current = null;
    setMode((m) => open ?? (m.kind === "new" ? m : { kind: "none" }));
  }, [view]);

  useEffect(() => {
    const t = window.setTimeout(() => void load().catch((e) => say(e.message)), query ? 200 : 0);
    return () => window.clearTimeout(t);
  }, [load, query, say]);

  useEffect(() => {
    void loadGroups();
    // Mail's "Add to contacts" opens /?new=1&email=…&name=…
    const u = new URL(location.href);
    if (u.searchParams.get("new")) {
      const name = (u.searchParams.get("name") ?? "").trim().split(/\s+/);
      const email = u.searchParams.get("email") ?? "";
      setMode({
        kind: "new",
        draft: {
          firstName: name.length > 1 ? name.slice(0, -1).join(" ") : name[0] ?? "",
          lastName: name.length > 1 ? name[name.length - 1] : "",
          emails: email ? [{ label: "work", value: email }] : [],
        },
      });
      history.replaceState(null, "", "/");
    } else if (u.searchParams.get("id")) {
      // Suite search links a card as /?id=… and a directory entry as /?person=…
      setMode({ kind: "view", id: u.searchParams.get("id")! });
      history.replaceState(null, "", "/");
    } else if (u.searchParams.get("person")) {
      opening.current = { kind: "person", email: u.searchParams.get("person")!.toLowerCase() };
      setView({ kind: "directory" });
      history.replaceState(null, "", "/");
    } else if (u.searchParams.get("q")) setQuery(u.searchParams.get("q")!);
  }, [loadGroups]);

  const refresh = useCallback(async () => {
    await Promise.all([load(), loadGroups()]);
  }, [load, loadGroups]);

  const selected = mode.kind === "view" || mode.kind === "edit" ? contacts?.find((c) => c.id === mode.id) ?? null : null;
  const selectedPerson = mode.kind === "person" ? people?.people.find((p) => p.email === mode.email) ?? null : null;

  const letters = useMemo(() => {
    const items = view.kind === "directory" ? people?.people.map((p) => p.name) : contacts?.map((c) => c.lastName || c.displayName);
    return new Set((items ?? []).map(letterOf));
  }, [contacts, people, view]);

  const jump = (letter: string) => {
    const el = listRef.current?.querySelector(`[data-letter="${letter}"]`);
    el?.scrollIntoView({ block: "start" });
  };

  const save = async (input: ContactInput) => {
    if (mode.kind === "edit") {
      await api(`/api/contacts/${mode.id}`, { method: "PATCH", json: input });
      await refresh();
      setMode({ kind: "view", id: mode.id });
      say("Contact saved");
    } else {
      const groupIds = view.kind === "group" ? [view.id] : [];
      const c = await api<Contact>("/api/contacts", { method: "POST", json: { ...input, groups: groupIds } });
      await refresh();
      setMode({ kind: "view", id: c.id });
      say("Contact added");
    }
  };

  const remove = (ids: string[]) =>
    setDialog(
      <Confirm
        title={ids.length > 1 ? `Delete ${ids.length} contacts?` : "Delete this contact?"}
        message="This can't be undone."
        action="Delete"
        danger
        onClose={() => setDialog(null)}
        onConfirm={async () => {
          await api("/api/contacts/delete", { method: "POST", json: { ids } });
          setChecked(new Set());
          if ((mode.kind === "view" || mode.kind === "edit") && ids.includes(mode.id)) setMode({ kind: "none" });
          await refresh();
          say(ids.length > 1 ? `${ids.length} contacts deleted` : "Contact deleted");
        }}
      />,
    );

  const toggleFavorite = async (c: Contact) => {
    await api(`/api/contacts/${c.id}/favorite`, { method: "POST", json: { favorite: !c.favorite } });
    await load();
  };

  const newGroup = (then?: (g: Group) => Promise<void>) =>
    setDialog(
      <Prompt
        title="New group"
        label="Group name"
        action="Create"
        onClose={() => setDialog(null)}
        onSubmit={async (name) => {
          const g = await api<Group>("/api/groups", { method: "POST", json: { name } });
          if (then) await then(g);
          await loadGroups();
          if (!then) setView({ kind: "group", id: g.id });
        }}
      />,
    );

  const addToGroup = (ids: string[]) =>
    setDialog(
      <Modal title="Add to group" onClose={() => setDialog(null)}>
        <div className="form">
          {groups.length ? (
            <ul className="pickerlist">
              {groups.map((g) => (
                <li key={g.id}>
                  <button
                    className="pickrow"
                    onClick={async () => {
                      await api(`/api/groups/${g.id}/members`, { method: "POST", json: { ids, member: true } });
                      setDialog(null);
                      await refresh();
                      say(`Added to ${g.name}`);
                    }}
                  >
                    <Tag size={16} /> {g.name} <span className="muted small">{g.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">You don&apos;t have any groups yet.</p>
          )}
          <div className="actions">
            <button
              className="btn"
              onClick={() =>
                newGroup(async (g) => {
                  await api(`/api/groups/${g.id}/members`, { method: "POST", json: { ids, member: true } });
                  await refresh();
                  say(`Added to ${g.name}`);
                })
              }
            >
              <Plus size={16} /> New group
            </button>
          </div>
        </div>
      </Modal>,
    );

  const importFile = async (file: File) => {
    try {
      const r = await api<{ added: number; skipped: number; failed: number }>("/api/import", { method: "POST", body: file });
      await refresh();
      const parts = [`${r.added} contact${r.added === 1 ? "" : "s"} imported`];
      if (r.skipped) parts.push(`${r.skipped} already in your contacts`);
      if (r.failed) parts.push(`${r.failed} had nothing to save`);
      say(parts.join(", "));
    } catch (e) {
      say((e as Error).message);
    }
  };

  const exportUrl = (format: "vcf" | "csv", ids?: string[]) => `/api/export?format=${format}${ids?.length ? `&ids=${ids.join(",")}` : ""}`;

  const groupName = view.kind === "group" ? groups.find((g) => g.id === view.id)?.name ?? "Group" : "";
  const heading = view.kind === "all" ? "All contacts" : view.kind === "favorites" ? "Favorites" : view.kind === "directory" ? "Directory" : groupName;
  const showDetail = mode.kind !== "none";

  // List rows with a letter header each time the first letter changes.
  const rows: React.ReactNode[] = [];
  let lastLetter = "";
  if (view.kind === "directory") {
    for (const p of people?.people ?? []) {
      const l = letterOf(p.name);
      if (l !== lastLetter) rows.push(<div className="letter" data-letter={l} key={`l-${l}`}>{l}</div>);
      lastLetter = l;
      rows.push(
        <button key={p.email} className={`crow${mode.kind === "person" && mode.email === p.email ? " sel" : ""}`} onClick={() => setMode({ kind: "person", email: p.email })}>
          <Avatar name={p.name} src={p.hasPhoto ? `/api/directory/${encodeURIComponent(p.email)}/photo` : null} />
          <span className="grow">
            <span className="cname">{p.name}{p.email === me.email && <span className="tag">You</span>}</span>
            <span className="csub">{[p.jobTitle, p.department].filter(Boolean).join(" · ") || p.email}</span>
          </span>
        </button>,
      );
    }
  } else {
    for (const c of contacts ?? []) {
      const l = letterOf(c.lastName || c.displayName);
      if (l !== lastLetter) rows.push(<div className="letter" data-letter={l} key={`l-${l}`}>{l}</div>);
      lastLetter = l;
      const on = checked.has(c.id);
      rows.push(
        <div key={c.id} className={`crow${(mode.kind === "view" || mode.kind === "edit") && mode.id === c.id ? " sel" : ""}${on ? " checked" : ""}`}>
          <label className="check" aria-label={`Select ${c.displayName}`}>
            <input
              type="checkbox"
              checked={on}
              onChange={() => setChecked((s) => {
                const n = new Set(s);
                if (n.has(c.id)) n.delete(c.id);
                else n.add(c.id);
                return n;
              })}
            />
            <Avatar name={c.displayName} src={c.hasPhoto ? `/api/contacts/${c.id}/photo?v=${encodeURIComponent(c.modifiedAt)}` : null} />
          </label>
          <button className="grow cbtn" onClick={() => setMode({ kind: "view", id: c.id })}>
            <span className="cname">{c.displayName}</span>
            <span className="csub">{c.emails[0]?.value || c.phones[0]?.value || c.company}</span>
          </button>
          {c.favorite && <Star size={14} className="starred" fill="currentColor" aria-label="Favorite" />}
        </div>,
      );
    }
  }

  const loaded = view.kind === "directory" ? people : contacts;

  return (
    <div className={`contacts${showDetail ? " withdetail" : ""}`}>
      <nav className="nav" aria-label="Contacts">
        <button className="btn primary newbtn" onClick={() => setMode({ kind: "new" })}>
          <Plus size={16} /> New contact
        </button>
        <NavItem icon={<ContactIcon size={18} />} label="All contacts" on={view.kind === "all"} onClick={() => setView({ kind: "all" })} />
        <NavItem icon={<Star size={18} />} label="Favorites" on={view.kind === "favorites"} onClick={() => setView({ kind: "favorites" })} />
        <NavItem icon={<Building2 size={18} />} label="Directory" on={view.kind === "directory"} onClick={() => setView({ kind: "directory" })} />
        <div className="navsection">
          Groups
          <button className="iconbtn small" aria-label="New group" onClick={() => newGroup()}>
            <Plus size={14} />
          </button>
        </div>
        {groups.map((g) => (
          <NavItem key={g.id} icon={<Tag size={16} />} label={g.name} count={g.count} on={view.kind === "group" && view.id === g.id} onClick={() => setView({ kind: "group", id: g.id })} />
        ))}
        {!groups.length && <p className="navhint muted small">Groups help you email a team at once.</p>}
        <div className="grow" />
        <NavItem icon={<UserRound size={18} />} label="My profile" onClick={() => setDialog(<ProfileDialog me={me} onClose={() => setDialog(null)} onSaved={() => { void load(); say("Profile saved"); }} />)} />
      </nav>

      <section className="listpane" aria-label={heading}>
        <div className="listhead">
          <div className="titlerow">
            <h1>{heading}</h1>
            <span className="muted small">{loaded ? (view.kind === "directory" ? people!.people.length : contacts!.length) : ""}</span>
            <span className="grow" />
            {view.kind === "group" && (
              <div className="menuwrap">
                <button className="iconbtn" aria-label="Group options" onClick={() => setMenu((m) => !m)}>
                  <MoreHorizontal size={18} />
                </button>
                {menu && (
                  <div className="menu right" onMouseLeave={() => setMenu(false)}>
                    <button
                      onClick={() => {
                        setMenu(false);
                        const emails = (contacts ?? []).map((c) => c.emails[0]?.value).filter(Boolean);
                        if (emails.length) window.open(mailUrl(emails.join(",")), "_blank", "noopener");
                        else say("Nobody in this group has an email address");
                      }}
                    >
                      <Mail size={16} /> Email group
                    </button>
                    <button
                      onClick={() => {
                        setMenu(false);
                        setDialog(
                          <Prompt title="Rename group" label="Group name" initial={groupName} action="Rename" onClose={() => setDialog(null)}
                            onSubmit={async (name) => {
                              await api(`/api/groups/${(view as { id: string }).id}`, { method: "PATCH", json: { name } });
                              await loadGroups();
                            }}
                          />,
                        );
                      }}
                    >
                      <Pencil size={16} /> Rename
                    </button>
                    <button
                      onClick={() => {
                        setMenu(false);
                        setDialog(
                          <Confirm title={`Delete ${groupName}?`} message="The contacts in it stay in your address book." action="Delete group" danger onClose={() => setDialog(null)}
                            onConfirm={async () => {
                              await api(`/api/groups/${(view as { id: string }).id}`, { method: "DELETE" });
                              setView({ kind: "all" });
                              await loadGroups();
                            }}
                          />,
                        );
                      }}
                    >
                      <Trash2 size={16} /> Delete group
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          <label className="search">
            <Search size={16} />
            <input type="search" placeholder={view.kind === "directory" ? "Search people" : "Search contacts"} value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search" />
          </label>
          {view.kind !== "directory" && (
            <div className="commands">
              {checked.size ? (
                <>
                  <span className="small">{checked.size} selected</span>
                  <button className="btn ghost small" onClick={() => addToGroup([...checked])}><Tag size={15} /> Add to group</button>
                  {view.kind === "group" && (
                    <button
                      className="btn ghost small"
                      onClick={async () => {
                        await api(`/api/groups/${view.id}/members`, { method: "POST", json: { ids: [...checked], member: false } });
                        setChecked(new Set());
                        await refresh();
                      }}
                    >
                      Remove from group
                    </button>
                  )}
                  <a className="btn ghost small" href={exportUrl("vcf", [...checked])}><Download size={15} /> Export</a>
                  <button className="btn ghost small" onClick={() => remove([...checked])}><Trash2 size={15} /> Delete</button>
                  <button className="linkbtn small" onClick={() => setChecked(new Set())}>Clear</button>
                </>
              ) : (
                <>
                  <button className="btn ghost small" onClick={() => fileRef.current?.click()}><Upload size={15} /> Import</button>
                  <a className="btn ghost small" href={exportUrl("vcf")}><Download size={15} /> Export vCard</a>
                  <a className="btn ghost small" href={exportUrl("csv")}>CSV</a>
                </>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".vcf,.vcard,.csv,text/vcard,text/csv"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void importFile(f);
                }}
              />
            </div>
          )}
          {view.kind === "directory" && people?.source === "signed-in" && (
            <p className="hint small muted">Showing people who have signed in. Your admin can list everyone by giving Contacts a directory token.</p>
          )}
        </div>
        <div className="listbody">
          <div className="clist" ref={listRef}>
            {rows}
            {loaded && !rows.length && (
              <div className="empty">
                <Users size={40} strokeWidth={1.4} />
                {query ? (
                  <p>Nothing matches &ldquo;{query}&rdquo;.</p>
                ) : view.kind === "directory" ? (
                  <p>Nobody is in the directory yet.</p>
                ) : view.kind === "favorites" ? (
                  <p>Star a contact to keep it here.</p>
                ) : view.kind === "group" ? (
                  <p>Select contacts and choose Add to group.</p>
                ) : (
                  <>
                    <p>Your address book is empty.</p>
                    <p className="small">Add a contact, or import a .vcf or CSV file from Google, Outlook or your phone.</p>
                    <div className="actions">
                      <button className="btn" onClick={() => fileRef.current?.click()}><Upload size={16} /> Import</button>
                      <button className="btn primary" onClick={() => setMode({ kind: "new" })}><Plus size={16} /> New contact</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          {rows.length > 12 && !query && (
            <div className="az" aria-label="Jump to letter">
              {LETTERS.map((l) => (
                <button key={l} disabled={!letters.has(l)} onClick={() => jump(l)}>{l}</button>
              ))}
            </div>
          )}
        </div>
      </section>

      {showDetail && (
        <section className="detail" aria-label="Contact">
          {mode.kind === "new" && (
            <ContactEditor key="new" title="New contact" initial={mode.draft ?? null} onSave={save} onCancel={() => setMode({ kind: "none" })} />
          )}
          {mode.kind === "edit" && selected && (
            <ContactEditor key={selected.id} title="Edit contact" initial={selected} onSave={save} onCancel={() => setMode({ kind: "view", id: selected.id })} />
          )}
          {mode.kind === "view" && selected && (
            <ContactCard
              c={selected}
              groups={groups}
              onBack={() => setMode({ kind: "none" })}
              onEdit={() => setMode({ kind: "edit", id: selected.id })}
              onDelete={() => remove([selected.id])}
              onFavorite={() => void toggleFavorite(selected)}
              onGroups={() => addToGroup([selected.id])}
              onPhoto={async (file) => {
                try {
                  await api(`/api/contacts/${selected.id}/photo`, { method: file ? "PUT" : "DELETE", body: file ?? undefined });
                  await load();
                } catch (e) {
                  say((e as Error).message);
                }
              }}
              exportHref={exportUrl("vcf", [selected.id])}
            />
          )}
          {mode.kind === "person" && selectedPerson && (
            <PersonCard
              p={selectedPerson}
              isMe={selectedPerson.email === me.email}
              people={people?.people ?? []}
              onBack={() => setMode({ kind: "none" })}
              onOpen={(email) => setMode({ kind: "person", email })}
              onEditProfile={() => setDialog(<ProfileDialog me={me} onClose={() => setDialog(null)} onSaved={() => { void load(); say("Profile saved"); }} />)}
              onSave={() => {
                const words = selectedPerson.name.split(/\s+/);
                setMode({
                  kind: "new",
                  draft: {
                    firstName: words.length > 1 ? words.slice(0, -1).join(" ") : words[0],
                    lastName: words.length > 1 ? words[words.length - 1] : "",
                    jobTitle: selectedPerson.jobTitle,
                    department: selectedPerson.department,
                    emails: [{ label: "work", value: selectedPerson.email }],
                    phones: [
                      ...(selectedPerson.mobile ? [{ label: "mobile", value: selectedPerson.mobile }] : []),
                      ...(selectedPerson.phone ? [{ label: "work", value: selectedPerson.phone }] : []),
                    ],
                  },
                });
                setView({ kind: "all" });
              }}
            />
          )}
        </section>
      )}

      {dialog}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function NavItem({ icon, label, on, count, onClick }: { icon: React.ReactNode; label: string; on?: boolean; count?: number; onClick: () => void }) {
  return (
    <button className={`navitem${on ? " active" : ""}`} onClick={onClick} aria-current={on ? "page" : undefined}>
      {icon}
      <span className="grow fname">{label}</span>
      {count !== undefined && <span className="muted small">{count}</span>}
    </button>
  );
}

function ContactCard({ c, groups, onBack, onEdit, onDelete, onFavorite, onGroups, onPhoto, exportHref }: {
  c: Contact; groups: Group[]; onBack: () => void; onEdit: () => void; onDelete: () => void; onFavorite: () => void;
  onGroups: () => void; onPhoto: (f: File | null) => Promise<void>; exportHref: string;
}) {
  const photoRef = useRef<HTMLInputElement>(null);
  const sub = [c.jobTitle, c.department, c.company].filter(Boolean).join(" · ");
  const inGroups = groups.filter((g) => c.groups.includes(g.id));
  return (
    <div className="card">
      <div className="cardtools">
        <button className="iconbtn back" aria-label="Back to list" onClick={onBack}><ArrowLeft size={18} /></button>
        <span className="grow" />
        <button className={`iconbtn${c.favorite ? " on" : ""}`} aria-label={c.favorite ? "Remove from favorites" : "Add to favorites"} aria-pressed={c.favorite} onClick={onFavorite}>
          <Star size={18} className={c.favorite ? "starred" : ""} fill={c.favorite ? "currentColor" : "none"} />
        </button>
        <button className="iconbtn" aria-label="Add to group" onClick={onGroups}><Tag size={18} /></button>
        <a className="iconbtn" aria-label="Download vCard" href={exportHref}><Download size={18} /></a>
        <button className="iconbtn" aria-label="Delete contact" onClick={onDelete}><Trash2 size={18} /></button>
        <button className="btn" onClick={onEdit}><Pencil size={15} /> Edit</button>
      </div>
      <div className="cardhead">
        <button className="photo" aria-label={c.hasPhoto ? "Change photo" : "Add photo"} onClick={() => photoRef.current?.click()}>
          <Avatar name={c.displayName} size={88} src={c.hasPhoto ? `/api/contacts/${c.id}/photo?v=${encodeURIComponent(c.modifiedAt)}` : null} />
          <span className="photoedit"><Camera size={14} /></span>
        </button>
        <input ref={photoRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" hidden onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onPhoto(f);
        }} />
        <div>
          <h2 className="bigname">{c.displayName}</h2>
          {c.nickname && c.nickname !== c.displayName && <p className="muted">&ldquo;{c.nickname}&rdquo;</p>}
          {sub && <p className="muted">{sub}</p>}
          {c.hasPhoto && <button className="linkbtn small" onClick={() => void onPhoto(null)}>Remove photo</button>}
        </div>
      </div>
      <div className="quick">
        {c.emails[0] && <a className="btn" href={mailUrl(c.emails[0].value)} target="_blank" rel="noopener"><Mail size={16} /> Email</a>}
        {c.phones[0] && <a className="btn" href={`tel:${c.phones[0].value.replace(/[^\d+]/g, "")}`}><Phone size={16} /> Call</a>}
      </div>
      <dl className="facts">
        {c.emails.map((e, i) => (
          <Fact key={`e${i}`} icon={<Mail size={16} />} label={cap(e.label)}>
            <a href={mailUrl(e.value)} target="_blank" rel="noopener">{e.value}</a>
          </Fact>
        ))}
        {c.phones.map((p, i) => (
          <Fact key={`p${i}`} icon={<Phone size={16} />} label={cap(p.label)}>
            <a href={`tel:${p.value.replace(/[^\d+]/g, "")}`}>{p.value}</a>
          </Fact>
        ))}
        {c.addresses.map((a, i) => {
          const one = [a.street, [a.city, a.region, a.postcode].filter(Boolean).join(" "), a.country].filter(Boolean).join("\n");
          return (
            <Fact key={`a${i}`} icon={<MapPin size={16} />} label={cap(a.label)}>
              <a className="pre" href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(one.replace(/\n/g, ", "))}`} target="_blank" rel="noopener noreferrer">{one}</a>
            </Fact>
          );
        })}
        {c.websites.map((w, i) => (
          <Fact key={`w${i}`} icon={<Globe size={16} />} label={cap(w.label)}>
            <a href={w.value} target="_blank" rel="noopener noreferrer nofollow">{w.value.replace(/^https?:\/\//, "")}</a>
          </Fact>
        ))}
        {c.birthday && <Fact icon={<Cake size={16} />} label="Birthday">{formatBirthday(c.birthday)}</Fact>}
        {inGroups.length > 0 && (
          <Fact icon={<Tag size={16} />} label="Groups">
            <span className="chips">{inGroups.map((g) => <span key={g.id} className="chip">{g.name}</span>)}</span>
          </Fact>
        )}
        {c.notes && <Fact icon={<StickyNote size={16} />} label="Notes"><span className="pre">{c.notes}</span></Fact>}
      </dl>
    </div>
  );
}

function PersonCard({ p, isMe, people, onBack, onOpen, onEditProfile, onSave }: {
  p: Person; isMe: boolean; people: Person[]; onBack: () => void; onOpen: (email: string) => void; onEditProfile: () => void; onSave: () => void;
}) {
  const manager = p.manager ? people.find((x) => x.email === p.manager) : undefined;
  const reports = people.filter((x) => x.manager === p.email);
  return (
    <div className="card">
      <div className="cardtools">
        <button className="iconbtn back" aria-label="Back to list" onClick={onBack}><ArrowLeft size={18} /></button>
        <span className="grow" />
        {isMe ? (
          <button className="btn" onClick={onEditProfile}><Pencil size={15} /> Edit profile</button>
        ) : (
          <button className="btn" onClick={onSave}><Plus size={15} /> Add to contacts</button>
        )}
      </div>
      <div className="cardhead">
        <Avatar name={p.name} size={88} src={p.hasPhoto ? `/api/directory/${encodeURIComponent(p.email)}/photo` : null} />
        <div>
          <h2 className="bigname">{p.name}</h2>
          {(p.jobTitle || p.department) && <p className="muted">{[p.jobTitle, p.department].filter(Boolean).join(" · ")}</p>}
        </div>
      </div>
      <div className="quick">
        <a className="btn" href={mailUrl(p.email)} target="_blank" rel="noopener"><Mail size={16} /> Email</a>
        {(p.mobile || p.phone) && <a className="btn" href={`tel:${(p.mobile || p.phone).replace(/[^\d+]/g, "")}`}><Phone size={16} /> Call</a>}
      </div>
      <dl className="facts">
        <Fact icon={<Mail size={16} />} label="Email"><a href={mailUrl(p.email)} target="_blank" rel="noopener">{p.email}</a></Fact>
        {p.mobile && <Fact icon={<Phone size={16} />} label="Mobile"><a href={`tel:${p.mobile.replace(/[^\d+]/g, "")}`}>{p.mobile}</a></Fact>}
        {p.phone && <Fact icon={<Phone size={16} />} label="Work"><a href={`tel:${p.phone.replace(/[^\d+]/g, "")}`}>{p.phone}</a></Fact>}
        {p.office && <Fact icon={<MapPin size={16} />} label="Office">{p.office}</Fact>}
        {p.manager && (
          <Fact icon={<UserRound size={16} />} label="Manager">
            {manager ? <button className="linkbtn" onClick={() => onOpen(manager.email)}>{manager.name}</button> : p.manager}
          </Fact>
        )}
        {reports.length > 0 && (
          <Fact icon={<Users size={16} />} label="Reports">
            <span className="chips">{reports.map((r) => <button key={r.email} className="chip" onClick={() => onOpen(r.email)}>{r.name}</button>)}</span>
          </Fact>
        )}
        {p.about && <Fact icon={<StickyNote size={16} />} label="About"><span className="pre">{p.about}</span></Fact>}
      </dl>
      {isMe && !p.jobTitle && !p.phone && !p.mobile && (
        <p className="hint muted small">Add your title and phone number so people can find you. <button className="linkbtn" onClick={onEditProfile}>Edit profile</button></p>
      )}
    </div>
  );
}

function Fact({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="fact">
      <span className="facticon" aria-hidden>{icon}</span>
      <div>
        <dt>{label}</dt>
        <dd>{children}</dd>
      </div>
    </div>
  );
}
