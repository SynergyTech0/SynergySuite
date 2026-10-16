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
 */
const ICONS: Record<string, string> = {
  grid: "M4 4h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4zM4 10h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4zM4 16h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4z",
};

function urlFor(app: App, domain: string | null): string {
  return domain ? `https://${app.id}.${domain}` : `http://localhost:${app.port}`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

type Ring = { id: string; fromName: string; via: string | null };

export class SynergyAppBar extends HTMLElement {
  static observedAttributes = ["app", "user", "domain", "calls"];
  private open = false;
  private events: EventSource | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private backoff = 15_000;
  private rings = new Map<string, Ring>();

  connectedCallback() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.render();
    document.addEventListener("keydown", this.onKeydown);
    document.addEventListener("click", this.onDocumentClick);
    this.listenForCalls();
  }

  disconnectedCallback() {
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
    this.render();
    if (name !== "calls" && name !== "domain" && name !== "user" && name !== "app") return;
    if (this.isConnected) this.listenForCalls();
  }

  /** Show or hide the launcher without re-rendering, so focus stays on the launcher button. */
  private setOpen(open: boolean) {
    this.open = open;
    this.shadowRoot?.querySelector("button")?.setAttribute("aria-expanded", String(open));
    this.shadowRoot?.querySelector("nav")?.toggleAttribute("hidden", !open);
  }

  private onKeydown = (e: KeyboardEvent) => {
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
    const launchable = apps.filter((a) => a.core && !("planned" in a && a.planned));
    // The Search app has its own big box, so the bar's box is left out there.
    const searchApp = current === "search" ? undefined : apps.find((a) => a.id === "search");
    const searchUrl = searchApp ? urlFor(searchApp, domain) : "";

    this.shadowRoot!.innerHTML = `
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
              padding: 12px; background: #fff; color: #111827; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.18); }
        nav[hidden] { display: none; }
        nav a { padding: 10px 4px; text-align: center; color: inherit; text-decoration: none; border-radius: 6px; }
        nav a:hover, nav a:focus-visible { background: #f3f4f6; }
        nav a[aria-current] { font-weight: 600; }
        svg { width: 20px; height: 20px; fill: currentColor; }
        .rings { position: fixed; top: 56px; right: 12px; z-index: 1001; display: flex; flex-direction: column; gap: 8px; }
        .ring { display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: #fff; color: #111827; border-radius: 12px;
                box-shadow: 0 10px 30px rgba(0,0,0,.22); border-left: 4px solid #107c41; }
        .ring a { background: #107c41; color: #fff; text-decoration: none; padding: 7px 12px; border-radius: 999px; font-weight: 600; white-space: nowrap; }
        .ring button { width: 26px; height: 26px; font-size: 18px; }
      </style>
      <header>
        <button aria-label="App launcher" aria-expanded="${this.open}"><svg viewBox="0 0 24 24"><path d="${ICONS.grid}"/></svg></button>
        <span class="brand"><img src="${MARK_DATA_URI}" alt=""><span class="name">Synergy${here ? ` <span>${esc(here.name)}</span>` : ""}</span></span>
        ${searchApp ? `<form role="search" action="${esc(searchUrl)}/" method="get"><input type="search" name="q" aria-label="Search the suite" placeholder="Search" maxlength="500" autocomplete="off"></form>` : ""}
        <span class="user">${esc(user)}</span>
      </header>
      <nav aria-label="Apps" ${this.open ? "" : "hidden"}>
        ${launchable
          .map((a) => `<a href="${esc(urlFor(a, domain))}" ${a.id === current ? 'aria-current="page"' : ""}>${esc(a.name)}</a>`)
          .join("")}
      </nav>
      <div class="rings"></div>`;

    this.shadowRoot!.querySelector("button")!.addEventListener("click", () => this.setOpen(!this.open));
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
