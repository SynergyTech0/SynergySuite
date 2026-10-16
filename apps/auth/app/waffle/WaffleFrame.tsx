'use client';

import { useEffect } from 'react';

/*
 * Behaviour for the waffle grid when it is rendered inside the launcher iframe.
 *
 * Two things can only be done from inside the frame:
 *  - report the content height, so the host can size the iframe instead of
 *    guessing a fixed one (too small strands apps, too large leaves dead space)
 *  - handle Escape, because a keydown here fires in this document and cannot
 *    reach the host's listener across the origin boundary
 */
export default function WaffleFrame() {
  useEffect(() => {
    if (window.parent === window) return;   // not embedded — nothing to report

    /* Target the embedding origin rather than broadcasting. The previous
       referrer-based guess never worked: the iframe carries
       referrerpolicy="same-origin" and is cross-origin to the host, so
       document.referrer is empty and it always fell back to '*'. The host now
       passes its origin explicitly, and it is checked against the suite's
       domain before we post anything to it. */
    const ALLOWED = /^https?:\/\/([a-z0-9-]+\.)*synergytech\.cloud(:\d+)?$/i;
    let target = '*';
    try {
      const o = new URLSearchParams(location.search).get('o');
      if (o && (ALLOWED.test(o) || new URL(o).hostname === 'localhost')) target = o;
    } catch { /* keep '*' */ }
    const post = (msg: unknown) => {
      try { window.parent.postMessage(msg, target); } catch { /* host may be gone */ }
    };

    // Guard the loop: the host sets the iframe height from this message, which
    // resizes this document, which fires the observer again. Bail when the value
    // has not actually changed, and coalesce to one post per frame.
    let last = -1;
    let queued = false;
    /* rAF does NOT fire in a document the browser is not rendering — a
       background tab, or a host that opened the panel while hidden. Relying on
       it alone left the iframe stuck at its 120px seed height with apps
       stranded below the fold. Whichever of the two fires first wins. */
    const soon = (fn: () => void) => {
      let done = false;
      const run = () => { if (done) return; done = true; fn(); };
      requestAnimationFrame(run);
      window.setTimeout(run, 50);
    };
    const report = () => {
      if (queued) return;
      queued = true;
      soon(() => {
        queued = false;
        const h = document.documentElement.scrollHeight;
        if (h === last) return;
        last = h;
        post({ t: 'synergy-waffle-size', h });
      });
    };

    /* The host asks the frame to take focus on open, so the launcher behaves the
       same whether it was opened in the Hub or injected into another app. */
    const onMessage = (e: MessageEvent) => {
      // Fail closed: if the host origin could not be validated we do not act on
      // its messages at all, rather than accepting them from anywhere.
      if (target === '*' || e.origin !== target) return;
      if (e.data !== 'synergy-waffle-focus') return;
      document.querySelector<HTMLAnchorElement>('a.shw-tile')?.focus();
    };
    window.addEventListener('message', onMessage);

    /* Tell the host the document exists. Without this the host posted a focus
       message at an about:blank contentWindow on first open, so the very first
       open of a session never focused a tile. */
    post('synergy-waffle-ready');

    report();
    const ro = new ResizeObserver(report);
    ro.observe(document.documentElement);

    /* Arrow navigation inside the 3-column grid. The Hub's main grid has a full
       roving model; without this the launcher behaves differently depending on
       which surface you opened it from. */
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { post('synergy-waffle-close'); return; }

      /* Tab out of the grid closes the launcher, matching the Hub's own
         non-modal contract. The host cannot see this: the keystroke happens in
         THIS document, and its focusout listener sits on the panel element in
         the parent, which never observes focus moving inside the frame. So the
         boundary has to be reported from in here — without it the injected copy
         left an open dialog behind the host page while focus walked on. */
      if (e.key === 'Tab') {
        /* Every focusable in the frame, in DOM order — not just the tiles. The
           "All apps" link sits before the grid, so shift-Tab off the first tile
           moves to it and must NOT close. */
        const stops = Array.from(document.querySelectorAll<HTMLElement>('a[href], button, [tabindex]:not([tabindex="-1"])'));
        const active = document.activeElement;
        const leaving = !e.shiftKey
          ? active === stops[stops.length - 1]
          : active === stops[0];
        if (stops.length && leaving) {
          /* Stop the browser moving focus inside a frame that is about to be
             hidden — without this the host hides the iframe mid-transition
             and focus ends up on the host <body> instead of the next element
             after the launcher. The host returns focus to the button. */
          e.preventDefault();
          post('synergy-waffle-close');
        }
        return;
      }
      if (!/^Arrow(Up|Down|Left|Right)$/.test(e.key) && e.key !== 'Home' && e.key !== 'End') return;

      const tiles = Array.from(document.querySelectorAll<HTMLAnchorElement>('a.shw-tile'));
      if (!tiles.length) return;
      const idx = tiles.indexOf(document.activeElement as HTMLAnchorElement);
      if (idx === -1) { e.preventDefault(); tiles[0].focus(); return; }

      const grid = tiles[0].parentElement;
      const cols = grid
        ? Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length)
        : 3;

      let next = idx;
      if (e.key === 'ArrowRight') next = idx + 1;
      if (e.key === 'ArrowLeft') next = idx - 1;
      if (e.key === 'ArrowDown') next = idx + cols;
      if (e.key === 'ArrowUp') next = idx - cols;
      if (e.key === 'Home') next = 0;
      if (e.key === 'End') next = tiles.length - 1;

      if (next < 0 || next >= tiles.length) return;
      e.preventDefault();
      tiles[next].focus();
    };
    document.addEventListener('keydown', onKey);

    return () => {
      ro.disconnect();
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('message', onMessage);
    };
  }, []);

  return null;
}
