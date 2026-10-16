/*
 * Synergy waffle — the Google-style 9-dot app launcher, embeddable in any
 * Synergy app with a single tag:
 *   <script src="https://auth.example.com/waffle.js" defer></script>
 *
 * It injects a 9-dot button (top-right by default, or into an element with
 * id="synergy-waffle" if present) that opens a dropdown iframe pointing at
 * SynergyAuth's /waffle. Because the app and auth.* share the same parent
 * site, the SynergyAuth session cookie flows into the iframe and it renders the
 * signed-in user's assigned apps. No per-app API or auth code required.
 *
 * Anchor is Google's app launcher: a 40px circular button with a state layer,
 * and a 320px panel on an 8px radius with the two-part shadow, opening with a
 * short scale-and-fade from its top-right corner.
 */
(function () {
  if (window.__synergyWaffleLoaded) return;
  window.__synergyWaffleLoaded = true;

  // Derive the auth origin from this script's own src, so the widget is portable.
  var me = document.currentScript || (function () {
    var s = document.getElementsByTagName('script');
    for (var i = s.length - 1; i >= 0; i--) if (/waffle\.js(\?|$)/.test(s[i].src)) return s[i];
    return null;
  })();
  var AUTH = me ? new URL(me.src).origin : location.protocol + '//' + location.hostname.replace(/^[^.]+/, 'auth');

  /* The frame is told the host's origin explicitly: it carries
     referrerpolicy="same-origin" and is cross-origin to the host, so
     document.referrer is empty there and a referrer-based guess never works. */
  function frameUrl() {
    return AUTH + '/waffle?t=' + (dark() ? 'dark' : 'light') +
      '&o=' + encodeURIComponent(location.origin);
  }

  var open = false, panel, btn, frame, skel, themeDirty = false, frameReady = false, wantFocus = false;
  /* Handle for the pending exit animation. Without it a reopen during the
     100ms exit was overtaken by the old timer, which then set display:none on
     a panel the user had just reopened — leaving aria-expanded="true" over a
     hidden panel, so the next click only flipped aria back to false and it
     took two more clicks to recover. HubClient has cancelClose() for exactly
     this; the copy injected into every other app did not. */
  var closeTimer = null;

  var MQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  /* Resolve against the page this widget is actually sitting on, in order:
       1. the host's declared theme (data-sy-theme / data-sh-theme)
       2. the host's MEASURED background luminance
       3. the OS preference
     Step 2 matters: an app that renders a white page on a dark-OS machine and
     has not opted in used to get the dark palette — a #c4c7c5 glyph on white is
     1.70:1. The widget is injected into pages it does not control, so it cannot
     assume every app will cooperate. */
  function lumaOf(node) {
    try {
      while (node && node !== document.documentElement) {
        var bg = getComputedStyle(node).backgroundColor;
        var m = bg && bg.match(/rgba?\(([^)]+)\)/);
        if (m) {
          var p = m[1].split(',').map(parseFloat);
          var alpha = p.length > 3 ? p[3] : 1;
          if (alpha > 0.5) {
            // Rec. 601 luma is plenty for a light/dark decision.
            return (0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]) < 128;
          }
        }
        node = node.parentElement;
      }
      var hb = getComputedStyle(document.documentElement).backgroundColor;
      var hm = hb && hb.match(/rgba?\(([^)]+)\)/);
      if (hm) {
        var hp = hm[1].split(',').map(parseFloat);
        if ((hp.length > 3 ? hp[3] : 1) > 0.5) {
          return (0.299 * hp[0] + 0.587 * hp[1] + 0.114 * hp[2]) < 128;
        }
      }
    } catch (e) { /* fall through to the OS preference */ }
    return null;
  }

  function declared() {
    var d = document.documentElement.dataset || {};
    var t = d.syTheme || d.shTheme;
    return t === 'dark' ? true : t === 'light' ? false : null;
  }

  /* The glyph is judged against the bar it sits in; the panel against the page
     it covers. They can legitimately differ — a dark app header above a white
     content area is a common layout, and measuring once for both put a dark
     panel on a white page. */
  /* What the panel will actually cover, sampled rather than assumed.
     `document.body` is the wrong probe: plenty of apps leave body at the UA
     default white and paint their real background on a wrapper inside it, so
     body measured LIGHT on a near-black page and a white 320px panel landed on
     it. Sample three points down the strip the panel occupies and take the
     majority; each sample walks up for the first opaque background. */
  function coveredDark() {
    var xs = Math.max(8, window.innerWidth - 170);
    var votes = 0, seen = 0;
    var hidden = [];
    try {
      if (panel && panel.style.visibility !== 'hidden') { hidden.push([panel, panel.style.visibility]); panel.style.visibility = 'hidden'; }
      if (btn && btn.parentElement) { hidden.push([btn.parentElement, btn.parentElement.style.visibility]); btn.parentElement.style.visibility = 'hidden'; }
      [120, 400, 700].forEach(function (y) {
        if (y > window.innerHeight - 4) return;
        var el = document.elementFromPoint(xs, y);
        if (!el) return;
        var v = lumaOf(el);
        if (v !== null) { seen++; if (v) votes++; }
      });
    } catch (e) { /* fall through */ }
    hidden.forEach(function (h) { h[0].style.visibility = h[1] || ''; });
    if (!seen) return null;
    return votes * 2 > seen;
  }

  /* What is actually behind the BUTTON, sampled the same way as the panel.
     lumaOf(btn) walked UP the DOM and stopped at the first opaque ancestor —
     which on an app that leaves body at the UA default white is `body`, even
     though the visible page is near-black. The glyph then took the
     dark-on-light token and the launcher trigger became invisible on every
     dark app: measured rgb(68,71,70) against a near-black page. That is the
     one control that opens the launcher. */
  function behindGlyph() {
    if (!btn) return null;
    var r = btn.getBoundingClientRect();
    if (!r.width) return null;
    var wrap = btn.parentElement;
    var prev = wrap ? wrap.style.visibility : null;
    if (wrap) wrap.style.visibility = 'hidden';
    var el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (wrap) wrap.style.visibility = prev || '';
    return el ? lumaOf(el) : null;
  }

  function darkFor(what) {
    var d = declared();
    if (d !== null) return d;
    var measured = what === 'glyph' ? behindGlyph() : coveredDark();
    if (measured === null) measured = lumaOf(what === 'glyph' ? (btn || document.body) : document.body);
    if (measured !== null) return measured;
    return !!(MQ && MQ.matches);
  }
  function dark() { return darkFor('panel'); }

  /* Tokens mirroring hub.css. glyph = --sh-on-variant, ring = --sh-primary,
     surface = --sh-surface-elev, so the same control is the same colour in
     every app; the light glyph shipped as #5f6368 while the Hub drew
     #444746, which is visibly lighter side by side. skel has no hub.css
     counterpart — the Hub has no skeleton, because it has no iframe to wait
     for. The glyph and ring MUST follow the HOST's theme: #444746 on a dark
     app is 1.75:1 and #0b57d0 is 2.58:1, both under the 3:1 non-text
     minimum, which is why darkFor('glyph') measures the bar it sits in. */
  var T = {
    light: { glyph: '#444746', surface: '#ffffff', ring: '#0b57d0',
             skel: '#e8eaed',
             edge: '1px solid transparent',
             shadow: '0 4px 8px 3px rgba(60,64,67,.15),0 1px 3px rgba(60,64,67,.30)' },
    /* surface matches the Hub's --sh-surface-elev. #1f1f1f measured 1.13:1
       against a dark app page with a shadow that contributes nothing, and
       disagreed with the iframe it contains. The hairline gives the panel a
       boundary that survives on near-black. */
    dark:  { glyph: '#c4c7c5', surface: '#2d2f31', ring: '#a8c7fa',
             skel: '#3c4043',
             edge: '1px solid #8e918f',
             shadow: '0 4px 8px 3px rgba(0,0,0,.3),0 1px 3px rgba(0,0,0,.5)' }
  };
  function tok() { return dark() ? T.dark : T.light; }
  function glyphTok() { return darkFor('glyph') ? T.dark : T.light; }

  function icon() {
    var svg = '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">';
    for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++)
      svg += '<circle cx="' + (3 + c * 7) + '" cy="' + (3 + r * 7) + '" r="1.6"></circle>';
    return svg + '</svg>';
  }

  /* Shown only until the frame reports itself ready. Nine plates on the same
     grid as the real tiles, so the swap does not resize the panel under the
     pointer. Google's launcher has its grid in the host page and never shows a
     hole; an empty bordered box is worse than a shape of the right size. */
  /* 10 + 10 root padding + 38 head + 3 rows x 112 + 2 gaps x 2 = 398, which
     is .shw-root/.shw-head/.shw-tile in hub.css. The previous comment said
     "see the arithmetic above" and there was none. */
  var SKELETON_H = 398;
  function makeSkeleton(t) {
    var d = document.createElement('div');
    d.setAttribute('aria-hidden', 'true');
    d.style.cssText = 'padding:10px;';
    // Header row: same 38px box as .shw-head, so the grid starts where it will.
    var head = '<span style="display:block;height:20px;margin:6px 10px 12px">' +
      '<span style="display:block;width:96px;height:12px;border-radius:6px;background:' + t.skel + '"></span></span>';
    var cell = '<span style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:14px 6px">' +
      '<span style="width:44px;height:44px;border-radius:50%;background:' + t.skel + '"></span>' +
      '<span style="width:70%;height:12px;margin:10px 0;border-radius:6px;background:' + t.skel + '"></span></span>';
    var cells = '';
    for (var i = 0; i < 9; i++) cells += cell;
    d.innerHTML = head +
      '<span style="display:grid;grid-template-columns:repeat(3,1fr);gap:2px">' + cells + '</span>';
    return d;
  }

  /* Load the frame on intent rather than on click, so the first open of a
     session is not the one that pays for a network round trip. */
  function warm() { if (frame && !frame.src) frame.src = frameUrl(); }

  /* rAF racing a timeout, first one wins. requestAnimationFrame does NOT fire
     in a document the browser is not rendering, and the entrance relied on a
     single un-backed rAF: when it did not fire the panel stayed at opacity 0
     with display:block and aria-expanded="true" — an invisible launcher that
     reports itself open. WaffleFrame.tsx has carried this helper (and the
     reason for it) since the iframe height handshake hit the same wall. */
  function soon(fn) {
    var done = false;
    var run = function () { if (done) return; done = true; fn(); };
    if (window.requestAnimationFrame) window.requestAnimationFrame(run);
    window.setTimeout(run, 50);
  }

  // Skeleton out, grid in. Idempotent: both the size message and the safety
  // timeout call it, and whichever arrives first wins.
  function reveal() {
    if (!frame) return;
    if (skel) skel.style.display = 'none';
    frame.style.display = 'block';
  }

  function makeButton() {
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', 'Synergy apps');
    /* No aria-haspopup: 'true' is defined as equivalent to 'menu', and this
       opens a role="group" with no menu items in it. aria-expanded already
       carries the state a screen-reader user needs. */
    b.setAttribute('title', 'Synergy apps');
    b.setAttribute('aria-expanded', 'false');
    b.innerHTML = icon();
    b.className = 'synergy-waffle-btn';
    b.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;' +
      'border:0;border-radius:50%;background:transparent;cursor:pointer;padding:0;' +
      'position:relative;isolation:isolate;color:' + glyphTok().glyph + ';';
    b.onclick = function (e) { e.stopPropagation(); toggle(); };
    /* pointerdown, not pointerenter: warming on hover fired a session-
       authenticated, entitlement-resolving request every time a pointer
       crossed the 9 dots, on every app in the suite. pointerdown still
       beats the click, which is all the head start that was needed. */
    b.addEventListener('pointerdown', warm);
    b.addEventListener('focus', warm);
    return b;
  }

  /* An injected stylesheet rather than inline handlers: `onfocus` painted a ring
     on every mouse click, on every app in the suite, and a background swap is
     not a state layer (no pressed feedback). */
  function injectStyles() {
    if (document.getElementById('synergy-waffle-style')) return;
    var st = document.createElement('style');
    st.id = 'synergy-waffle-style';
    st.textContent =
      '.synergy-waffle-btn::before{content:"";position:absolute;inset:0;border-radius:inherit;' +
      'z-index:-1;background:currentColor;opacity:0;pointer-events:none;' +
      'transition:opacity 100ms cubic-bezier(.2,0,0,1)}' +
      '.synergy-waffle-btn:hover::before{opacity:.08}' +
      '.synergy-waffle-btn:active::before{opacity:.12}' +
      '.synergy-waffle-btn:focus{outline:none}' +
      '.synergy-waffle-btn:focus-visible{outline:2px solid var(--synergy-waffle-ring,#0b57d0);outline-offset:2px}' +
      '@media (prefers-reduced-motion: reduce){.synergy-waffle-btn::before{transition:none}}';
    document.head.appendChild(st);
    document.documentElement.style.setProperty('--synergy-waffle-ring', glyphTok().ring);
  }

  function makePanel() {
    var t = tok();
    var p = document.createElement('div');
    p.setAttribute('role', 'group');
    p.setAttribute('aria-label', 'Synergy apps');
    // The panel scrolls and the iframe is sized to its content by postMessage.
    // A fixed iframe height either strands apps below the fold (the panel clips
    // with no scroll) or leaves a mostly-empty box for a user with few apps.
    p.style.cssText = 'position:fixed;z-index:2147483647;width:320px;box-sizing:border-box;' +
      'max-width:calc(100vw - 16px);' +
      'max-height:min(70vh,600px);overflow-y:auto;overflow-x:hidden;' +
      'background:' + t.surface + ';border-radius:8px;border:' + t.edge + ';box-shadow:' + t.shadow + ';' +
      'display:none;transform-origin:top right;';
    frame = document.createElement('iframe');
    // src is set on first open — see toggle().
    frame.style.cssText = 'width:100%;height:' + SKELETON_H + 'px;border:0;display:none;background:' + t.surface + ';';
    frame.setAttribute('title', 'Synergy apps');
    frame.setAttribute('referrerpolicy', 'same-origin');
    skel = makeSkeleton(t);
    p.appendChild(skel);
    p.appendChild(frame);
    return p;
  }

  // dark() was previously read once at mount, so an OS theme change mid-session
  // left the button and panel on the old palette.
  function repaint() {
    var t = tok();
    document.documentElement.style.setProperty('--synergy-waffle-ring', glyphTok().ring);
    if (btn) btn.style.color = glyphTok().glyph;
    if (panel) {
      panel.style.background = t.surface;
      panel.style.boxShadow = t.shadow;
      panel.style.border = t.edge;
    }
    if (frame) {
      frame.style.background = t.surface;
      // Only re-fetch when the panel is CLOSED: reloading it while open destroys
      // the grid and any focus inside it mid-interaction.
      var want = frameUrl();
      if (frame.src && frame.src !== want) {
        // Re-loading while the panel is open destroys the grid and any focus in
        // it, so defer — and remember, or the frame keeps serving a stale theme
        // until the next theme change.
        if (open) themeDirty = true;
        else { frameReady = false; frame.src = want; }
      }
    }
  }

  function position() {
    if (!panel || !btn) return;
    // A display:none panel has no height, so measure off-screen if we are being
    // asked to place it before it is shown.
    var hidden = panel.style.display === 'none';
    if (hidden) { panel.style.visibility = 'hidden'; panel.style.display = 'block'; }
    var r = btn.getBoundingClientRect();
    // right-align the panel to the button, clamped to the viewport
    /* clientWidth/clientHeight, not innerWidth/innerHeight: those include the
       classic scrollbar, which pushed the panel ~15px off its anchor. */
    var vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    /* Clamped at BOTH ends. With only a lower bound the panel's left edge sat
       at -27.8px on a 320px viewport — the first column of tiles off-screen and
       unreachable. max-width takes over if the panel is wider than the window. */
    var wide = panel.offsetWidth || 320;
    panel.style.right = Math.min(
      Math.max(8, vw - r.right),
      Math.max(8, vw - 8 - wide)
    ) + 'px';

    // Flip above a low anchor rather than running off the bottom.
    var h = panel.offsetHeight || 420;
    if (hidden) { panel.style.display = 'none'; panel.style.visibility = ''; }
    if (r.bottom + 8 + h > vh && r.top - 8 - h > 0) {
      panel.style.top = 'auto';
      panel.style.bottom = (vh - r.top + 8) + 'px';
      panel.style.transformOrigin = 'bottom right';
    } else {
      panel.style.bottom = 'auto';
      panel.style.top = (r.bottom + 8) + 'px';
      panel.style.transformOrigin = 'top right';
    }
  }

  function toggle() {
    if (open) { close(true); return; }
    // Mid-exit: cancel the pending hide rather than letting it fire over the
    // panel we are about to show again.
    if (closeTimer !== null) { window.clearTimeout(closeTimer); closeTimer = null; }
    open = true;
    // Show first, then place: position() needs a measurable box.
    panel.style.visibility = 'hidden';
    panel.style.display = 'block';
    position();
    panel.style.visibility = '';
    if (!frame.src) frame.src = frameUrl();
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce) {
      panel.style.opacity = '0';
      panel.style.transform = 'scale(.96) translateY(-4px)';
      soon(function () {
        // Same curve and displacement as hub.css's sh-pop-in, or the launcher
        // animates differently depending on which surface opened it.
        panel.style.transition = 'opacity 150ms cubic-bezier(.05,.7,.1,1), transform 150ms cubic-bezier(.05,.7,.1,1)';
        panel.style.opacity = '1';
        panel.style.transform = 'scale(1) translateY(0)';
      });
    }
    btn.setAttribute('aria-expanded', 'true');
    // Ask the frame to focus its first tile. On a cold open the document is not
    // there yet, so remember the intent and send it from the ready handshake.
    if (frameReady) sendFocus(); else wantFocus = true;
  }

  function sendFocus() {
    try { frame.contentWindow.postMessage('synergy-waffle-focus', AUTH); } catch (e) {}
  }

  function close(returnFocus) {
    if (!open) return;
    open = false;
    btn.setAttribute('aria-expanded', 'false');

    var finish = function () {
      panel.style.display = 'none';
      panel.style.transition = '';
      /* Reset what the exit animated. Without this, a session that turns
         reduced-motion ON mid-flight takes the early return below with
         opacity still 0, and the next open shows an invisible panel that
         nonetheless reports aria-expanded="true". */
      panel.style.opacity = '';
      panel.style.transform = '';
      // Apply a theme change that arrived while the panel was open.
      if (themeDirty) {
        themeDirty = false; frameReady = false;
        // Rebuilt rather than re-shown: it carries the palette it was made
        // with. Replace the node so a long session does not accumulate one
        // hidden skeleton per theme change.
        if (skel) { var next = makeSkeleton(tok()); panel.replaceChild(next, skel); skel = next; }
        frame.style.display = 'none';
        frame.src = frameUrl();
      }
      if (returnFocus) btn.focus();
    };

    // The Hub animates its panels out; this is the copy every other app loads,
    // so it has to do the same rather than hard-cutting.
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { closeTimer = null; finish(); return; }
    panel.style.transition = 'opacity 100ms cubic-bezier(.3,0,.8,.15), transform 100ms cubic-bezier(.3,0,.8,.15)';
    panel.style.opacity = '0';
    // Matches sh-pop-out, which displaces as well as scaling. The entrance was
    // brought into line earlier and the exit was left behind, so the panel flew
    // in one way and out another.
    panel.style.transform = 'scale(.96) translateY(-4px)';
    closeTimer = window.setTimeout(function () { closeTimer = null; finish(); }, 100);
  }

  /* Nudge the floating launcher off anything clickable underneath it.
     elementFromPoint returns the TOPMOST element, which would be our own
     button, so the wrap is hidden for the probe and restored immediately --
     visibility, not display, so nothing reflows. Landing on a plain header bar
     is fine and looks deliberate; landing on a control is not. */
  function obstruction(el) {
    if (!el || !el.closest) return null;
    var ctrl = el.closest('button,a,input,select,textarea,summary,[role="button"],[role="link"],[onclick],[tabindex]:not([tabindex="-1"])');
    if (ctrl) return ctrl;
    // A text leaf counts too. Avoiding only controls moved the launcher off
    // Drive's "Sign out" and straight on top of the account email beside it --
    // legible is the bar, not the words on it.
    if (!el.childElementCount && el.textContent && el.textContent.trim()) return el;
    return null;
  }

  /* Preferred fix: make the HOST BAR give up the space, and keep the launcher
     pinned top-right on every app.

     Dodging left instead was wrong -- it put the launcher in a different place
     on every app, which is worse than the collision it solved. Google's waffle
     is always in the same corner; that predictability IS the feature. So find
     the app's top bar and add padding to its right edge, which pushes ITS
     controls left and leaves a reserved slot.

     Returns true if space was reserved; false means no bar was found and the
     caller should fall back to nudging. */
  function reserveSpace(wrap, button) {
    var GAP = 56;                                   // 40px button + breathing room
    wrap.style.top = '10px';
    wrap.style.right = '14px';
    wrap.style.visibility = 'hidden';
    var el = document.elementFromPoint(window.innerWidth - 30, 24);
    wrap.style.visibility = '';
    if (!el) return false;

    // Walk up to the first ancestor that behaves like a top bar: wide, at the
    // top, and not tall enough to be the page itself.
    var bar = null, node = el;
    while (node && node !== document.body && node.nodeType === 1) {
      var br = node.getBoundingClientRect();
      if (br.width >= window.innerWidth * 0.5 && br.top <= 24 && br.height > 0 && br.height <= 140) {
        bar = node; break;
      }
      node = node.parentElement;
    }
    if (!bar) return false;

    // Idempotent: the settle passes run several times, and a re-rendered bar
    // loses the marker, which is exactly when the padding must be re-applied.
    if (bar.getAttribute('data-synergy-waffle-pad') !== '1') {
      var cur = parseFloat(window.getComputedStyle(bar).paddingRight) || 0;
      bar.style.setProperty('padding-right', (cur + GAP) + 'px', 'important');
      bar.setAttribute('data-synergy-waffle-pad', '1');
    }
    var r2 = bar.getBoundingClientRect();
    wrap.style.top = Math.round(Math.max(r2.top, 0) + (Math.min(r2.height, 80) - 40) / 2) + 'px';
    return true;
  }

  function placeClear(wrap, button) {
    if (reserveSpace(wrap, button)) return;
    var right = 14, top = 10, i, r, under, hit;
    wrap.style.top = top + 'px';
    wrap.style.right = right + 'px';
    for (i = 0; i < 10; i++) {
      r = button.getBoundingClientRect();
      if (!r.width) return;
      wrap.style.visibility = 'hidden';
      under = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      wrap.style.visibility = '';
      if (!under) return;
      hit = obstruction(under);
      if (!hit) return;                       // clear: sitting on bare bar or page
      // Step left by the obstruction's own width so one nudge usually clears it.
      right += Math.max(hit.getBoundingClientRect().width, r.width) + 8;
      if (right > window.innerWidth / 2) break;
      wrap.style.right = right + 'px';
    }
    // Nothing free along the bar. Drop BELOW it rather than marching into the
    // middle of the header: the right edge under a top bar is almost always
    // empty, and a launcher there still reads as chrome.
    wrap.style.right = '14px';
    wrap.style.visibility = 'hidden';
    under = document.elementFromPoint(window.innerWidth - 30, 20);
    wrap.style.visibility = '';
    var bar = under && under.closest && under.closest('header,nav,[role="banner"],[role="navigation"]');
    var h = bar ? bar.getBoundingClientRect().bottom : 56;
    wrap.style.top = Math.round(Math.max(h, 48) + 8) + 'px';
  }

  function mount() {
    injectStyles();
    btn = makeButton();
    panel = makePanel();
    var host = document.getElementById('synergy-waffle');
    if (host) {
      host.appendChild(btn);
    } else {
      // Floating fallback. This is NOT the rare path: no app in the fleet
      // defines #synergy-waffle, so every one of them lands here. Parking it
      // unconditionally at top-right put it on top of Drive's "Sign out" and
      // SynergyDesk's "+ New ticket" -- the corner is precisely where apps put
      // their primary action. So place it, then step aside if it landed on
      // something a user needs to click.
      var wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;top:10px;right:14px;z-index:2147483646;';
      wrap.appendChild(btn);
      document.body.appendChild(wrap);
      // Re-run as the host settles. This script is `defer`, so it mounts at
      // DOMContentLoaded -- before a client-rendered app has painted its
      // header. A single pass found an empty corner on SynergyDesk and parked
      // the launcher on the "+ New ticket" button that appeared a beat later.
      var settle = function () { placeClear(wrap, btn); };
      settle();
      window.addEventListener('load', settle);
      [400, 1200, 2500].forEach(function (ms) { window.setTimeout(settle, ms); });
      window.addEventListener('resize', settle);
    }
    document.body.appendChild(panel);

    document.addEventListener('click', function (e) {
      if (open && !panel.contains(e.target) && e.target !== btn) close(false);
    });
    // Escape pressed INSIDE the iframe fires in the frame's document and cannot
    // cross the origin boundary, so the frame posts its own close message.
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(true); });
    window.addEventListener('resize', function () { if (open) position(); });
    // The panel is fixed and the button usually is not: without this the panel
    // drifts away from its anchor as soon as the host page scrolls.
    /* capture:true — many app shells scroll an inner element, and a scroll
       event on a non-window target does not bubble to window. Without
       capture the panel stayed put while the button it points at moved. */
    window.addEventListener('scroll', function () { if (open) position(); }, { passive: true, capture: true });

    /* The panel and the injected ring are built before the button is in the DOM,
       so the host background cannot be measured yet and they fall back to the OS.
       Repaint once everything is attached and the measurement is meaningful. */
    repaint();

    /* ONE measurement at mount is not enough. This script is `defer`, so a
       client-rendered app has not painted its background yet -- and a dark app
       that simply ships dark CSS never sets data-sy-theme, so neither the OS
       listener nor the MutationObserver below ever fires for it. The result was
       a white 320px panel dropped on a near-black page (Synapse). Re-measure on
       the same schedule the placement uses. repaint() is idempotent. */
    window.addEventListener('load', repaint);
    [400, 1200, 2500].forEach(function (ms) { window.setTimeout(repaint, ms); });
    window.addEventListener('resize', repaint);

    if (MQ && MQ.addEventListener) MQ.addEventListener('change', repaint);
    // The host app can change its own theme without the OS changing.
    if (window.MutationObserver) {
      new MutationObserver(repaint).observe(document.documentElement, {
        attributes: true, attributeFilter: ['data-sy-theme', 'data-sh-theme']
      });
    }

    /* Same non-modal contract as the Hub's panel: focus leaving the launcher
       closes it rather than leaving a dialog open behind the host page.
       relatedTarget is null both when focus enters the iframe and when it
       leaves the document, and neither is a reason to close — focus moving
       INTO the frame must keep the panel open. */
    panel.addEventListener('focusout', function (e) {
      var next = e.relatedTarget;
      if (next && (panel.contains(next) || next === btn)) return;
      if (!next) return;                // focus left the document entirely
      close(false);
    });

    window.addEventListener('message', function (e) {
      if (e.origin !== AUTH) return;
      if (e.data === 'synergy-waffle-ready') {
        frameReady = true;
        if (wantFocus) { wantFocus = false; sendFocus(); }
        /* The swap waits for the SIZE message, so a frame that reports ready and
           then never reports a height would sit behind the skeleton forever.
           Reveal anyway after a beat: a grid at the seeded height beats a
           placeholder that never resolves. */
        window.setTimeout(reveal, 1500);
        return;
      }
      if (e.data === 'synergy-waffle-close') close(true);
      if (e.data && e.data.t === 'synergy-waffle-size' && frame) {
        frame.style.height = Math.max(120, e.data.h) + 'px';
        // Only now is the real height known, so this is the one moment the
        // swap can happen without the panel changing size under the pointer.
        reveal();
        // The height decides whether the panel fits below the button, so the
        // placement has to be reconsidered now that it is actually known.
        if (open) position();
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
