"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderPane } from "./FolderPane";
import { MessageList } from "./MessageList";
import { ReadingPane, type ReplyKind } from "./ReadingPane";
import { Compose, type Draft } from "./Compose";
import { AddAccount } from "./AddAccount";
import {
  api, postJson, escapeHtml, fullAddress,
  type AccountSummary, type Folder, type MessageDetail, type MessageSummary,
} from "@/lib/client";

type Where = { account: string; folder: string };

function readDeepLink(sp: URLSearchParams): (Where & { uid: number }) | null {
  const account = sp.get("account");
  const folder = sp.get("folder");
  const uid = Number(sp.get("uid"));
  return account && folder && Number.isInteger(uid) && uid > 0 ? { account, folder, uid } : null;
}
const PAGE = 50;

/** Copilot's "draft an email" opens /#draft=<base64url JSON {to, cc, subject, body}>: compose, filled in, never sent. */
export function readDraftLink(hash: string): { to: string; cc: string; subject: string; body: string } | null {
  const m = /^#draft=([A-Za-z0-9_-]{1,40000})$/.exec(hash);
  if (!m) return null;
  try {
    const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const v = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    const s = (x: unknown, max: number) => (typeof x === "string" ? x.slice(0, max) : "");
    return { to: s(v?.to, 2000), cc: s(v?.cc, 2000), subject: s(v?.subject, 300), body: s(v?.body, 8000) };
  } catch {
    return null;
  }
}

/** Plain text as compose paragraphs. */
export function textToHtml(text: string): string {
  const paras = text.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`);
  return paras.join("") || "<p><br></p>";
}

/** Tells the suite header's Copilot which message is open, so "summarize this" and "reply to this" know. */
function setCopilotContext(ctx: string | null) {
  const bar = document.querySelector("synergy-app-bar");
  if (!bar) return;
  if (ctx) bar.setAttribute("context", ctx);
  else bar.setAttribute("context", "");
}

export function MailApp({ me, aiOn = false }: { me: string; aiOn?: boolean }) {
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [canAddAccounts, setCanAddAccounts] = useState(false);
  const [folders, setFolders] = useState<Record<string, Folder[] | undefined>>({});
  const [where, setWhere] = useState<Where | null>(null);
  const [search, setSearch] = useState("");
  const [messages, setMessages] = useState<MessageSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const listSeq = useRef(0);

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3500); };

  const loadFolders = useCallback(async (account: string) => {
    try {
      const { folders: fs } = await api<{ folders: Folder[] }>(`/api/folders?account=${account}`);
      setFolders((cur) => ({ ...cur, [account]: fs }));
      return fs;
    } catch (e) {
      setFolders((cur) => ({ ...cur, [account]: [] }));
      flash((e as Error).message);
      return [];
    }
  }, []);

  // Search opens /?account=<id>&folder=<path>&uid=<n> to show one message.
  const deepLink = useRef(typeof window === "undefined" ? null : readDeepLink(new URL(location.href).searchParams));

  const loadAccounts = useCallback(async () => {
    const { accounts: as, canAddAccounts: canAdd } = await api<{ accounts: AccountSummary[]; canAddAccounts: boolean }>("/api/accounts");
    setAccounts(as);
    setCanAddAccounts(canAdd);
    if (!as.length) setListError(`No mailbox is set up for ${me} yet. Use Add account to connect one.`);
    const loaded = await Promise.all(as.map((a) => loadFolders(a.id)));
    setWhere((w) => {
      if (w && as.some((a) => a.id === w.account)) return w;
      const link = deepLink.current;
      if (link && as.some((a) => a.id === link.account)) return { account: link.account, folder: link.folder };
      const i = loaded.findIndex((fs) => fs.length > 0);
      if (i < 0) return null;
      const inbox = loaded[i].find((f) => f.role === "\\Inbox") ?? loaded[i][0];
      return { account: as[i].id, folder: inbox.path };
    });
  }, [loadFolders, me]);

  useEffect(() => { loadAccounts().catch((e) => flash(e.message)); }, [loadAccounts]);

  // Contacts and other apps open /?compose=<addresses> to start a message.
  const composeTo = useRef<string | null>(typeof window === "undefined" ? null : new URL(location.href).searchParams.get("compose"));
  useEffect(() => {
    if (composeTo.current === null || !accounts.length) return;
    const to = composeTo.current;
    composeTo.current = null;
    history.replaceState(null, "", "/");
    setDraft({ account: where?.account ?? accounts[0].id, to: to.split(",").map((s) => s.trim()).filter(Boolean).join(", "), cc: "", bcc: "", subject: "", html: "<p><br></p>" });
  }, [accounts, where]);

  const draftLink = useRef(typeof window === "undefined" ? null : readDraftLink(location.hash));
  useEffect(() => {
    if (!draftLink.current || !accounts.length) return;
    const d = draftLink.current;
    draftLink.current = null;
    history.replaceState(null, "", "/");
    setDraft({ account: where?.account ?? accounts[0].id, to: d.to, cc: d.cc, bcc: "", subject: d.subject, html: d.body ? textToHtml(d.body) : "<p><br></p>" });
  }, [accounts, where]);

  useEffect(() => {
    setCopilotContext(where && selected !== null && detail ? new URLSearchParams({ account: where.account, folder: where.folder, uid: String(selected) }).toString() : null);
  }, [where, selected, detail]);

  const loadMessages = useCallback(async (w: Where, q: string, p: number) => {
    const seq = ++listSeq.current;
    if (p === 0) setMessages(null);
    setListError(null);
    try {
      const params = new URLSearchParams({ account: w.account, folder: w.folder, page: String(p) });
      if (q) params.set("q", q);
      const out = await api<{ total: number; messages: MessageSummary[] }>(`/api/messages?${params}`);
      if (seq !== listSeq.current) return;
      setTotal(out.total);
      setMessages((cur) => (p === 0 || !cur ? out.messages : [...cur, ...out.messages]));
    } catch (e) {
      if (seq === listSeq.current) setListError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!where) return;
    setPage(0);
    setSelected(null);
    setDetail(null);
    loadMessages(where, search, 0);
  }, [where, search, loadMessages]);

  // Check for new mail every minute, like a desktop client.
  useEffect(() => {
    const t = setInterval(() => {
      if (!where || search || page > 0) return;
      loadMessages(where, "", 0);
      accounts.forEach((a) => loadFolders(a.id));
    }, 60_000);
    return () => clearInterval(t);
  }, [where, search, page, accounts, loadMessages, loadFolders]);

  const openMessage = useCallback(async (m: MessageSummary, images = false) => {
    if (!where) return;
    setDraft(null);
    setSelected(m.uid);
    setDetailLoading(true);
    setDetailError(null);
    if (!images) setDetail(null);
    try {
      const params = new URLSearchParams({ account: where.account, folder: where.folder, uid: String(m.uid) });
      if (images) params.set("images", "1");
      const d = await api<MessageDetail>(`/api/message?${params}`);
      setDetail(d);
      if (!m.seen) {
        setMessages((cur) => cur?.map((x) => (x.uid === m.uid ? { ...x, seen: true } : x)) ?? cur);
        setFolders((cur) => ({
          ...cur,
          [where.account]: cur[where.account]?.map((f) => (f.path === where.folder ? { ...f, unread: Math.max(0, f.unread - 1) } : f)),
        }));
      }
    } catch (e) {
      setDetailError((e as Error).message);
    } finally {
      setDetailLoading(false);
    }
  }, [where]);

  // Once the deep-linked folder's list has loaded, open the message (it needn't be on the first page).
  useEffect(() => {
    const link = deepLink.current;
    if (!link || !where || messages === null) return;
    if (where.account !== link.account || where.folder !== link.folder) return;
    deepLink.current = null;
    history.replaceState(null, "", "/");
    const m = messages.find((x) => x.uid === link.uid) ?? ({ uid: link.uid, seen: true } as MessageSummary);
    openMessage(m);
  }, [where, messages, openMessage]);

  async function act(action: "delete" | "archive" | "junk" | "unread" | "flag" | "unflag") {
    if (!where || selected === null) return;
    try {
      await postJson("/api/messages/change", { account: where.account, folder: where.folder, uids: [selected], action });
      if (action === "flag" || action === "unflag") {
        const flagged = action === "flag";
        setDetail((d) => (d ? { ...d, flagged } : d));
        setMessages((cur) => cur?.map((x) => (x.uid === selected ? { ...x, flagged } : x)) ?? cur);
      } else if (action === "unread") {
        setMessages((cur) => cur?.map((x) => (x.uid === selected ? { ...x, seen: false } : x)) ?? cur);
        setSelected(null);
        setDetail(null);
      } else {
        // Removed from this folder: select the next message, like Outlook.
        const list = messages ?? [];
        const i = list.findIndex((x) => x.uid === selected);
        const next = list[i + 1] ?? list[i - 1] ?? null;
        setMessages(list.filter((x) => x.uid !== selected));
        setTotal((t) => Math.max(0, t - 1));
        flash(action === "delete" ? "Deleted" : action === "archive" ? "Archived" : "Moved to Junk Email");
        if (next) openMessage(next); else { setSelected(null); setDetail(null); }
      }
      loadFolders(where.account);
    } catch (e) {
      flash((e as Error).message);
    }
  }

  function newMail() {
    const account = where?.account ?? accounts[0]?.id;
    if (!account) return flash("Add an account first");
    setSelected(null);
    setDetail(null);
    setDraft({ account, to: "", cc: "", bcc: "", subject: "", html: "<p><br></p>" });
  }

  function reply(kind: ReplyKind) {
    if (!detail || !where) return;
    const acct = accounts.find((a) => a.id === where.account);
    const mine = new Set(accounts.map((a) => a.address.toLowerCase()).concat(me.toLowerCase()));
    const replyTo = detail.replyTo.length ? detail.replyTo : detail.from ? [detail.from] : [];
    const others = [...detail.to, ...detail.cc].filter((p) => !mine.has(p.address.toLowerCase()) && !replyTo.some((r) => r.address === p.address));
    const prefix = kind === "forward" ? "Fw: " : "Re: ";
    const subject = /^(re|fw|fwd):/i.test(detail.subject) ? detail.subject : prefix + detail.subject;
    const header = [
      `<b>From:</b> ${escapeHtml(detail.from ? fullAddress(detail.from) : "")}`,
      `<b>Sent:</b> ${escapeHtml(detail.date ? new Date(detail.date).toLocaleString() : "")}`,
      `<b>To:</b> ${escapeHtml(detail.to.map(fullAddress).join("; "))}`,
      detail.cc.length ? `<b>Cc:</b> ${escapeHtml(detail.cc.map(fullAddress).join("; "))}` : "",
      `<b>Subject:</b> ${escapeHtml(detail.subject)}`,
    ].filter(Boolean).join("<br>");
    const original = detail.html ?? `<pre>${escapeHtml(detail.text)}</pre>`;
    setDraft({
      account: acct?.id ?? where.account,
      to: kind === "forward" ? "" : replyTo.map(fullAddress).join(", "),
      cc: kind === "replyAll" ? others.map(fullAddress).join(", ") : "",
      bcc: "",
      subject,
      html: `<p><br></p><hr><div>${header}</div><blockquote>${original}</blockquote>`,
      inReplyTo: kind === "forward" ? undefined : detail.messageId ?? undefined,
      references: kind === "forward" ? undefined : [...detail.references, ...(detail.messageId ? [detail.messageId] : [])],
    });
  }

  async function newFolder(account: string) {
    const name = prompt("Folder name");
    if (!name) return;
    try {
      await postJson("/api/folders", { account, name });
      loadFolders(account);
    } catch (e) {
      flash((e as Error).message);
    }
  }

  async function removeAccount(a: AccountSummary) {
    if (!confirm(`Remove ${a.address} from Mail? Its messages stay on its own server.`)) return;
    try {
      await api(`/api/accounts/${a.id}`, { method: "DELETE" });
      setFolders(({ [a.id]: _, ...rest }) => rest);
      if (where?.account === a.id) setWhere(null);
      loadAccounts();
    } catch (e) {
      flash((e as Error).message);
    }
  }

  const folder = useMemo(() => (where ? folders[where.account]?.find((f) => f.path === where.folder) : undefined), [folders, where]);
  const title = folder ? (folder.role === "\\Inbox" ? "Inbox" : folder.name) : "Mail";
  const sentView = folder?.role === "\\Sent" || folder?.role === "\\Drafts";
  const canMore = messages !== null && messages.length < total;

  return (
    <div className="mail">
      <FolderPane
        accounts={accounts} folders={folders} current={where}
        onSelect={(account, f) => { setDraft(null); setSearch(""); setWhere({ account, folder: f }); }}
        onNewMail={newMail} onAddAccount={canAddAccounts ? () => setAdding(true) : undefined} onRemoveAccount={removeAccount} onNewFolder={newFolder}
      />
      <MessageList
        title={title} messages={messages} total={total} selected={selected} sentView={sentView} search={search}
        onSearch={setSearch} onSelect={(m) => openMessage(m)} error={listError}
        onMore={canMore ? () => { const p = page + 1; setPage(p); if (where) loadMessages(where, search, p); } : null}
      />
      {draft ? (
        <Compose draft={draft} accounts={accounts} aiOn={aiOn} onClose={() => setDraft(null)}
          onSent={() => { setDraft(null); flash("Sent"); if (where) loadFolders(where.account); }} />
      ) : (
        <ReadingPane
          message={detail} loading={detailLoading} error={detailError}
          attachmentHref={(i) => where && selected !== null
            ? `/api/attachment?${new URLSearchParams({ account: where.account, folder: where.folder, uid: String(selected), index: String(i) })}` : "#"}
          onReply={reply} onAction={act}
          onShowImages={() => { const m = messages?.find((x) => x.uid === selected); if (m) openMessage(m, true); }}
        />
      )}
      {adding && <AddAccount onClose={() => setAdding(false)} onAdded={() => { setAdding(false); flash("Account added"); loadAccounts(); }} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
