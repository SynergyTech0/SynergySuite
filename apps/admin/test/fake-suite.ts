import type { ContactInput, DriveTarget, EventInput, MailPlace, MailState, Suite, TaskInput, Who } from "../lib/migrate/suite";
import { SuiteError } from "../lib/migrate/suite";

/**
 * The suite's apps in memory, recording every write the importers make, so tests can check
 * what each person ends up with (and that nothing was written twice).
 */

export type Msg = { folder: string; uid: number; raw: string; seen: boolean; flagged: boolean; date: string | null };
export type DItem = { id: string; owner: string; space: string; parent: string | null; kind: "file" | "folder"; name: string; body: string; versions: number; modifiedAt: string | null; trashed: boolean };

export class FakeSuite implements Suite {
  mail = new Map<string, Msg[]>();
  provisioned = new Set<string>();
  items: DItem[] = [];
  libraries: { id: string; name: string; owner: string; members: Map<string, string> }[] = [];
  events = new Map<string, { owner: string; e: EventInput }>();
  contacts = new Map<string, { owner: string; c: ContactInput }>();
  lists: { id: string; owner: string; name: string }[] = [];
  tasks = new Map<string, { owner: string; list: string | null; t: TaskInput }>();
  writes = 0;
  /** Makes the next N writes to an app fail as if it were down. */
  down = new Map<string, number>();
  private seq = 0;
  private nextUid = new Map<string, number>();

  private id(p: string) {
    return `${p}-${++this.seq}`;
  }

  private gate(app: string) {
    this.writes++;
    const n = this.down.get(app) ?? 0;
    if (n > 0) {
      this.down.set(app, n - 1);
      throw new SuiteError(app, 0, `Couldn't reach ${app}: connection failed`);
    }
  }

  folderName(place: MailPlace): string {
    const root = place.role === "inbox" ? "INBOX" : place.role === "sent" ? "Sent Items" : place.role === "trash" ? "Deleted Items" : place.role ? place.role : "";
    return [root, ...place.path].filter(Boolean).join("/");
  }

  async provisionMailbox(who: Who) {
    this.gate("mail");
    this.provisioned.add(who.email);
  }

  async mailAppend(who: Who, raw: Buffer, place: MailPlace, state: MailState) {
    this.gate("mail");
    const folder = this.folderName(place);
    const k = `${who.email}\n${folder}`;
    const uid = (this.nextUid.get(k) ?? 0) + 1;
    this.nextUid.set(k, uid);
    const list = this.mail.get(who.email) ?? [];
    list.push({ folder, uid, raw: raw.toString(), seen: state.seen, flagged: state.flagged, date: state.date ?? null });
    this.mail.set(who.email, list);
    return { folder, uid };
  }

  async mailUpdate(who: Who, at: { folder: string; uid: number }, state: MailState, moveTo?: MailPlace | null) {
    this.gate("mail");
    const m = (this.mail.get(who.email) ?? []).find((x) => x.folder === at.folder && x.uid === at.uid);
    if (!m) return null;
    m.seen = state.seen;
    m.flagged = state.flagged;
    if (moveTo) {
      const folder = this.folderName(moveTo);
      const k = `${who.email}\n${folder}`;
      const uid = (this.nextUid.get(k) ?? 0) + 1;
      this.nextUid.set(k, uid);
      m.folder = folder;
      m.uid = uid;
    }
    return { folder: m.folder, uid: m.uid };
  }

  private space(who: Who, at: DriveTarget): { space: string; parent: string | null } {
    if (at.parent) {
      const p = this.items.find((i) => i.id === at.parent && !i.trashed);
      if (!p || p.kind !== "folder") throw new SuiteError("drive", 404, "drive: Not found");
      return { space: p.space, parent: p.id };
    }
    return { space: at.library ? `l:${at.library}` : `u:${who.email}`, parent: null };
  }

  live(space: string): DItem[] {
    return this.items.filter((i) => i.space === space && !i.trashed);
  }

  pathOf(i: DItem): string {
    const parts = [i.name];
    let p = i.parent;
    while (p) {
      const it = this.items.find((x) => x.id === p)!;
      parts.unshift(it.name);
      p = it.parent;
    }
    return parts.join("/");
  }

  async driveFolder(who: Who, at: DriveTarget, name: string) {
    this.gate("drive");
    const s = this.space(who, at);
    const have = this.items.find((i) => i.space === s.space && i.parent === s.parent && i.name.toLowerCase() === name.toLowerCase() && !i.trashed);
    if (have) return have.id;
    const it: DItem = { id: this.id("f"), owner: who.email, ...s, kind: "folder", name, body: "", versions: 0, modifiedAt: null, trashed: false };
    this.items.push(it);
    return it.id;
  }

  async driveUpload(who: Who, at: DriveTarget, name: string, body: ReadableStream<Uint8Array> | Buffer | null, _size: number | null, modifiedAt: string | null) {
    this.gate("drive");
    const s = this.space(who, at);
    const text = body instanceof Buffer ? body.toString() : body ? await new Response(body as ReadableStream<Uint8Array>).text() : "";
    const have = this.items.find((i) => i.space === s.space && i.parent === s.parent && i.name.toLowerCase() === name.toLowerCase() && !i.trashed);
    if (have) {
      if (have.body !== text) {
        have.body = text;
        have.versions++;
      }
      have.modifiedAt = modifiedAt;
      return have.id;
    }
    const it: DItem = { id: this.id("d"), owner: who.email, ...s, kind: "file", name, body: text, versions: 1, modifiedAt, trashed: false };
    this.items.push(it);
    return it.id;
  }

  async driveRename(_who: Who, id: string, name: string) {
    this.gate("drive");
    const it = this.items.find((i) => i.id === id && !i.trashed);
    if (!it) throw new SuiteError("drive", 404, "drive: Not found");
    it.name = name;
  }

  async driveMove(who: Who, id: string, to: DriveTarget) {
    this.gate("drive");
    const it = this.items.find((i) => i.id === id && !i.trashed);
    if (!it) throw new SuiteError("drive", 404, "drive: Not found");
    Object.assign(it, this.space(who, to));
  }

  async driveTrash(_who: Who, id: string) {
    this.gate("drive");
    const it = this.items.find((i) => i.id === id && !i.trashed);
    if (!it) throw new SuiteError("drive", 404, "drive: Not found");
    it.trashed = true;
  }

  async driveLibrary(who: Who, name: string) {
    this.gate("drive");
    const lib = { id: this.id("lib"), name, owner: who.email, members: new Map([[who.email, "owner"]]) };
    this.libraries.push(lib);
    return lib.id;
  }

  async driveMember(_who: Who, library: string, email: string, role: string) {
    this.gate("drive");
    this.libraries.find((l) => l.id === library)!.members.set(email, role);
  }

  async eventCreate(who: Who, e: EventInput) {
    this.gate("calendar");
    const id = this.id("ev");
    this.events.set(id, { owner: who.email, e });
    return id;
  }

  async eventUpdate(who: Who, id: string, e: EventInput) {
    this.gate("calendar");
    if (!this.events.has(id)) throw new SuiteError("calendar", 404, "calendar: not found");
    this.events.set(id, { owner: who.email, e });
  }

  async eventDelete(_who: Who, id: string) {
    this.gate("calendar");
    if (!this.events.delete(id)) throw new SuiteError("calendar", 404, "calendar: not found");
  }

  async contactCreate(who: Who, c: ContactInput) {
    this.gate("contacts");
    const id = this.id("c");
    this.contacts.set(id, { owner: who.email, c });
    return id;
  }

  async contactUpdate(who: Who, id: string, c: ContactInput) {
    this.gate("contacts");
    if (!this.contacts.has(id)) throw new SuiteError("contacts", 404, "contacts: Not found");
    this.contacts.set(id, { owner: who.email, c });
  }

  async contactDelete(_who: Who, id: string) {
    this.gate("contacts");
    if (!this.contacts.delete(id)) throw new SuiteError("contacts", 404, "contacts: Not found");
  }

  async todoList(who: Who, name: string) {
    this.gate("todo");
    const l = { id: this.id("list"), owner: who.email, name };
    this.lists.push(l);
    return l.id;
  }

  async taskCreate(who: Who, listId: string | null, t: TaskInput) {
    this.gate("todo");
    const id = this.id("t");
    this.tasks.set(id, { owner: who.email, list: listId, t });
    return id;
  }

  async taskUpdate(who: Who, id: string, t: TaskInput) {
    this.gate("todo");
    const cur = this.tasks.get(id);
    if (!cur) throw new SuiteError("todo", 404, "todo: Not found");
    this.tasks.set(id, { ...cur, t });
  }

  async taskDelete(_who: Who, id: string) {
    this.gate("todo");
    if (!this.tasks.delete(id)) throw new SuiteError("todo", 404, "todo: Not found");
  }
}
