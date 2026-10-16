// Spreadsheet comment threads, stored with the document's other comments in
// Postgres (comment_threads / comments, see /api/docs/[id]/comments) instead
// of inside the workbook. That way:
//   • authors are the signed-in Synergy users, set by the server, not names
//     the browser claims;
//   • commenters can comment even though they can't edit the sheet (their
//     collab connection is read-only);
//   • permissions match Docs: commenter+ to comment, authors edit their own
//     messages, editors or the thread's author delete.
//
// Univer's thread-comment UI drives it through its data-source hook: every
// add / edit / resolve / delete goes to the API first, then Univer applies it
// locally. Other people's changes arrive by refetching (on a nudge from the
// collab awareness channel, on focus, and every 30 s) and are applied as
// local-only mutations, so they never enter the shared op log.
/* eslint-disable @typescript-eslint/no-explicit-any */

const ADD = "thread-comment.mutation.add-comment";
const UPDATE = "thread-comment.mutation.update-comment";
const UPDATE_REF = "thread-comment.mutation.update-comment-ref";
const RESOLVE = "thread-comment.mutation.resolve-comment";
const DELETE = "thread-comment.mutation.delete-comment";
const LOCAL = { onlyLocal: true, fromCommentSync: true };

type ApiThread = {
  id: string;
  anchor: string;
  resolved: boolean;
  created_ms: string;
  messages: { id: string; author_email: string; author_name: string; body: string; created_ms: string }[];
};

type Comment = {
  id: string;
  threadId: string;
  ref: string;
  dT: string;
  updateT?: string;
  personId: string;
  text: { dataStream: string; paragraphs?: { startIndex: number }[]; sectionBreaks?: { startIndex: number }[]; textRuns?: unknown[]; customRanges?: unknown[] };
  parentId?: string;
  resolved?: boolean;
  unitId: string;
  subUnitId: string;
  children?: Comment[];
};

const pad = (n: number) => String(n).padStart(2, "0");
const dt = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const bodyToText = (body: Comment["text"] | undefined) => (body?.dataStream || "").replace(/\r?\n$/, "").replace(/\r/g, "\n").trim();
/** Plain text as a Univer document body: one paragraph per line. */
export const textToBody = (text: string): Comment["text"] => {
  const dataStream = `${text.replace(/\r?\n/g, "\r")}\r\n`;
  const paragraphs: { startIndex: number }[] = [];
  for (let i = 0; i < dataStream.length - 1; i++) if (dataStream[i] === "\r") paragraphs.push({ startIndex: i });
  return { dataStream, paragraphs, sectionBreaks: [{ startIndex: dataStream.length - 1 }] };
};

export type SheetCommentsHandle = { refresh: () => Promise<void>; dispose: () => void };

export function connectSheetComments(opts: {
  docId: string;
  univer: any;
  univerAPI: any;
  me: { email: string; name: string };
  /** Tell collaborators that comments changed (they refetch). */
  notify?: () => void;
  onError?: (message: string) => void;
}): SheetCommentsHandle {
  const { docId, univerAPI, me } = opts;
  const base = `/api/docs/${encodeURIComponent(docId)}/comments`;
  const injector = opts.univer.__getInjector();
  let disposed = false;
  const disposers: (() => void)[] = [];

  // Loaded lazily: the comment plugins are only in the browser bundle.
  const ready = (async () => {
    const core = await import("@univerjs/core");
    const tc = await import("@univerjs/thread-comment");
    const users = injector.get(core.UserManagerService);
    const dataSourceService = injector.get(tc.IThreadCommentDataSourceService);
    const model = injector.get(tc.ThreadCommentModel);
    return { users, dataSourceService, model };
  })();

  const unitId = () => univerAPI.getActiveWorkbook?.()?.getId?.() as string | undefined;
  const known = new Set<string>();
  const addUser = async (email: string, name: string) => {
    if (!email || known.has(email)) return;
    known.add(email);
    (await ready).users.addUser({ userID: email, name: name || email });
  };

  const call = async (url: string, init: RequestInit & { json?: unknown } = {}) => {
    const { json, ...rest } = init;
    const res = await fetch(url, {
      ...rest,
      headers: json !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
    if (!res.ok) {
      const msg =
        res.status === 403 ? "You don't have permission to do that with comments on this sheet." : `Comment could not be saved (${res.status}).`;
      opts.onError?.(msg);
      throw new Error(msg);
    }
    return res.json().catch(() => ({}));
  };
  const changed = () => opts.notify?.();

  // ---- Univer -> API ----------------------------------------------------------
  const dataSource = {
    async addComment(c: Comment): Promise<Comment> {
      const text = bodyToText(c.text);
      if (!c.parentId) {
        const threadId = c.threadId || c.id;
        await call(base, { method: "POST", json: { threadId, id: c.id, body: text, anchor: { sheetId: c.subUnitId, ref: c.ref } } });
        changed();
        return { ...c, threadId, personId: me.email };
      }
      await call(`${base}/${encodeURIComponent(c.threadId)}`, { method: "POST", json: { id: c.id, body: text } });
      changed();
      return { ...c, personId: me.email };
    },
    async updateComment(c: Comment) {
      await call(`${base}/${encodeURIComponent(c.threadId)}/${encodeURIComponent(c.id)}`, { method: "PATCH", json: { body: bodyToText(c.text) } });
      changed();
      return true;
    },
    async resolveComment(c: Comment) {
      await call(`${base}/${encodeURIComponent(c.threadId)}`, { method: "PATCH", json: { resolved: !!c.resolved } });
      changed();
      return true;
    },
    async deleteComment(_unit: string, _sub: string, threadId: string, commentId: string) {
      const url = commentId === threadId ? `${base}/${encodeURIComponent(threadId)}` : `${base}/${encodeURIComponent(threadId)}/${encodeURIComponent(commentId)}`;
      await call(url, { method: "DELETE" });
      changed();
      return true;
    },
    // Threads are loaded by refresh(), never through the model's own fetch.
    async listComments() {
      return [];
    },
    saveCommentToSnapshot: (c: Comment) => ({ id: c.id, threadId: c.threadId, ref: c.ref }),
  };

  // ---- API -> Univer ------------------------------------------------------------
  const run = (id: string, params: unknown) => {
    try {
      univerAPI.syncExecuteCommand(id, params, LOCAL);
    } catch {
      /* sheet or comment gone meanwhile */
    }
  };

  const toComments = (t: ApiThread, unit: string): Comment | null => {
    let anchor: { sheetId?: string; ref?: string } = {};
    try {
      anchor = JSON.parse(t.anchor || "{}");
    } catch {
      return null;
    }
    if (!anchor.sheetId || !anchor.ref || !t.messages.length) return null;
    const [first, ...rest] = t.messages;
    const common = { threadId: t.id, unitId: unit, subUnitId: anchor.sheetId };
    return {
      ...common,
      id: first.id,
      ref: anchor.ref,
      dT: dt(Number(first.created_ms)),
      personId: first.author_email,
      text: textToBody(first.body),
      resolved: t.resolved,
      children: rest.map((m) => ({ ...common, id: m.id, ref: "", dT: dt(Number(m.created_ms)), personId: m.author_email, text: textToBody(m.body), parentId: first.id })),
    };
  };

  let inflight: Promise<void> | null = null;
  const refresh = (): Promise<void> => {
    if (inflight) return inflight;
    inflight = (async () => {
      const unit = unitId();
      if (!unit || disposed) return;
      const { model } = await ready;
      const res = await fetch(base).catch(() => null);
      if (!res?.ok || disposed) return;
      const { threads } = (await res.json()) as { threads: ApiThread[] };
      for (const t of threads) for (const m of t.messages) await addUser(m.author_email, m.author_name);

      const wanted = new Map<string, Comment>();
      for (const t of threads) {
        const root = toComments(t, unit);
        if (root) wanted.set(t.id, root);
      }
      // What Univer holds now, per thread.
      const have = new Map<string, { root: Comment; children: Comment[] }>();
      for (const x of (model.getUnit(unit) || []) as any[])
        if (x?.root) have.set(x.threadId, { root: { ...x.root, subUnitId: x.subUnitId }, children: x.children || [] });

      for (const [threadId, cur] of have) {
        const next = wanted.get(threadId);
        if (!next || next.subUnitId !== cur.root.subUnitId || next.id !== cur.root.id) {
          run(DELETE, { unitId: unit, subUnitId: cur.root.subUnitId, commentId: cur.root.id });
          have.delete(threadId);
        }
      }
      for (const [threadId, next] of wanted) {
        const cur = have.get(threadId);
        if (!cur) {
          run(ADD, { unitId: unit, subUnitId: next.subUnitId, comment: next });
          continue;
        }
        const sub = next.subUnitId;
        if (cur.root.ref !== next.ref) run(UPDATE_REF, { unitId: unit, subUnitId: sub, payload: { commentId: next.id, ref: next.ref }, silent: true });
        if (!!cur.root.resolved !== !!next.resolved) run(RESOLVE, { unitId: unit, subUnitId: sub, commentId: next.id, resolved: !!next.resolved });
        if (bodyToText(cur.root.text) !== bodyToText(next.text)) run(UPDATE, { unitId: unit, subUnitId: sub, payload: { commentId: next.id, text: next.text }, silent: true });
        const curKids = new Map(cur.children.map((c) => [c.id, c]));
        const nextKids = new Map((next.children || []).map((c) => [c.id, c]));
        for (const id of curKids.keys()) if (!nextKids.has(id)) run(DELETE, { unitId: unit, subUnitId: sub, commentId: id });
        for (const [id, c] of nextKids) {
          const was = curKids.get(id);
          if (!was) run(ADD, { unitId: unit, subUnitId: sub, comment: c });
          else if (bodyToText(was.text) !== bodyToText(c.text)) run(UPDATE, { unitId: unit, subUnitId: sub, payload: { commentId: id, text: c.text }, silent: true });
        }
      }
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  };

  void (async () => {
    const { users, dataSourceService } = await ready;
    if (disposed) return;
    users.setCurrentUser({ userID: me.email, name: me.name || me.email });
    known.add(me.email);
    dataSourceService.syncUpdateMutationToColla = false;
    dataSourceService.dataSource = dataSource;

    // Inserting or deleting rows/columns moves comments; save where they went.
    const sub = univerAPI.onCommandExecuted?.((command: any, options: any) => {
      if (command?.id !== UPDATE_REF || options?.fromCommentSync) return;
      const { subUnitId, payload } = command.params || {};
      if (!payload?.commentId || !payload?.ref) return;
      void (async () => {
        const { model } = await ready;
        const comment = model.getComment(unitId(), subUnitId, payload.commentId);
        if (!comment || comment.parentId) return;
        await call(`${base}/${encodeURIComponent(comment.threadId)}`, { method: "PATCH", json: { anchor: { sheetId: subUnitId, ref: payload.ref } } }).catch(() => {});
      })();
    });
    if (sub?.dispose) disposers.push(() => sub.dispose());

    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    disposers.push(() => window.removeEventListener("focus", onFocus));
    const timer = setInterval(() => document.visibilityState === "visible" && void refresh(), 30_000);
    disposers.push(() => clearInterval(timer));
    await refresh();
  })();

  return {
    refresh,
    dispose: () => {
      disposed = true;
      disposers.forEach((d) => d());
      void ready.then(({ dataSourceService }) => {
        if (dataSourceService.dataSource === dataSource) dataSourceService.dataSource = null;
      });
    },
  };
}
