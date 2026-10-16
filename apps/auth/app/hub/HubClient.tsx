'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import AppIcon from '../AppIcon';

/*
 * Client half of the Hub launcher. The server resolves the session and the
 * user's entitlements; everything here is presentation and keyboard handling.
 *
 * Anchor is Google Workspace:
 *  - the 9-dot waffle is present on every signed-in surface, including this one
 *  - the grid is a dense icon-and-label grid, not a card dashboard
 *  - a roving tabindex, so one Tab leaves the grid rather than N
 *
 * Keyboard model:
 *   /            focus search
 *   Esc          close an open panel, else clear search
 *   ↑ ↓ ← →      move between tiles (within a section, hopping at the edges)
 *   Home / End   first / last tile in the section
 *   Enter        launch the focused tile (or the first result, from search)
 */

export type HubApp = {
  slug: string;
  name: string;
  description: string;
  url: string;
  /* Nullable on purpose: the seeded fallback belongs in the tone layer
     (icon-tones.mjs), not duplicated as a literal in every page. */
  color: string | null;
  category: string;
};

type Props = {
  apps: HubApp[];
  name: string;
  email: string;
  isAdmin: boolean;
};

type Theme = 'system' | 'light' | 'dark';

/* "Device" rather than "System" is the word Google uses for this option. */
const APPEARANCES: Array<[Theme, string]> = [
  ['system', 'Device'], ['light', 'Light'], ['dark', 'Dark'],
];

const initials = (name: string, email: string) => {
  const src = (name || email || '?').trim();
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : src.slice(0, 2)).toUpperCase();
};

/* The exit animation's length, read FROM the token that defines it. This was a
   hand-typed 100 while --sh-dur-short was the source of truth — and the audit
   machine-compares waffle.js's exit against that token, so the Hub was the one
   copy free to drift: retune the token and the Hub's panel would sit frozen on
   screen after its animation had finished. */
const exitMs = (): number => {
  if (typeof window === 'undefined') return 100;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue('--sh-dur-short').trim();
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : 100;
};

/* Google's launcher labels the tile "Drive", not "Google Drive" — the suite name
   is already implied by the panel header. Dropping the prefix also stops long
   names breaking mid-word in a ~95px cell. The full name stays in the
   accessible name and the tooltip. */
const shortName = (n: string) => {
  /* [\s_-]* rather than \s*: the estate carries slug-style names too
     (synergy-alias, synergy-aba), and stripping only the whitespace left the
     tile labelled "-aba". */
  const s = (n || '').replace(/^synergy[\s_-]*/i, '').trim();
  return s || n;
};

export default function HubClient({ apps, name, email, isAdmin }: Props) {
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [waffleOpen, setWaffleOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>('system');
  const [focusSlug, setFocusSlug] = useState<string | null>(null);
  const [announced, setAnnounced] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [closing, setClosing] = useState<'menu' | 'waffle' | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const gridsRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<HTMLButtonElement>(null);
  const waffleBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  // Which panel is mid-exit. A ref, not state: the trigger handler needs the
  // current value at click time, and state can lag a render behind.
  const closingKind = useRef<'menu' | 'waffle' | null>(null);
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  const waffleRef = useRef<HTMLDivElement>(null);

  // ---- theme -------------------------------------------------------------
  useEffect(() => {
    /* No matchMedia subscription here. There used to be one feeding a
       `systemDark` state that fed a `resolvedDark` const that nothing read —
       so every OS theme change re-rendered the entire Hub to update nothing.
       Under 'system' the CSS @media block resolves the theme with no JS at
       all, which is also why there is no flash. */
    try {
      const saved = localStorage.getItem('sh-theme');
      if (saved === 'light' || saved === 'dark') setTheme(saved);
    } catch { /* storage can be blocked; the OS preference is a fine fallback */ }
  }, []);

  /* The attribute must live on <html>, not on a div: the dark media block keys
     off :root, so leaving it off the document element gives a light page a dark
     scrollbar, dark form controls and dark overscroll gutters. */
  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'system') el.removeAttribute('data-sh-theme');
    else el.setAttribute('data-sh-theme', theme);
  }, [theme]);

  const applyTheme = (next: Theme) => {
    setTheme(next);
    try {
      // 'system' is the absence of a preference, so it is a removal, not a
      // stored value — otherwise a later change to the OS setting is ignored.
      if (next === 'system') localStorage.removeItem('sh-theme');
      else localStorage.setItem('sh-theme', next);
    } catch { /* storage can be blocked; the in-memory choice still applies */ }
  };

  /* The compact search mode only exists below 600px. Nothing reset it on the
     way back up, so rotating a phone to landscape left a Back arrow sitting
     inside the desktop search pill with no way to dismiss it — the toggle
     that would have cleared it is display:none above the breakpoint. */
  useEffect(() => {
    if (!searchOpen) return;
    const mq = window.matchMedia('(max-width: 600px)');
    const sync = () => { if (!mq.matches) setSearchOpen(false); };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [searchOpen]);

  // ---- filtering ---------------------------------------------------------
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return apps;
    return apps.filter((a) =>
      `${a.name} ${a.description} ${a.category} ${a.slug}`.toLowerCase().includes(q),
    );
  }, [apps, query]);

  const groups = useMemo(() => {
    const map = new Map<string, HubApp[]>();
    for (const a of filtered) {
      const key = a.category || 'Apps';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return Array.from(map.entries());
  }, [filtered]);

  // The roving tabstop: exactly one tile is tabbable at a time.
  const tabbableSlug = focusSlug && filtered.some((a) => a.slug === focusSlug)
    ? focusSlug
    : filtered[0]?.slug ?? null;

  /* Cancel a close that is mid-flight, so reopening inside the exit window does
     not get slammed shut by the orphaned timer. */
  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    closingKind.current = null;
    setClosing(null);
  }, []);

  // Clear a pending timer if the component goes away mid-close.
  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
  }, []);

  /* Play the exit, then unmount. Duration matches --sh-dur-short. */
  const closePanels = useCallback((returnFocusTo?: 'menu' | 'waffle') => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    const kind = menuOpen ? 'menu' : waffleOpen ? 'waffle' : null;
    closingKind.current = kind;
    setClosing((c) => c ?? kind);
    const reduce = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      closingKind.current = null;
      setMenuOpen(false);
      setWaffleOpen(false);
      setClosing(null);
      if (returnFocusTo === 'menu') avatarRef.current?.focus();
      if (returnFocusTo === 'waffle') waffleBtnRef.current?.focus();
    }, reduce ? 0 : exitMs());
  }, [menuOpen, waffleOpen]);

  // ---- keyboard ----------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);

      if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (menuOpen || waffleOpen) return;        // do not escape an open dialog
        e.preventDefault();
        if (window.matchMedia('(max-width: 600px)').matches && !searchOpen) {
          setSearchOpen(true);                      // the field is display:none until opened
          setTimeout(() => searchRef.current?.focus(), 0);
        } else {
          searchRef.current?.focus();
        }
        return;
      }
      if (e.key === 'Escape') {
        if (menuOpen) { closePanels('menu'); return; }
        if (waffleOpen) { closePanels('waffle'); return; }
        if (query) { setQuery(''); return; }
        if (searchOpen) { setSearchOpen(false); }
        return;
      }

      const active = document.activeElement as HTMLElement | null;

      // Enter from the search box launches the first result, like a result list.
      if (e.key === 'Enter' && active === searchRef.current) {
        const first = gridsRef.current?.querySelector<HTMLAnchorElement>('a.sh-tile');
        if (first) { e.preventDefault(); first.click(); }
        return;
      }

      const isArrow = /^Arrow(Up|Down|Left|Right)$/.test(e.key);
      if (!isArrow && e.key !== 'Home' && e.key !== 'End') return;

      // From the search box, ArrowDown reaches into the grid.
      if (active === searchRef.current) {
        if (e.key === 'ArrowDown') {
          const first = gridsRef.current?.querySelector<HTMLAnchorElement>('a.sh-tile');
          if (first) { e.preventDefault(); focusTile(first); }
        }
        return;
      }

      // The waffle panel runs the same arrow model over its own 3-column grid.
      const wTile = active?.closest<HTMLAnchorElement>('a.shw-tile');
      if (wTile) {
        const wTiles = Array.from(
          waffleRef.current?.querySelectorAll<HTMLAnchorElement>('a.shw-tile') ?? [],
        );
        const wi = wTiles.indexOf(wTile);
        const wGrid = wTile.parentElement;
        const wCols = wGrid ? columnCount(wGrid) : 3;
        let wn = wi;
        if (e.key === 'ArrowRight') wn = wi + 1;
        if (e.key === 'ArrowLeft') wn = wi - 1;
        if (e.key === 'ArrowDown') wn = wi + wCols;
        if (e.key === 'ArrowUp') wn = wi - wCols;
        if (e.key === 'Home') wn = 0;
        if (e.key === 'End') wn = wTiles.length - 1;
        if (wn >= 0 && wn < wTiles.length) { e.preventDefault(); wTiles[wn].focus(); }
        return;
      }

      const tile = active?.closest<HTMLAnchorElement>('a.sh-tile');
      if (!tile) return;

      // Navigate within the tile's OWN grid. A flat list across sections makes
      // the index arithmetic jump to an arbitrary column at a group boundary.
      const grid = tile.closest<HTMLElement>('.sh-grid');
      if (!grid) return;
      const tiles = Array.from(grid.querySelectorAll<HTMLAnchorElement>('a.sh-tile'));
      const idx = tiles.indexOf(tile);
      const cols = columnCount(grid);

      const allGrids = Array.from(
        gridsRef.current?.querySelectorAll<HTMLElement>('.sh-grid') ?? [],
      );
      const gridIdx = allGrids.indexOf(grid);

      e.preventDefault();

      if (e.key === 'Home') { focusTile(tiles[0]); return; }
      if (e.key === 'End') { focusTile(tiles[tiles.length - 1]); return; }

      let next = idx;
      if (e.key === 'ArrowRight') next = idx + 1;
      if (e.key === 'ArrowLeft') next = idx - 1;
      if (e.key === 'ArrowDown') next = idx + cols;
      if (e.key === 'ArrowUp') next = idx - cols;

      if (next >= 0 && next < tiles.length) { focusTile(tiles[next]); return; }

      // Off the end of this grid: hand off to the neighbouring section, keeping
      // the column where that makes sense.
      const col = idx % cols;
      if (next >= tiles.length && gridIdx < allGrids.length - 1) {
        const nextTiles = Array.from(allGrids[gridIdx + 1].querySelectorAll<HTMLAnchorElement>('a.sh-tile'));
        // Horizontal movement continues at the start of the next section;
        // vertical movement keeps the column.
        const target = e.key === 'ArrowRight' ? 0 : Math.min(col, nextTiles.length - 1);
        focusTile(nextTiles[target]);
        return;
      }
      if (next < 0 && gridIdx > 0) {
        const prevTiles = Array.from(allGrids[gridIdx - 1].querySelectorAll<HTMLAnchorElement>('a.sh-tile'));
        const prevCols = columnCount(allGrids[gridIdx - 1]);
        const lastRowStart = Math.floor((prevTiles.length - 1) / prevCols) * prevCols;
        focusTile(prevTiles[Math.min(lastRowStart + col, prevTiles.length - 1)]);
        return;
      }
      if (next < 0) searchRef.current?.focus();
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen, waffleOpen, query, searchOpen, closePanels]);

  const focusTile = (el?: HTMLAnchorElement) => {
    if (!el) return;
    el.focus();
    const slug = el.dataset.slug;
    if (slug) setFocusSlug(slug);
  };

  // Hairline under the bar appears only once scrolled — a real Google detail.
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>('.sh-topbar');
    if (!bar) return;
    const onScroll = () => { bar.dataset.scrolled = window.scrollY > 4 ? 'true' : 'false'; };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* Close on a click genuinely OUTSIDE the panel and its triggers.
     This must test the target rather than rely on stopPropagation in the trigger
     handlers: React attaches its listeners at the root container, and
     stopPropagation does not stop other listeners bound to that same node — so
     a trigger click reached this listener too and re-closed a panel that had
     just been reopened mid-exit. */
  useEffect(() => {
    if (!menuOpen && !waffleOpen) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.('.sh-menu, .sh-waffle, .sh-actions')) return;
      const focusInPanel = !!(document.activeElement as Element | null)
        ?.closest?.('.sh-menu, .sh-waffle');
      closePanels(focusInPanel ? (menuOpen ? 'menu' : 'waffle') : undefined);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpen, waffleOpen, closePanels]);

  /* Non-modal popovers, which is what Google ships — the account bubble does
     not inert the page. Focus moves in on open; Escape, outside-click and
     tabbing out all close; focus returns to the trigger. `aria-modal` is
     deliberately NOT set, and there is deliberately no Tab trap: declaring one
     without the other is a contradiction either way round. */
  const panelOpen = menuOpen || waffleOpen;

  /* Anchor each panel to the control that opened it — waffle.js has always done
     this for the injected copy by measuring the button, while the Hub pinned
     both panels to `right: 16px`. With the action cluster between them, the
     9-dot button's right edge sits ~56px from the viewport edge, so clicking it
     popped a panel open well to its right, scaling out of a corner that had
     nothing to do with the trigger. The waffle is the one gesture in Workspace
     people perform from muscle memory; the panel has to come out of the button.

     useLayoutEffect, not useEffect: the entrance animation starts on mount, so
     positioning after paint would animate from the wrong place for a frame. */
  useLayoutEffect(() => {
    if (!panelOpen) return;
    const trigger = menuOpen ? avatarRef.current : waffleBtnRef.current;
    const panel = menuOpen ? menuRef.current : waffleRef.current;
    if (!trigger || !panel) return;

    const place = () => {
      const r = trigger.getBoundingClientRect();
      // clientWidth, not innerWidth — innerWidth includes the classic scrollbar
      // and pushed the injected panel 15px off its anchor before it was fixed.
      const vw = document.documentElement.clientWidth;
      /* Clamped at BOTH ends. Anchoring to the trigger with only a lower bound
         put the panel's left edge at -27.8px on a 320px viewport: the first
         column of tiles was off the screen with no way to reach it. The
         right-hand clamp keeps 8px of the left edge on screen; if the panel is
         wider than the viewport, max-width in the stylesheet takes over. */
      const wide = panel.offsetWidth;
      const right = Math.min(
        Math.max(8, vw - r.right),
        Math.max(8, vw - 8 - wide),
      );
      panel.style.right = `${right}px`;
      panel.style.top = `${r.bottom + 8}px`;
    };
    place();
    // The bar is sticky, so scrolling does not move the trigger; a resize does.
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [panelOpen, menuOpen]);

  useEffect(() => {
    if (!panelOpen) return;
    const panel = menuOpen ? menuRef.current : waffleRef.current;
    if (!panel) return;

    /* No Tab trap: a non-modal popover must not hold focus hostage. Tabbing out
       closes it, which is what Google's account bubble does. */
    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (next && panel.contains(next)) return;
      if (next && (next as Element).closest?.('.sh-actions')) return;
      /* relatedTarget is null when focus leaves the DOCUMENT — switching
         browser tabs, or clicking the address bar. That is not the user
         dismissing the panel, and closing on it meant glancing at another tab
         and coming back to a shut launcher with focus lost. waffle.js has
         carried this guard, with this reasoning, since it was written; the
         Hub's copy never got it. */
      if (!next) return;
      /* Return focus to whichever trigger opened it, rather than dropping it:
         calling closePanels() with no argument left the user's focus nowhere. */
      closePanels(menuOpen ? 'menu' : 'waffle');
    };
    panel.addEventListener('focusout', onFocusOut);
    return () => panel.removeEventListener('focusout', onFocusOut);
  }, [panelOpen, menuOpen, waffleOpen]);

  /* Compact search focus, keyed on the transition. Calling focus() inside the
     click handler targeted an element that was still display:none. */
  const searchWasOpen = useRef(false);
  useEffect(() => {
    if (searchOpen && !searchWasOpen.current) searchRef.current?.focus();
    else if (!searchOpen && searchWasOpen.current) searchToggleRef.current?.focus();
    searchWasOpen.current = searchOpen;
  }, [searchOpen]);

  // Move focus into whichever panel opens. Without this a keyboard user has to
  // Tab past the remaining bar actions to reach the grid they just opened.
  useEffect(() => {
    if (!menuOpen) return;
    /* The FIRST focusable in the panel, not the first `.sh-btn`. Focusing the
       link jumped past the three Appearance buttons that precede it in the DOM,
       so forward Tab walked the links and left — the theme switcher was
       reachable only by Shift+Tab, which nobody tries. */
    menuRef.current?.querySelector<HTMLElement>('button, a[href]')?.focus();
  }, [menuOpen]);
  useEffect(() => {
    if (!waffleOpen) return;
    waffleRef.current?.querySelector<HTMLElement>('a.shw-tile')?.focus();
  }, [waffleOpen]);

  // Announce the filtered count once typing settles, not on every keystroke.
  useEffect(() => {
    const msg = query
      ? `${filtered.length} of ${apps.length} apps match ${query}`
      : `${apps.length} apps available`;
    const id = setTimeout(() => setAnnounced(msg), 300);
    return () => clearTimeout(id);
  }, [query, filtered.length, apps.length]);

  const rawFirst = (name || email).split(/[\s@]/)[0] || '';
  const first = rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1);
  const showCategories = groups.length > 1 && !query;

  return (
    <div className="sh-root">
      <a className="sh-skip" href="#sh-main">Skip to main content</a>

      <header className={'sh-topbar' + (searchOpen ? ' search-open' : '')}>
        <a className="sh-brand" href="/hub" aria-label="Synergy Hub">
          <BrandMark />
          <span className="sh-wordmark">Synergy</span>
        </a>

        <div className="sh-search" role="search">
          {searchOpen ? (
            <button
              type="button"
              className="sh-iconbtn"
              style={{ width: 32, height: 32, marginLeft: -8 }}
              aria-label="Close search"
              onClick={() => { setSearchOpen(false); setQuery(''); }}
            >
              <BackIcon />
            </button>
          ) : (
            <span className="sh-search-icon" aria-hidden="true"><SearchIcon /></span>
          )}
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your apps"
            aria-label="Search your apps"
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button
              type="button"
              className="sh-iconbtn"
              style={{ width: 32, height: 32 }}
              onClick={() => { setQuery(''); searchRef.current?.focus(); }}
              aria-label="Clear search"
            >
              <CloseIcon />
            </button>
          )}
        </div>

        {/* Gmail's order, which is the anchor: compact-search (≤600px), settings,
            apps, account. Appearance is NOT here — an icon button whose meaning
            changes on every click has no discoverable state, and Workspace has
            no such control in the bar. It lives in the account menu instead. */}
        <div className="sh-actions">
          <button
            type="button"
            ref={searchToggleRef}
            className="sh-iconbtn sh-search-toggle"
            title={searchOpen ? 'Close search' : 'Search your apps'}
            aria-label={searchOpen ? 'Close search' : 'Search your apps'}
            aria-expanded={searchOpen}
            onClick={(e) => {
              e.stopPropagation();
              if (menuOpen || waffleOpen) closePanels();
              setSearchOpen((v) => !v);
            }}
          >
            {searchOpen ? <CloseIcon /> : <SearchIcon />}
          </button>
          <a className="sh-iconbtn" href="/account" title="Settings" aria-label="Settings">
            <GearIcon />
          </a>
          <button
            ref={waffleBtnRef}
            type="button"
            className="sh-iconbtn"
            title="Synergy apps"
            aria-label="Synergy apps"
            aria-expanded={waffleOpen}
            onClick={(e) => {
              e.stopPropagation();
              // Mid-exit the panel is still "open" by state, so a plain
              // open-check would close it a second time instead of reopening.
              if (closingKind.current === 'waffle') { cancelClose(); return; }
              if (waffleOpen) { closePanels('waffle'); return; }
              cancelClose();
              setMenuOpen(false);
              setWaffleOpen(true);
            }}
          >
            <WaffleIcon />
          </button>
          <button
            ref={avatarRef}
            type="button"
            className="sh-avatar"
            aria-expanded={menuOpen}
            title={`Synergy Account
${email}`}
            aria-label={`Synergy Account: ${email}`}
            onClick={(e) => {
              e.stopPropagation();
              if (closingKind.current === 'menu') { cancelClose(); return; }
              if (menuOpen) { closePanels('menu'); return; }
              cancelClose();
              setWaffleOpen(false);
              setMenuOpen(true);
            }}
          >
            <span className="sh-avatar-plate">{initials(name, email)}</span>
          </button>
        </div>

      </header>

      {/* OUTSIDE the header, deliberately. `.sh-topbar` is position:sticky with
          a z-index, which makes it a stacking context — so a panel rendered
          inside it was capped at the header's level no matter what z-index it
          declared, and any page content stacked above the header would paint
          over an open launcher. They are position:fixed and anchored in JS, so
          nesting bought nothing. */}
      {waffleOpen && (
          <div
            ref={waffleRef}
            className={'sh-waffle' + (closing === 'waffle' ? ' is-closing' : '')}
            /* role="group", not "dialog": there is no aria-modal and no
               focus trap here by design (tabbing out closes it), and
               announcing a dialog promises a modality this popover does not
               have. It cannot be role-less either — aria-label on a plain
               div is NOT exposed, so the panel had no accessible name at
               all. role="group" takes a name and promises nothing false. */
            role="group"
            aria-label="Synergy apps"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shw-root">
              <div className="shw-head">
                <span>Synergy apps</span>
                <a className="shw-all" href="/hub">All apps</a>
              </div>
              {/* The empty state existed only in the iframe copy, so a newly
                  provisioned user opening the launcher FROM THE HUB got a
                  320px box with a header and nothing under it, while the same
                  user in any other app got a sentence explaining why. */}
              {apps.length === 0 ? (
                <div className="shw-empty">No apps assigned yet.</div>
              ) : (
                <div className="shw-grid">
                  {apps.map((a) => (
                    <a
                      key={a.slug}
                      className="shw-tile"
                      href={a.url || '#'}
                      title={a.name}
                      aria-label={`${a.name}${a.description ? ` — ${a.description}` : ''}`}
                    >
                      <AppIcon slug={a.slug} name={a.name} color={a.color} size={44} />
                      <span className="shw-name">{shortName(a.name)}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {menuOpen && (
          <div
            ref={menuRef}
            className={'sh-menu' + (closing === 'menu' ? ' is-closing' : '')}
            role="group"
            aria-label="Synergy Account"   /* see the launcher panel above */
            onClick={(e) => e.stopPropagation()}
          >
            {/* Google's order: avatar, name, then email. */}
            <div className="sh-avatar" aria-hidden="true">
              <span className="sh-avatar-plate">{initials(name, email)}</span>
            </div>
            {/* The page h1 already says "Hi, {first}". Google's bubble
                shows the account, not a second greeting. */}
            <div className="sh-menu-name">{name || first}</div>
            <div className="sh-menu-mail">{email}</div>

            {/* Toggle buttons in a labelled group, not role="radiogroup": a
                radiogroup owes the user arrow-key navigation over a single tab
                stop, and claiming the role without implementing that is worse
                for a screen-reader user than not claiming it. Each button
                reports its own pressed state and Tab reaches all three. */}
            <div className="sh-menu-appearance" role="group" aria-label="Appearance">
              <span className="sh-menu-appearance-label">Appearance</span>
              <div className="sh-seg">
                {APPEARANCES.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={'sh-seg-btn' + (theme === value ? ' is-on' : '')}
                    aria-pressed={theme === value}
                    onClick={() => applyTheme(value)}
                  >
                    <ThemeIcon mode={value} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="sh-menu-links">
              <a className="sh-btn sh-btn-filled" href="/account">Manage your account</a>
              {isAdmin && <a className="sh-btn" href="/admin">Admin</a>}
              <a className="sh-btn" href="/api/oidc/logout">Sign out</a>
            </div>
          </div>
        )}

      <main className="sh-page" id="sh-main" tabIndex={-1}>
        <div className="sh-hello">
          <h1>Hi, {first}</h1>
          <p>
            {query
              ? `${filtered.length} of ${apps.length} ${apps.length === 1 ? 'app' : 'apps'} match “${query}”`
              : `${apps.length} ${apps.length === 1 ? 'app is' : 'apps are'} available to you`}
          </p>
        </div>

        <div aria-live="polite" aria-atomic="true" style={{
          position: 'absolute', width: 1, height: 1, overflow: 'hidden',
          clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap',
        }}>{announced}</div>

        {filtered.length === 0 ? (
          <div className="sh-empty">
            <div className="sh-empty-mark" aria-hidden="true">
              {query ? <SearchIcon /> : <WaffleIcon />}
            </div>
            <h3>{query ? 'No apps match that' : 'No apps assigned yet'}</h3>
            <p>
              {query
                ? 'Try a different word, or clear the search to see everything you have access to.'
                : 'Ask an administrator to grant you access, and your apps will appear here.'}
            </p>
          </div>
        ) : (
          <div ref={gridsRef}>
            {groups.map(([category, list]) => (
              <section key={category} aria-label={category}>
                {showCategories && (
                  <div className="sh-cat"><h2>{category}</h2></div>
                )}
                <div className="sh-grid" style={showCategories ? undefined : { marginTop: 20 }}>
                  {list.map((a) => (
                    <a
                      key={a.slug}
                      data-slug={a.slug}
                      className="sh-tile"
                      href={a.url || '#'}
                      title={a.name}
                      tabIndex={a.slug === tabbableSlug ? 0 : -1}
                      onFocus={() => setFocusSlug(a.slug)}
                      aria-label={`${a.name}${a.description ? ` — ${a.description}` : ''}`}
                    >
                      <AppIcon slug={a.slug} name={a.name} color={a.color} size={56} />
                      <span className="sh-tile-name">{shortName(a.name)}</span>
                    </a>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

/* Resolved track count from the real grid, so arrow keys track the CSS at any
   viewport width instead of guessing from element offsets. */
function columnCount(grid: HTMLElement): number {
  const tracks = getComputedStyle(grid).gridTemplateColumns;
  const n = tracks ? tracks.split(' ').filter(Boolean).length : 1;
  return Math.max(1, n);
}

/* The Synergy eye-and-globe mark, served from public/ so every page shares one file. */
const BrandMark = () => (
  <img className="sh-brandmark" src="/synergy-mark.png" alt="" width={40} height={40} />
);
/* Inline SVG rather than an icon font: no network dependency, and it cannot
   degrade into ligature text if a font fails to load. */
const WaffleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    {[0, 1, 2].map((r) => [0, 1, 2].map((c) => (
      <circle key={`${r}-${c}`} cx={3 + c * 7} cy={3 + r * 7} r="1.6" />
    )))}
  </svg>
);
const BackIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M20 12H4M10 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const SearchIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" strokeLinecap="round" />
  </svg>
);
const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
  </svg>
);
const GearIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.1V4a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ThemeIcon = ({ mode }: { mode: Theme }) => {
  if (mode === 'dark') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
      </svg>
    );
  }
  if (mode === 'light') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor" stroke="none" />
    </svg>
  );
};
