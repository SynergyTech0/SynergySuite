import type { SearchObject } from "imapflow";

/**
 * A stand-in for imapflow's ImapFlow over an in-memory mail server, for tests that exercise the
 * IMAP boundary without a real server. It implements the calls Mail uses and enough of IMAP
 * SEARCH to evaluate what Mail sends (including the "n:*" rule: * is the highest UID).
 */

export type Msg = { uid: number; raw: Buffer; internalDate: Date; flags: Set<string> };
export type Folder = { uidValidity: bigint; nextUid: number; specialUse?: string; msgs: Msg[] };
export const server = {
  boxes: new Map<string, Map<string, Folder>>(),
  fetched: 0, // messages whose source was fetched
};

export function reset() {
  server.boxes.clear();
  server.fetched = 0;
}

export function mailbox(user: string, folders: Record<string, string | undefined> = { INBOX: "\\Inbox", Sent: "\\Sent", Trash: "\\Trash" }) {
  const m = new Map<string, Folder>();
  for (const [path, specialUse] of Object.entries(folders)) m.set(path, { uidValidity: 1n, nextUid: 1, specialUse, msgs: [] });
  server.boxes.set(user, m);
  return m;
}

export function deliver(user: string, folder: string, raw: string | Buffer, date = new Date("2026-03-01T10:00:00Z")): number {
  const f = server.boxes.get(user)!.get(folder)!;
  const uid = f.nextUid++;
  f.msgs.push({ uid, raw: Buffer.isBuffer(raw) ? raw : Buffer.from(raw), internalDate: date, flags: new Set() });
  return uid;
}

export function message(o: { id?: string; subject: string; from: string; to: string; body: string; date?: string; bcc?: string }): string {
  return [
    `From: ${o.from}`, `To: ${o.to}`, ...(o.bcc ? [`Bcc: ${o.bcc}`] : []), `Subject: ${o.subject}`,
    `Date: ${o.date ?? "Sun, 01 Mar 2026 10:00:00 +0000"}`, ...(o.id ? [`Message-ID: <${o.id}>`] : []),
    "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "", o.body, "",
  ].join("\r\n");
}

function header(raw: Buffer, name: string): string {
  const head = raw.toString("utf8").split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g, " ");
  const line = head.split(/\r?\n/).find((l) => l.toLowerCase().startsWith(name.toLowerCase() + ":"));
  return line ? line.slice(name.length + 1).trim() : "";
}

function inSet(uid: number, set: string, max: number): boolean {
  return set.split(",").some((part) => {
    const [a, b] = part.split(":").map((x) => (x === "*" ? max : Number(x)));
    if (b === undefined) return uid === a;
    return uid >= Math.min(a, b) && uid <= Math.max(a, b);
  });
}

const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

export function evaluate(m: Pick<Msg, "uid" | "raw">, s: SearchObject, maxUid = Infinity): boolean {
  const text = m.raw.toString("utf8").toLowerCase();
  for (const [k, v] of Object.entries(s)) {
    switch (k) {
      case "all": break;
      case "uid": if (!inSet(m.uid, String(v), maxUid)) return false; break;
      case "text": if (!text.includes(String(v).toLowerCase())) return false; break;
      case "or": if (!(v as SearchObject[]).some((x) => evaluate(m, x, maxUid))) return false; break;
      case "not": if (evaluate(m, v as SearchObject, maxUid)) return false; break;
      case "header":
        for (const [h, val] of Object.entries(v as Record<string, string>)) if (!header(m.raw, h).includes(val)) return false;
        break;
      case "sentSince": if (day(new Date(header(m.raw, "date"))) < day(new Date(v as Date))) return false; break;
      case "sentBefore": if (day(new Date(header(m.raw, "date"))) >= day(new Date(v as Date))) return false; break;
      default: throw new Error(`fake IMAP: unsupported search key ${k}`);
    }
  }
  return true;
}

export class FakeImapFlow {
  user: string;
  box: Map<string, Folder> | null = null;
  current: (Folder & { path: string }) | null = null;
  constructor(opts: { auth: { user: string } }) {
    this.user = opts.auth.user;
  }
  get mailbox() {
    return this.current ? { path: this.current.path, uidValidity: this.current.uidValidity, exists: this.current.msgs.length, uidNext: this.current.nextUid } : false;
  }
  async connect() {
    this.box = server.boxes.get(this.user) ?? null;
    if (!this.box) throw Object.assign(new Error("Authentication failed"), { authenticationFailed: true });
  }
  async logout() {}
  close() {}
  async list() {
    return [...this.box!.entries()].map(([path, f]) => ({ path, name: path, specialUse: f.specialUse, flags: new Set<string>(), parent: [] }));
  }
  async getMailboxLock(path: string) {
    const f = this.box!.get(path);
    if (!f) throw new Error(`no folder ${path}`);
    this.current = Object.assign(f, { path });
    return { path, release: () => { this.current = null; } };
  }
  private uids(range: string) {
    const max = Math.max(0, ...this.current!.msgs.map((m) => m.uid));
    return this.current!.msgs.filter((m) => inSet(m.uid, range, max));
  }
  private out(m: Msg, q: { source?: boolean; envelope?: boolean }) {
    if (q.source) server.fetched++;
    return {
      uid: m.uid, internalDate: m.internalDate, flags: new Set(m.flags), size: m.raw.length,
      ...(q.source ? { source: m.raw } : {}),
      ...(q.envelope ? { envelope: { messageId: header(m.raw, "message-id") || undefined, subject: header(m.raw, "subject") } } : {}),
    };
  }
  async search(s: SearchObject) {
    const max = Math.max(0, ...this.current!.msgs.map((m) => m.uid));
    return this.current!.msgs.filter((m) => evaluate(m, s, max)).map((m) => m.uid);
  }
  async fetchAll(range: string, q: { source?: boolean; envelope?: boolean }) {
    return this.uids(range).map((m) => this.out(m, q));
  }
  async *fetch(range: string, q: { source?: boolean; envelope?: boolean }) {
    for (const m of this.uids(range)) yield this.out(m, q);
  }
  async fetchOne(uid: string, q: { source?: boolean; envelope?: boolean }) {
    const m = this.uids(uid)[0];
    return m ? this.out(m, q) : false;
  }
  async messageMove(range: string, to: string) {
    const dest = this.box!.get(to)!;
    for (const m of this.uids(range)) {
      this.current!.msgs.splice(this.current!.msgs.indexOf(m), 1);
      dest.msgs.push({ ...m, uid: dest.nextUid++ });
    }
    return true;
  }
  async messageDelete(range: string) {
    for (const m of this.uids(range)) this.current!.msgs.splice(this.current!.msgs.indexOf(m), 1);
    return true;
  }
  async messageFlagsAdd() { return true; }
  async messageFlagsRemove() { return true; }
}
