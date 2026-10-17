import apps from "@synergy/config/apps.json";
import { MARK_DATA_URI } from "./brand";

type App = (typeof apps)[number];

/**
 * <synergy-app-bar app="chat" user="jane@example.com" domain="example.com">
 *
 * The header every suite app shares: product name, the app launcher ("waffle") and the
 * signed-in user, with a search box that opens the Search app. Framework-agnostic, so the Next.js, Vite/React and plain-HTML apps can
 * all use the same element. Without a `domain`, launcher links point at localhost ports.
 *
 * With a `domain` and a signed-in `user`, it also listens to Phone, so a call rings on whichever
 * suite page you have open (calls="off" turns that off; Phone's own pages ring by themselves).
 *
 * The Copilot button opens a side panel with the Search app's /copilot page in a frame, told which
 * app the person is in and what they have open: the `context` attribute when the app sets one
 * (e.g. Mail sets "account=…&folder=…&uid=…" for the open message), else the page's path and query.
 * Changing `context` while the panel is open tells the panel without reloading it.
 *
 * The launcher shows what Account's Hub shows the signed-in person: it reads Account's
 * /api/launcher (with the sign-in cookie) after rendering, keeps the answer in sessionStorage for a
 * few minutes, and until then, or when that fails (signed out, Account down), lists the suite apps.
 */
const ICONS: Record<string, string> = {
  grid: "M4 4h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4zM4 10h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4zM4 16h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4z",
  spark: "M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9zM19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9z",
};

/** Apps that never show Copilot: Search has it built in, and Account's sign-in pages may not frame anything. */
const NO_COPILOT = new Set(["search", "auth"]);
const MAX_CONTEXT = 500;

/** What the person has open, as the panel receives it. */
export function copilotContext(attr: string | null, loc: { pathname: string; search: string } | null): string {
  const raw = attr ?? (loc ? `${loc.pathname}${loc.search}` : "");
  return raw.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, MAX_CONTEXT);
}

/** The panel's address: Search's /copilot with the app and context. */
export function copilotUrl(searchUrl: string, app: string, context: string): string {
  const q = new URLSearchParams({ app, context });
  return `${searchUrl}/copilot?${q}`;
}

function urlFor(app: App, domain: string | null): string {
  return domain ? `https://${app.id}.${domain}` : `http://localhost:${app.port}`;
}

/** One launcher group as Account's /api/launcher sends it. */
export type LauncherGroup = { category: string; apps: { slug: string; name: string; url: string; suite: boolean }[] };
type Link = { id: string; name: string; href: string };

const LAUNCHER_TTL = 5 * 60_000;

/** The launcher's links: Account's groups when it answered, else the suite apps as one group. */
export function launcherLinks(groups: LauncherGroup[] | null, domain: string | null): { category: string; links: Link[] }[] {
  if (!groups) {
    const launchable = apps.filter((a) => a.core && !("planned" in a && a.planned));
    return [{ category: "", links: launchable.map((a) => ({ id: a.id, name: a.name, href: urlFor(a, domain) })) }];
  }
  return groups
    .map((g) => ({
      category: g.category,
      links: g.apps.flatMap((a): Link[] => {
        // A suite app opens where this bar says suite apps live; a linked app at its own http(s) address.
        const suite = a.suite ? apps.find((x) => x.id === a.slug) : undefined;
        const href = suite ? urlFor(suite, domain) : /^https?:\/\//i.test(a.url) ? a.url : "";
        return href ? [{ id: a.slug, name: a.name || a.slug, href }] : [];
      }),
    }))
    .filter((g) => g.links.length);
}

function validGroups(v: unknown): v is LauncherGroup[] {
  return (
    Array.isArray(v) &&
    v.every(
      (g) =>
        g && typeof g.category === "string" && Array.isArray(g.apps) &&
        g.apps.every((a: any) => a && typeof a.slug === "string" && typeof a.name === "string" && typeof a.url === "string"),
    )
  );
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

type Ring = { id: string; fromName: string; via: string | null };

export class SynergyAppBar extends HTMLElement {
  static observedAttributes = ["app", "user", "domain", "calls", "context"];
  private open = false;
  private copilotOpen = false;
  private panel: HTMLElement | null = null;
  private events: EventSource | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private backoff = 15_000;
  private rings = new Map<string, Ring>();
  private groups: LauncherGroup[] | null = null;
  private loading = 0;

  connectedCallback() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.groups = this.cachedGroups();
    this.render();
    document.addEventListener("keydown", this.onKeydown);
    document.addEventListener("click", this.onDocumentClick);
    this.listenForCalls();
    this.loadGroups();
  }

  disconnectedCallback() {
    this.closeCopilot();
    document.removeEventListener("keydown", this.onKeydown);
    document.removeEventListener("click", this.onDocumentClick);
    this.stopListening();
  }

  private phoneUrl(): string | null {
    const domain = this.getAttribute("domain");
    const phone = apps.find((a) => a.id === "phone");
    if (!domain || !phone || !this.getAttribute("user")) return null;
    if (this.getAttribute("app") === "phone" || this.getAttribute("calls") === "off") return null;
    return urlFor(phone, domain);
  }

  private launcherUrl(): string {
    const authApp = apps.find((a) => a.id === "auth");
    return authApp ? `${urlFor(authApp, this.getAttribute("domain"))}/api/launcher` : "";
  }

  private cacheKey(): string {
    return `synergy-launcher:${this.launcherUrl()}:${this.getAttribute("user") ?? ""}`;
  }

  private cachedGroups(): LauncherGroup[] | null {
    try {
      const c = JSON.parse(sessionStorage.getItem(this.cacheKey()) ?? "null");
      return c && Date.now() - c.at < LAUNCHER_TTL && validGroups(c.groups) ? c.groups : null;
    } catch {
      return null;
    }
  }

  /** The person's apps from Account, swapped into the launcher; the suite list stays on any failure. */
  private async loadGroups() {
    const url = this.launcherUrl();
    const token = ++this.loading;
    const cached = this.cachedGroups();
    if (cached || !url || typeof fetch === "undefined") return this.setGroups(cached);
    // Someone else's list (the user changed) never stays up while this one loads.
    if (this.groups) this.setGroups(null);
    let groups: LauncherGroup[] | null = null;
    try {
      const res = await fetch(url, { credentials: "include", headers: { accept: "application/json" } });
      const body = res.ok ? await res.json() : null;
      if (validGroups(body?.groups) && body.groups.length) groups = body.groups;
    } catch {
      /* Account unreachable or not allowed from here */
    }
    if (token !== this.loading) return;
    if (groups) {
      try {
        sessionStorage.setItem(this.cacheKey(), JSON.stringify({ at: Date.now(), groups }));
      } catch {
        /* storage full or blocked */
      }
    }
    this.setGroups(groups);
  }

  private setGroups(groups: LauncherGroup[] | null) {
    this.groups = groups;
    // Don't swap the links out from under someone moving through them; it happens on close instead.
    if (!(this.open && this.shadowRoot?.activeElement?.closest("nav"))) this.renderNav();
  }

  private renderNav() {
    const nav = this.shadowRoot?.querySelector("nav");
    if (!nav) return;
    const current = this.getAttribute("app") ?? "";
    const domain = this.getAttribute("domain");
    // The Hub (in Account) is the full-page view of the same list.
    const authApp = apps.find((a) => a.id === "auth");
    const hubUrl = authApp ? `${urlFor(authApp, domain)}/hub` : "";
    const groups = launcherLinks(this.groups, domain);
    nav.innerHTML = `${groups
      .map(
        (g) =>
          `${groups.length > 1 ? `<h2>${esc(g.category)}</h2>` : ""}${g.links
            .map((l) => `<a href="${esc(l.href)}" ${l.id === current ? 'aria-current="page"' : ""}>${esc(l.name)}</a>`)
            .join("")}`,
      )
      .join("")}
      ${hubUrl ? `<a class="all" href="${esc(hubUrl)}">All apps</a>` : ""}`;
  }

  private stopListening() {
    this.events?.close();
    this.events = null;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
  }

  /** Phone's live events, sent with the suite's sign-in cookie. Backs off when Phone isn't there. */
  private listenForCalls() {
    this.stopListening();
    const base = this.phoneUrl();
    if (!base || typeof EventSource === "undefined") return;
    const es = new EventSource(`${base}/api/events`, { withCredentials: true });
    this.events = es;
    es.onopen = () => (this.backoff = 15_000);
    es.onmessage = (m) => {
      let e: { type?: string; call?: { id: string; fromName: string; via: string | null }; callId?: string };
      try {
        e = JSON.parse(m.data);
      } catch {
        return;
      }
      if (e.type === "ring" && e.call) {
        this.rings.set(e.call.id, { id: e.call.id, fromName: e.call.fromName, via: e.call.via });
        if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
          const n = new Notification(`Call from ${e.call.fromName}`, { body: "Answer in Synergy Phone", tag: e.call.id });
          n.onclick = () => {
            window.open(base, "synergy-phone");
            n.close();
          };
        }
      } else if (e.type === "ring-stop" && e.callId) this.rings.delete(e.callId);
      else return;
      this.renderRings();
    };
    es.onerror = () => {
      es.close();
      this.events = null;
      this.retry = setTimeout(() => this.listenForCalls(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 600_000);
    };
  }

  private renderRings() {
    const box = this.shadowRoot?.querySelector(".rings");
    const base = this.phoneUrl();
    if (!box || !base) return;
    box.innerHTML = [...this.rings.values()]
      .map((r) => `<div class="ring" role="alert"><div><strong>${esc(r.fromName)}</strong><br><small>${r.via ? `Put through by ${esc(r.via)}` : "is calling you"}</small></div>
        <a href="${esc(base)}/" target="synergy-phone">Answer in Phone</a><button data-dismiss="${esc(r.id)}" aria-label="Dismiss">×</button></div>`)
      .join("");
    box.querySelectorAll<HTMLButtonElement>("button[data-dismiss]").forEach((b) =>
      b.addEventListener("click", () => {
        this.rings.delete(b.dataset.dismiss!);
        this.renderRings();
      }),
    );
  }

  attributeChangedCallback(name: string) {
    if (!this.shadowRoot) return;
    // A new context goes to the open panel; the bar itself doesn't change.
    if (name === "context") return this.sendContext();
    this.render();
    if (name !== "calls" && name !== "domain" && name !== "user" && name !== "app") return;
    if (!this.isConnected) return;
    this.listenForCalls();
    if (name === "domain" || name === "user") this.loadGroups();
  }

  /** Show or hide the launcher without re-rendering, so focus stays on the launcher button. */
  private setOpen(open: boolean) {
    if (!open && this.open) this.renderNav();
    this.open = open;
    this.shadowRoot?.querySelector("button")?.setAttribute("aria-expanded", String(open));
    this.shadowRoot?.querySelector("nav")?.toggleAttribute("hidden", !open);
  }

  private searchUrl(): string | null {
    const search = apps.find((a) => a.id === "search");
    return search ? urlFor(search, this.getAttribute("domain")) : null;
  }

  private hasCopilot(): boolean {
    return !NO_COPILOT.has(this.getAttribute("app") ?? "") && this.searchUrl() !== null;
  }

  private context(): string {
    return copilotContext(this.getAttribute("context"), typeof location === "undefined" ? null : location);
  }

  /** Tells the open panel what the person has open now, only ever to Search's own origin. */
  private sendContext() {
    const frame = this.panel?.querySelector("iframe");
    const base = this.searchUrl();
    if (!frame?.contentWindow || !base) return;
    frame.contentWindow.postMessage({ type: "synergy-copilot-context", app: this.getAttribute("app") ?? "", context: this.context() }, new URL(base).origin);
  }

  private toggleCopilot() {
    if (this.copilotOpen) this.closeCopilot();
    else this.openCopilot();
  }

  private openCopilot() {
    const base = this.searchUrl();
    if (!base || !this.shadowRoot) return;
    this.copilotOpen = true;
    if (!this.panel) {
      const src = copilotUrl(base, this.getAttribute("app") ?? "", this.context());
      const panel = document.createElement("aside");
      panel.className = "copilot";
      panel.setAttribute("aria-label", "Copilot");
      panel.innerHTML = `<div class="cp-head"><strong>Copilot</strong>
          <a class="cp-pop" href="${esc(src)}" target="_blank" rel="noopener">Open in a new tab</a>
          <button class="cp-close" aria-label="Close Copilot">×</button></div>
        <iframe title="Copilot" src="${esc(src)}" allow="clipboard-write"></iframe>`;
      panel.querySelector(".cp-close")!.addEventListener("click", () => this.closeCopilot());
      // Keep the pop-out link on the current context.
      panel.querySelector(".cp-pop")!.addEventListener("click", (e) => {
        (e.currentTarget as HTMLAnchorElement).href = copilotUrl(base, this.getAttribute("app") ?? "", this.context());
      });
      this.panel = panel;
    } else {
      this.sendContext();
    }
    this.panel.hidden = false;
    if (!this.panel.isConnected) this.shadowRoot.appendChild(this.panel);
    this.shadowRoot.querySelector(".cp-btn")?.setAttribute("aria-expanded", "true");
  }

  private closeCopilot() {
    this.copilotOpen = false;
    if (this.panel) this.panel.hidden = true;
    this.shadowRoot?.querySelector(".cp-btn")?.setAttribute("aria-expanded", "false");
  }

  private onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.copilotOpen && this.shadowRoot?.activeElement != null && !this.open) {
      this.closeCopilot();
      (this.shadowRoot.querySelector(".cp-btn") as HTMLElement | null)?.focus();
      return;
    }
    if (e.key !== "Escape" || !this.open) return;
    const focusInside = this.shadowRoot?.activeElement != null;
    this.setOpen(false);
    if (focusInside) this.shadowRoot!.querySelector("button")!.focus();
  };

  private onDocumentClick = (e: MouseEvent) => {
    if (this.open && !e.composedPath().includes(this)) this.setOpen(false);
  };

  private render() {
    const current = this.getAttribute("app") ?? "";
    const user = this.getAttribute("user") ?? "";
    const domain = this.getAttribute("domain");
    const here = apps.find((a) => a.id === current);
    // The Search app has its own big box, so the bar's box is left out there.
    const searchApp = current === "search" ? undefined : apps.find((a) => a.id === "search");
    const searchUrl = searchApp ? urlFor(searchApp, domain) : "";

    // The bar lives in its own box so re-rendering it never moves (and so reloads) the panel's frame.
    let root = this.shadowRoot!.querySelector<HTMLElement>(".bar-root");
    if (!root) {
      root = document.createElement("div");
      root.className = "bar-root";
      this.shadowRoot!.prepend(root);
    }
    root.innerHTML = `
      <style>
        :host { display: block; font: 14px/1.4 system-ui, sans-serif;
                --bar-bg: #ffffff; --bar-fg: #011b3e; --bar-line: #e3e8f1; --bar-hover: rgba(1,27,62,.07);
                --bar-field: #eef2f8; --bar-field-line: #dbe2ee; --bar-focus: #2b4fe0; }
        @media (prefers-color-scheme: dark) {
          :host { --bar-bg: #011b3e; --bar-fg: #f1f5ff; --bar-line: #0f2a55; --bar-hover: rgba(255,255,255,.12);
                  --bar-field: rgba(255,255,255,.08); --bar-field-line: rgba(255,255,255,.18); --bar-focus: #19c2f0; }
        }
        header { display: flex; align-items: center; gap: 10px; height: 48px; padding: 0 12px; background: var(--bar-bg); color: var(--bar-fg);
                 border-bottom: 1px solid var(--bar-line); }
        button { all: unset; cursor: pointer; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 6px; }
        button:hover, button:focus-visible { background: var(--bar-hover); }
        .brand { display: flex; align-items: center; gap: 8px; min-width: 0; }
        .brand img { width: 34px; height: 34px; flex: none; }
        .name { font-weight: 800; letter-spacing: .01em; white-space: nowrap; }
        .name span { font-weight: 500; opacity: .75; }
        .user { margin-left: auto; opacity: .85; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        form { margin: 0 0 0 auto; flex: 0 1 280px; min-width: 120px; }
        form + .user { margin-left: 0; }
        form input { box-sizing: border-box; width: 100%; height: 30px; padding: 0 10px; border: 1px solid var(--bar-field-line); border-radius: 6px;
                     background: var(--bar-field); color: inherit; font: inherit; }
        form input::placeholder { color: inherit; opacity: .7; }
        form input:focus { outline: 2px solid var(--bar-focus); outline-offset: 0; }
        @media (max-width: 640px) { form { display: none; } form + .user { margin-left: auto; } }
        nav { position: absolute; top: 52px; left: 8px; z-index: 1000; display: grid; grid-template-columns: repeat(3, 96px); gap: 4px;
              max-height: calc(100vh - 64px); overflow-y: auto;
              padding: 12px; background: #fff; color: #111827; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.18); }
        nav[hidden] { display: none; }
        nav a { padding: 10px 4px; text-align: center; color: inherit; text-decoration: none; border-radius: 6px; }
        nav a:hover, nav a:focus-visible { background: #f3f4f6; }
        nav a[aria-current] { font-weight: 600; }
        nav h2 { grid-column: 1 / -1; margin: 8px 4px 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; }
        nav h2:first-child { margin-top: 0; }
        nav a.all { grid-column: 1 / -1; border-top: 1px solid #e5e7eb; border-radius: 0 0 6px 6px; color: #2b4fe0; font-weight: 600; }
        svg { width: 20px; height: 20px; fill: currentColor; }
        .rings { position: fixed; top: 56px; right: 12px; z-index: 1001; display: flex; flex-direction: column; gap: 8px; }
        .ring { display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: #fff; color: #111827; border-radius: 12px;
                box-shadow: 0 10px 30px rgba(0,0,0,.22); border-left: 4px solid #107c41; }
        .ring a { background: #107c41; color: #fff; text-decoration: none; padding: 7px 12px; border-radius: 999px; font-weight: 600; white-space: nowrap; }
        .ring button { width: 26px; height: 26px; font-size: 18px; }
        .cp-btn { width: auto; padding: 0 10px; gap: 6px; display: inline-flex; align-items: center; font-weight: 600; flex: none; margin-left: auto; }
        form + .cp-btn, .cp-btn + .user { margin-left: 0; }
        .cp-btn[aria-expanded="true"] { background: var(--bar-hover); }
        @media (max-width: 640px) { .cp-btn span { display: none; } form + .cp-btn { margin-left: auto; } }
        .copilot { position: fixed; top: 48px; right: 0; bottom: 0; z-index: 999; width: min(420px, 100vw); display: flex; flex-direction: column;
                   background: var(--bar-bg); color: var(--bar-fg); border-left: 1px solid var(--bar-line); box-shadow: -8px 0 24px rgba(0,0,0,.12); }
        .copilot[hidden] { display: none; }
        .cp-head { display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 8px 0 14px; border-bottom: 1px solid var(--bar-line); }
        .cp-pop { margin-left: auto; color: inherit; opacity: .8; font-size: 12px; }
        .cp-close { width: 28px; height: 28px; font-size: 20px; }
        .copilot iframe { flex: 1; width: 100%; border: 0; background: transparent; }
      </style>
      <header>
        <button aria-label="App launcher" aria-expanded="${this.open}"><svg viewBox="0 0 24 24"><path d="${ICONS.grid}"/></svg></button>
        <span class="brand"><img src="${MARK_DATA_URI}" alt=""><span class="name">Synergy${here ? ` <span>${esc(here.name)}</span>` : ""}</span></span>
        ${searchApp ? `<form role="search" action="${esc(searchUrl)}/" method="get"><input type="search" name="q" aria-label="Search the suite" placeholder="Search" maxlength="500" autocomplete="off"></form>` : ""}
        ${this.hasCopilot() ? `<button class="cp-btn" aria-label="Copilot" aria-expanded="${this.copilotOpen}" title="Copilot"><svg viewBox="0 0 24 24"><path d="${ICONS.spark}"/></svg><span>Copilot</span></button>` : ""}
        <span class="user">${esc(user)}</span>
      </header>
      <nav aria-label="Apps" ${this.open ? "" : "hidden"}></nav>
      <div class="rings"></div>`;

    this.renderNav();
    this.shadowRoot!.querySelector("button")!.addEventListener("click", () => this.setOpen(!this.open));
    this.shadowRoot!.querySelector(".cp-btn")?.addEventListener("click", () => this.toggleCopilot());
    // The panel survives a re-render, so a conversation isn't lost when the bar's attributes change.
    if (this.panel && !this.hasCopilot()) {
      this.panel.remove();
      this.panel = null;
      this.copilotOpen = false;
    }
    const form = this.shadowRoot!.querySelector("form");
    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = form.querySelector("input")!.value.trim();
      if (q) window.location.href = `${searchUrl}/?q=${encodeURIComponent(q)}`;
    });
    this.renderRings();
  }
}

if (typeof customElements !== "undefined" && !customElements.get("synergy-app-bar")) {
  customElements.define("synergy-app-bar", SynergyAppBar);
}
