import apps from "@synergy/config/apps.json";
import { MARK_DATA_URI } from "./brand";

type App = (typeof apps)[number];

/**
 * <synergy-app-bar app="chat" user="jane@example.com" domain="example.com">
 *
 * The header every suite app shares: product name, the app launcher ("waffle") and the
 * signed-in user, with a search box that opens the Search app. Framework-agnostic, so the Next.js, Vite/React and plain-HTML apps can
 * all use the same element. Without a `domain`, launcher links point at localhost ports.
 */
const ICONS: Record<string, string> = {
  grid: "M4 4h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4zM4 10h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4zM4 16h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4z",
};

function urlFor(app: App, domain: string | null): string {
  return domain ? `https://${app.id}.${domain}` : `http://localhost:${app.port}`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export class SynergyAppBar extends HTMLElement {
  static observedAttributes = ["app", "user", "domain"];
  private open = false;

  connectedCallback() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.render();
    document.addEventListener("keydown", this.onKeydown);
    document.addEventListener("click", this.onDocumentClick);
  }

  disconnectedCallback() {
    document.removeEventListener("keydown", this.onKeydown);
    document.removeEventListener("click", this.onDocumentClick);
  }

  attributeChangedCallback() {
    if (this.shadowRoot) this.render();
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
      </nav>`;

    this.shadowRoot!.querySelector("button")!.addEventListener("click", () => this.setOpen(!this.open));
    const form = this.shadowRoot!.querySelector("form");
    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = form.querySelector("input")!.value.trim();
      if (q) window.location.href = `${searchUrl}/?q=${encodeURIComponent(q)}`;
    });
  }
}

if (typeof customElements !== "undefined" && !customElements.get("synergy-app-bar")) {
  customElements.define("synergy-app-bar", SynergyAppBar);
}
