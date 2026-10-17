import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';

const DEV_AS = new URLSearchParams(location.search).get('as');
async function req(method, url, body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (DEV_AS) headers['x-dev-user'] = DEV_AS;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
const api = {
  me: () => req('GET', '/api/me'),
  spaces: () => req('GET', '/api/spaces'),
  createSpace: s => req('POST', '/api/spaces', s),
  updateSpace: (id, patch) => req('PATCH', `/api/spaces/${id}`, patch),
  spaceMembers: id => req('GET', `/api/spaces/${id}/members`),
  addMember: (id, email, role) => req('POST', `/api/spaces/${id}/members`, { email, role }),
  removeMember: (id, email) => req('DELETE', `/api/spaces/${id}/members/${encodeURIComponent(email)}`),
  pages: spaceId => req('GET', spaceId ? `/api/pages?space=${spaceId}` : '/api/pages'),
  page: id => req('GET', `/api/pages/${id}`),
  create: p => req('POST', '/api/pages', p),
  update: (id, p) => req('PATCH', `/api/pages/${id}`, p),
  remove: id => req('DELETE', `/api/pages/${id}`),
  search: (s, opts = {}) => req('GET', `/api/search?q=${encodeURIComponent(s)}${opts.space ? `&space=${opts.space}` : ''}`),
  trash: () => req('GET', '/api/trash'),
  restore: id => req('POST', `/api/pages/${id}/restore`),
  versions: id => req('GET', `/api/pages/${id}/versions`),
  version: (id, n) => req('GET', `/api/pages/${id}/versions/${n}`),
  restoreVersion: (id, n) => req('POST', `/api/pages/${id}/versions/${n}/restore`),
  addLabel: (id, name) => req('POST', `/api/pages/${id}/labels`, { name }),
  removeLabel: (id, labelId) => req('DELETE', `/api/pages/${id}/labels/${labelId}`),
  pagesByLabel: labelId => req('GET', `/api/pages?label=${labelId}`),
  comments: id => req('GET', `/api/pages/${id}/comments`),
  addComment: (id, body, parentId) => req('POST', `/api/pages/${id}/comments`, { body, parentId }),
  resolveComment: (cid, resolved) => req('PATCH', `/api/comments/${cid}`, { resolved }),
  deleteComment: cid => req('DELETE', `/api/comments/${cid}`),
  pageRestrictions: id => req('GET', `/api/pages/${id}/restrictions`),
  addRestriction: (id, email) => req('POST', `/api/pages/${id}/restrictions`, { email }),
  removeRestriction: (id, email) => req('DELETE', `/api/pages/${id}/restrictions/${encodeURIComponent(email)}`),
  notifications: () => req('GET', '/api/notifications'),
  markNotifRead: id => req('POST', '/api/notifications/read', id ? { id } : {}),
  templates: () => req('GET', '/api/templates'),
  createTemplate: (name, body) => req('POST', '/api/templates', { name, body }),
  deleteTemplate: id => req('DELETE', `/api/templates/${id}`),
  uploadAttachment: async (pageId, file) => {
    const headers = { 'Content-Type': file.type || 'application/octet-stream' };
    if (DEV_AS) headers['x-dev-user'] = DEV_AS;
    const res = await fetch(`/api/pages/${pageId}/attachments?name=${encodeURIComponent(file.name)}`,
      { method: 'POST', headers, body: file });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  },
  deleteAttachment: aid => req('DELETE', `/api/attachments/${aid}`),
};
const fmtSize = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;
// Stable per-user colour for live-presence chips.
const colorFor = s => `hsl(${([...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) * 37) % 360} 65% 55%)`;

// markdown-lite renderer (escape first, then structure)
// Props that make a non-button row focusable and openable with Enter/Space.
const pressable = fn => ({
  role: 'button',
  tabIndex: 0,
  onClick: fn,
  onKeyDown: e => {
    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    fn(e);
  },
});

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slugify = s => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const PANEL_TYPES = ['note', 'info', 'tip', 'success', 'warning', 'danger'];
const inline = s => s
  // Images first, and only from our own attachment endpoint or http(s) — never
  // an arbitrary scheme. Runs before the autolinker so it doesn't grab the src.
  .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) =>
    /^(https?:\/\/|\/api\/attachments\/)/.test(url)
      ? `<img alt="${alt}" src="${url}" loading="lazy" />` : m)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  // Word-boundary lookarounds accept trailing punctuation (e.g. '_italic_,')
  // while leaving snake_case_identifiers alone.
  .replace(/(^|[^A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_])/g, '$1<em>$2</em>')
  .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

// Block renderer. `nested` (panel contents) renders task checkboxes static, since
// their data-line would be relative to the panel, not the page body.
function renderBlocks(lines, headings, nested) {
  let html = '', inList = false, inCode = false;
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (line.startsWith('```')) {
      if (!inCode) { const lang = line.slice(3).trim(); closeList(); html += `<pre><code${lang ? ` class="language-${slugify(lang)}"` : ''}>`; inCode = true; }
      else { html += '</code></pre>'; inCode = false; }
      continue;
    }
    if (inCode) { html += line + '\n'; continue; }

    // Callout panel: ':::note' … ':::'  (also info/tip/success/warning/danger)
    const panel = /^:::\s*([a-z]+)?\s*$/i.exec(line.trim());
    if (panel && (panel[1] || line.trim() !== ':::')) {
      const type = PANEL_TYPES.includes((panel[1] || '').toLowerCase()) ? panel[1].toLowerCase() : 'note';
      const inner = []; idx++;
      while (idx < lines.length && lines[idx].trim() !== ':::') { inner.push(lines[idx]); idx++; }
      closeList();
      html += `<div class="panel panel-${type}">${renderBlocks(inner, headings, true)}</div>`;
      continue;
    }

    // Pipe table: a '| … |' row immediately followed by a '|---|---|' separator.
    if (/^\s*\|.*\|\s*$/.test(line) && idx + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[idx + 1])) {
      const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      closeList();
      let t = '<table class="md-table"><thead><tr>' + cells(line).map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>';
      idx += 2;
      while (idx < lines.length && /^\s*\|.*\|\s*$/.test(lines[idx])) { t += '<tr>' + cells(lines[idx]).map(c => `<td>${inline(c)}</td>`).join('') + '</tr>'; idx++; }
      idx--;
      html += t + '</tbody></table>';
      continue;
    }

    // [toc] / [[toc]] → table of contents from the page's headings.
    if (/^\[\[?toc\]?\]$/i.test(line.trim())) {
      closeList();
      html += '<nav class="toc"><div class="toc-title">On this page</div><ul>'
        + headings.map(h => `<li class="toc-l${h.level}"><a href="#${slugify(h.text)}">${inline(h.text)}</a></li>`).join('')
        + '</ul></nav>';
      continue;
    }

    const task = /^\s*[-*] \[([ xX])\] (.*)/.exec(line);
    if (task) {
      if (!inList) { html += '<ul class="tasks">'; inList = true; }
      const done = task[1] !== ' ';
      html += `<li class="task${done ? ' done' : ''}"><input type="checkbox"${nested ? ' disabled' : ` data-line="${idx}"`}${done ? ' checked' : ''} /><span>${inline(task[2])}</span></li>`;
      continue;
    }
    const listItem = /^\s*[-*] (.*)/.exec(line);
    if (listItem) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(listItem[1])}</li>`; continue; }
    closeList();
    const h = /^(#{1,3}) (.*)/.exec(line);
    if (h) { const t = h[2].trim(); html += `<h${h[1].length + 1} id="${slugify(t)}">${inline(t)}</h${h[1].length + 1}>`; continue; }
    html += line.trim() ? `<p>${inline(line)}</p>` : '';
  }
  if (inList) html += '</ul>';
  if (inCode) html += '</code></pre>';
  return html;
}

function render(md) {
  const lines = esc(md).split('\n');
  // Pre-scan headings (outside code fences) for the [toc] macro + anchor ids.
  const headings = []; let fc = false;
  for (const l of lines) {
    if (l.startsWith('```')) { fc = !fc; continue; }
    if (fc) continue;
    const m = /^(#{1,3}) (.*)/.exec(l);
    if (m) headings.push({ level: m[1].length, text: m[2].trim() });
  }
  return renderBlocks(lines, headings, false);
}

export default function App() {
  const [me, setMe] = useState(null);
  const [spaces, setSpaces] = useState([]);
  const [activeSpace, setActiveSpace] = useState(null);   // space id
  const [spaceSettings, setSpaceSettings] = useState(null); // null, or {members} when the panel is open
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('viewer');
  const [templates, setTemplates] = useState([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [notifs, setNotifs] = useState({ unread: 0, items: [] });
  const [showNotifs, setShowNotifs] = useState(false);
  const [pageRestrict, setPageRestrict] = useState(null); // null closed; array = allowlist while open
  const [newRestrictEmail, setNewRestrictEmail] = useState('');
  const [pages, setPages] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [page, setPage] = useState(null);
  const [body, setBody] = useState('');
  const [title, setTitle] = useState('');
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState(null);
  const [searchScope, setSearchScope] = useState(false); // false = all spaces, true = active space
  const [trash, setTrash] = useState(null);   // null = not viewing the trash
  const [labelPages, setLabelPages] = useState(null); // null, or {id,name,items} label filter
  const [history, setHistory] = useState(null);       // null = not viewing history; array = version list
  const [viewingVersion, setViewingVersion] = useState(null); // the version object being previewed
  const [comments, setComments] = useState(null);     // null = panel closed; array = open
  const [newComment, setNewComment] = useState('');
  const [replyTo, setReplyTo] = useState(null);       // root comment id being replied to
  const [replyText, setReplyText] = useState('');
  const [error, setError] = useState('');
  const saveTimer = useRef(null);
  const fileInputRef = useRef(null);
  const editorRef = useRef(null);       // the CodeMirror host element
  const cmViewRef = useRef(null);       // the CodeMirror EditorView
  const ydocRef = useRef(null);
  const providerRef = useRef(null);
  const ytextRef = useRef(null);
  const collabActiveRef = useRef(false);
  const [collabPeers, setCollabPeers] = useState([]); // [{name,color}] of everyone editing (incl. self)
  const [showOverview, setShowOverview] = useState(false);
  const dragIdRef = useRef(null);
  const flash = useCallback(e => { setError(String(e.message || e)); setTimeout(() => setError(''), 5000); }, []);

  // Deep link from suite search: /?space=<id>&page=<id> opens that space and page.
  const deepLinkRef = useRef((() => {
    const sp = new URLSearchParams(location.search);
    return sp.get('space') ? { space: Number(sp.get('space')), page: Number(sp.get('page')) || null } : null;
  })());
  const refreshTree = useCallback(() => api.pages(activeSpace).then(setPages).catch(flash), [activeSpace, flash]);
  useEffect(() => {
    api.me().then(setMe).catch(flash);
    api.spaces().then(ss => {
      setSpaces(ss);
      const linked = ss.find(x => Number(x.id) === Number(deepLinkRef.current?.space));
      if (!linked) deepLinkRef.current = null;
      if (ss.length) setActiveSpace((linked || ss[0]).id);
    }).catch(flash);
    api.templates().then(setTemplates).catch(() => {});
  }, []); // eslint-disable-line

  // Tell the suite header's Copilot which page is open, so "summarize this" knows.
  useEffect(() => {
    const bar = document.querySelector('synergy-app-bar');
    if (!bar) return;
    bar.setAttribute('context', page?.id ? new URLSearchParams({ space: String(page.space_id ?? activeSpace ?? ''), page: String(page.id) }).toString() : '');
  }, [page, activeSpace]);

  // Poll notifications so the unread badge stays fresh.
  const loadNotifs = useCallback(() => api.notifications().then(setNotifs).catch(() => {}), []);
  useEffect(() => { loadNotifs(); const t = setInterval(loadNotifs, 60000); return () => clearInterval(t); }, [loadNotifs]);

  // Load the tree whenever the active space changes, and drop the open page —
  // it belonged to the space we just left.
  useEffect(() => {
    if (!activeSpace) return;
    setTrash(null); setResults(null); setSearch(''); setLabelPages(null); setShowOverview(false);
    const want = deepLinkRef.current?.page;
    deepLinkRef.current = null;
    api.pages(activeSpace).then(ps => {
      setPages(ps);
      const linked = want && ps.find(x => Number(x.id) === want);
      setActiveId(linked ? linked.id : ps.length ? ps[0].id : null);
    }).catch(flash);
  }, [activeSpace]); // eslint-disable-line

  useEffect(() => {
    setHistory(null); setViewingVersion(null); setComments(null); setReplyTo(null); setReplyText('');
    if (activeId) setShowOverview(false);
    if (!activeId) { setPage(null); return; }
    api.page(activeId).then(p => { setPage(p); setBody(p.body); setTitle(p.title); setEditing(false); }).catch(flash);
  }, [activeId, flash]);

  // debounced autosave while editing
  const scheduleSave = useCallback((newBody, newTitle) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.update(activeId, { body: newBody, title: newTitle }).then(refreshTree).catch(flash);
    }, 800);
  }, [activeId, refreshTree, flash]);

  // Live co-editing: while editing, mount a CodeMirror editor bound to the page's
  // shared Yjs document over /collab. y-codemirror.next renders remote users'
  // cursors + selections in their colours. When the collab server is synced it
  // persists; if it never connects, an autosave fallback writes pages.body.
  useEffect(() => {
    if (!editing || !activeId || !editorRef.current) return undefined;
    let cancelled = false;
    (async () => {
      let Y, HocuspocusProvider, EditorState, EditorView, keymap, defaultKeymap, history, historyKeymap, yCollab, yUndoManagerKeymap;
      try {
        Y = await import('yjs');
        ({ HocuspocusProvider } = await import('@hocuspocus/provider'));
        ({ EditorState } = await import('@codemirror/state'));
        ({ EditorView, keymap } = await import('@codemirror/view'));
        ({ defaultKeymap, history, historyKeymap } = await import('@codemirror/commands'));
        ({ yCollab, yUndoManagerKeymap } = await import('y-codemirror.next'));
      } catch (e) { flash(new Error('editor failed to load')); return; }
      if (cancelled || !editorRef.current) return;
      const ydoc = new Y.Doc();
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const override = new URLSearchParams(location.search).get('collab');
      const url = override || `${proto}://${location.host}/collab`;
      const provider = new HocuspocusProvider({
        url, name: `page-${activeId}`, document: ydoc, token: DEV_AS || 'proxy',
        onAwarenessUpdate: ({ states }) => {
          if (cancelled) return;
          const seen = new Set(), users = [];
          for (const st of states) { const u = st.user; if (u && u.name && !seen.has(u.name)) { seen.add(u.name); users.push(u); } }
          setCollabPeers(users);
        },
      });
      const meName = String(DEV_AS || (me && me.email) || 'someone').split('@')[0];
      const meColor = colorFor(meName);
      try { provider.awareness.setLocalStateField('user', { name: meName, color: meColor, colorLight: meColor }); } catch { /* noop */ }
      const ytext = ydoc.getText('body');
      const undoManager = new Y.UndoManager(ytext);
      ydocRef.current = ydoc; providerRef.current = provider; ytextRef.current = ytext;
      provider.on('synced', () => { collabActiveRef.current = true; });

      const view = new EditorView({
        parent: editorRef.current,
        state: EditorState.create({
          doc: ytext.toString(),
          extensions: [
            history(),
            keymap.of([...defaultKeymap, ...historyKeymap, ...yUndoManagerKeymap]),
            EditorView.lineWrapping,
            yCollab(ytext, provider.awareness, { undoManager }),
            EditorView.updateListener.of(u => {
              if (!u.docChanged) return;
              const text = u.state.doc.toString();
              setBody(text);
              if (!collabActiveRef.current) { // not persisted by collab yet → autosave fallback
                clearTimeout(saveTimer.current);
                saveTimer.current = setTimeout(() => api.update(activeId, { body: text }).then(refreshTree).catch(flash), 800);
              }
            }),
            EditorView.theme({
              '&': { height: '100%' },
              '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, monospace', fontSize: '14px', lineHeight: '1.55' },
              '.cm-content': { padding: '14px' },
            }),
          ],
        }),
      });
      cmViewRef.current = view;
      setBody(ytext.toString());
    })();
    return () => {
      cancelled = true; collabActiveRef.current = false; setCollabPeers([]);
      try { cmViewRef.current && cmViewRef.current.destroy(); } catch { /* noop */ }
      try { providerRef.current && providerRef.current.destroy(); } catch { /* noop */ }
      try { ydocRef.current && ydocRef.current.destroy(); } catch { /* noop */ }
      cmViewRef.current = providerRef.current = ydocRef.current = ytextRef.current = null;
    };
  }, [editing, activeId]); // eslint-disable-line

  const tree = useMemo(() => {
    const children = {};
    for (const p of pages) {
      const k = p.parent_id || 'root';
      (children[k] = children[k] || []).push(p);
    }
    return children;
  }, [pages]);

  // Is `ancestorId` an ancestor of `nodeId`? Used to block a drag that would nest
  // a page under its own descendant (a cycle).
  function isAncestor(ancestorId, nodeId) {
    const byId = {}; for (const p of pages) byId[p.id] = p;
    let cur = byId[nodeId], guard = 0;
    while (cur && cur.parent_id != null && guard++ < 1000) {
      if (String(cur.parent_id) === String(ancestorId)) return true;
      cur = byId[cur.parent_id];
    }
    return false;
  }
  async function dropUnder(targetId) {
    const src = dragIdRef.current; dragIdRef.current = null;
    if (!src || String(src) === String(targetId)) return;
    if (targetId !== 'root' && isAncestor(src, targetId)) { flash(new Error("Can't move a page under its own subpage")); return; }
    try { await api.update(src, { parentId: targetId }); await refreshTree(); }
    catch (e) { flash(e); }
  }

  function renderTree(parentKey, depth) {
    return (tree[parentKey] || []).map(p => (
      <React.Fragment key={p.id}>
        <div className={`tree-item ${p.id === activeId ? 'active' : ''}`}
          style={{ paddingLeft: 10 + depth * 14 }}
          draggable
          onDragStart={e => { dragIdRef.current = p.id; e.dataTransfer.effectAllowed = 'move'; }}
          onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drop-target'); }}
          onDragLeave={e => e.currentTarget.classList.remove('drop-target')}
          onDrop={e => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('drop-target'); dropUnder(p.id); }}
          {...pressable(() => { setShowOverview(false); setResults(null); setSearch(''); setActiveId(p.id); })}
          title="Drag onto another page to nest it there">
          {p.title}
        </div>
        {renderTree(p.id, depth + 1)}
      </React.Fragment>
    ));
  }

  async function runSearch(s, scoped) {
    if (s.trim().length < 2) { setResults(null); return; }
    try { setResults(await api.search(s, scoped ? { space: activeSpace } : {})); } catch { /* noop */ }
  }
  function doSearch(s) { setSearch(s); runSearch(s, searchScope); }

  // Clicking a label filters to every page carrying it (across spaces).
  async function openLabel(l) {
    try {
      setSearch(''); setResults(null); setTrash(null);
      setLabelPages({ id: l.id, name: l.name, items: await api.pagesByLabel(l.id) });
    } catch (e) { flash(e); }
  }
  async function removeLabel(labelId) {
    if (!page) return;
    try { const labels = await api.removeLabel(page.id, labelId); setPage(p => (p ? { ...p, labels } : p)); }
    catch (e) { flash(e); }
  }
  async function addLabelPrompt() {
    if (!page) return;
    const name = prompt('Add a label (e.g. runbook, security)');
    if (!name || !name.trim()) return;
    try { const labels = await api.addLabel(page.id, name.trim()); setPage(p => (p ? { ...p, labels } : p)); }
    catch (e) { flash(e); }
  }

  async function onPickFile(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = ''; // let the same file be picked again later
    if (!file || !page) return;
    if (file.size > 12 * 1024 * 1024) { flash(new Error('File exceeds the 12MB limit')); return; }
    try {
      const att = await api.uploadAttachment(page.id, file);
      // An image attachment embeds itself at the end of the page so it shows.
      if (/^image\//.test(att.mime)) {
        const embed = `\n\n![${att.filename}](/api/attachments/${att.id})\n`;
        if (ytextRef.current && ydocRef.current) {
          ydocRef.current.transact(() => ytextRef.current.insert(ytextRef.current.length, embed)); // into the CRDT
        } else {
          const next = `${page.body || ''}${embed}`;
          await api.update(page.id, { body: next }); setBody(next);
        }
      }
      const fresh = await api.page(page.id);
      setPage(p => (p ? { ...p, attachments: fresh.attachments } : fresh)); // refresh attachments, keep editor body
      if (!ytextRef.current) setBody(fresh.body);
    } catch (e) { flash(e); }
  }
  async function removeAttachment(aid) {
    if (!page) return;
    try { await api.deleteAttachment(aid); setPage(await api.page(page.id)); }
    catch (e) { flash(e); }
  }

  async function exportPdf() {
    if (!page) return;
    try {
      const res = await fetch(`/api/pages/${page.id}/export.pdf`, DEV_AS ? { headers: { 'x-dev-user': DEV_AS } } : {});
      if (!res.ok) throw new Error('pdf ' + res.status);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(page.title || 'page').replace(/[^\w.-]+/g, '_')}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch { window.print(); } // service down/unconfigured → browser print
  }

  async function openPageRestrict() {
    if (!page) return;
    try { setPageRestrict(await api.pageRestrictions(page.id)); } catch (e) { flash(e); }
  }
  async function addRestriction() {
    const email = newRestrictEmail.trim();
    if (!email || !page) return;
    try {
      const list = await api.addRestriction(page.id, email);
      setPageRestrict(list); setNewRestrictEmail('');
      setPage(p => (p ? { ...p, restrictedTo: list } : p));
    } catch (e) { flash(e); }
  }
  async function removeRestriction(email) {
    if (!page) return;
    try {
      const list = await api.removeRestriction(page.id, email);
      setPageRestrict(list);
      setPage(p => (p ? { ...p, restrictedTo: list } : p));
    } catch (e) { flash(e); }
  }

  async function openNotif(n) {
    try { await api.markNotifRead(n.id); } catch { /* noop */ }
    setShowNotifs(false); setActiveId(n.page_id); loadNotifs();
  }
  async function markAllNotifsRead() {
    try { await api.markNotifRead(); loadNotifs(); } catch (e) { flash(e); }
  }

  async function newFromTemplate(t) {
    try {
      const p = await api.create({ title: `Untitled (${t.name})`, spaceId: activeSpace, templateId: t.id });
      setShowTemplates(false); await refreshTree(); setActiveId(p.id); setEditing(true);
    } catch (e) { flash(e); }
  }
  async function saveAsTemplate() {
    if (!page) return;
    const name = prompt('Save this page as a template named:');
    if (!name || !name.trim()) return;
    try { await api.createTemplate(name.trim(), page.body || ''); setTemplates(await api.templates()); }
    catch (e) { flash(e); }
  }

  // --- Space settings (admins only) ---
  async function openSpaceSettings() {
    try { setSpaceSettings({ members: await api.spaceMembers(activeSpace) }); }
    catch (e) { flash(e); }
  }
  async function toggleRestricted(restricted) {
    try { await api.updateSpace(activeSpace, { restricted }); setSpaces(await api.spaces()); }
    catch (e) { flash(e); }
  }
  async function addMember() {
    const email = newMemberEmail.trim();
    if (!email) return;
    try {
      const members = await api.addMember(activeSpace, email, newMemberRole);
      setSpaceSettings({ members }); setNewMemberEmail('');
    } catch (e) { flash(e); }
  }
  async function removeMember(email) {
    try { setSpaceSettings({ members: await api.removeMember(activeSpace, email) }); }
    catch (e) { flash(e); }
  }

  async function openComments() {
    try { setHistory(null); setViewingVersion(null); setComments(await api.comments(page.id)); }
    catch (e) { flash(e); }
  }
  async function postComment(parentId, text) {
    if (!text.trim()) return;
    try {
      await api.addComment(page.id, text.trim(), parentId);
      if (parentId) { setReplyTo(null); setReplyText(''); } else setNewComment('');
      setComments(await api.comments(page.id));
    } catch (e) { flash(e); }
  }
  async function toggleResolve(cid, resolved) {
    try { await api.resolveComment(cid, resolved); setComments(await api.comments(page.id)); }
    catch (e) { flash(e); }
  }
  async function delComment(cid) {
    if (!confirm('Delete this comment' + '? Replies under it are removed too.')) return;
    try { await api.deleteComment(cid); setComments(await api.comments(page.id)); }
    catch (e) { flash(e); }
  }

  // One click on a checkbox rewrites that line and saves. Notes were read-only
  // until you found the Edit button, which is the opposite of how a checklist
  // gets used.
  async function onTaskToggle(ev) {
    const box = ev.target;
    if (!box || box.type !== 'checkbox') return;
    const line = Number(box.getAttribute('data-line'));
    if (!page || Number.isNaN(line)) return;
    const lines = String(page.body || '').split('\n');
    const m = /^(\s*[-*] \[)([ xX])(\] .*)$/.exec(lines[line] || '');
    if (!m) return;
    // Drive the state from the stored text, never from the DOM: if the save
    // fails the box must not be left showing a value nobody persisted.
    box.checked = m[2] !== ' ';
    lines[line] = m[1] + (m[2] === ' ' ? 'x' : ' ') + m[3];
    const next = lines.join('\n');
    try {
      await api.update(page.id, { body: next });
      setPage(p => (p && p.id === page.id ? { ...p, body: next } : p));
      setBody(next);
    } catch (e) { flash(e); }
  }

  const activeSpaceObj = spaces.find(s => String(s.id) === String(activeSpace));
  const isSpaceAdmin = activeSpaceObj && activeSpaceObj.role === 'admin';
  const canEdit = !!page && page.myRole !== 'viewer';

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">S</span> SynergyNotes
          <button className="bell" title="Notifications" onClick={() => setShowNotifs(v => !v)}>
            🔔{notifs.unread > 0 && <span className="bell-badge">{notifs.unread > 9 ? '9+' : notifs.unread}</span>}
          </button>
        </div>
        {showNotifs && (
          <div className="notif-panel">
            <div className="notif-head">
              <b>Notifications</b>
              {notifs.items.some(n => !n.read) && <button className="link" onClick={markAllNotifsRead}>mark all read</button>}
            </div>
            {notifs.items.length === 0
              ? <div className="snippet" style={{ padding: 8 }}>Nothing yet.</div>
              : notifs.items.map(n => (
                  <div key={n.id} className={`notif-item${n.read ? '' : ' unread'}`} onClick={() => openNotif(n)}>
                    <div className="notif-line">
                      <b>{String(n.actor || '').split('@')[0]}</b> {n.kind === 'mention' ? 'mentioned you' : 'replied'} in <i>{n.page_title || 'a page'}</i>
                    </div>
                    <div className="snippet">{n.snippet}</div>
                  </div>
                ))}
          </div>
        )}
        <div className="space-switch">
          <select value={activeSpace || ''} onChange={e => setActiveSpace(Number(e.target.value))}>
            {spaces.map(s => <option key={s.id} value={s.id}>{s.restricted ? '🔒 ' : ''}{s.name} ({s.pages})</option>)}
          </select>
          {isSpaceAdmin && <button className="mini" title="Space settings" onClick={openSpaceSettings}>⚙</button>}
          <button className="mini" title="New space" onClick={async () => {
            const name = prompt('New space name');
            if (!name || !name.trim()) return;
            try {
              const sp = await api.createSpace({ name: name.trim() });
              setSpaces(await api.spaces());
              setActiveSpace(sp.id);
            } catch (e) { flash(e); }
          }}>+</button>
        </div>
        <input className="search" placeholder="Search pages…" value={search} onChange={e => doSearch(e.target.value)} />
        {results && (
          <label className="scope-toggle">
            <input type="checkbox" checked={searchScope}
              onChange={e => { setSearchScope(e.target.checked); runSearch(search, e.target.checked); }} />
            this space only
          </label>
        )}
        {trash ? (
          trash.length === 0
            ? <div className="snippet" style={{ padding: 10 }}>Trash is empty.</div>
            : trash.map(t => (
                <div key={t.id} className="tree-item">
                  <b>{t.title}</b>
                  <div className="snippet">
                    {t.subpages > 0 && <>+{t.subpages} subpage{t.subpages > 1 ? 's' : ''} · </>}
                    trashed by {String(t.deleted_by || 'unknown').split('@')[0]}
                    {' · '}{new Date(t.deleted_at).toLocaleString()}
                  </div>
                  <button className="mini" onClick={async () => {
                    try {
                      await api.restore(t.id);
                      await refreshTree();
                      setTrash(await api.trash());
                      setActiveId(t.id);
                    } catch (e) { flash(e); }
                  }}>restore</button>
                </div>
              ))
        ) : results ? (
          results.map(r => (
            <div key={r.id} className="tree-item" {...pressable(() => { setResults(null); setSearch(''); setActiveId(r.id); })}>
              <b>{r.title}</b><div className="snippet">{r.snippet}</div>
            </div>
          ))
        ) : labelPages ? (
          <>
            <div className="label-head">
              <span>Label: <b>{labelPages.name}</b></span>
              <button className="mini" onClick={() => setLabelPages(null)}>×</button>
            </div>
            {labelPages.items.length === 0
              ? <div className="snippet" style={{ padding: 10 }}>No pages with this label.</div>
              : labelPages.items.map(r => (
                  <div key={r.id} className="tree-item" {...pressable(() => { setLabelPages(null); setActiveId(r.id); })}>{r.title}</div>
                ))}
          </>
        ) : (
          <>
            <div className={`tree-item overview-item ${showOverview ? 'active' : ''}`}
              {...pressable(() => { setShowOverview(true); setActiveId(null); })}
              onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drop-target'); }}
              onDragLeave={e => e.currentTarget.classList.remove('drop-target')}
              onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('drop-target'); dropUnder('root'); }}
              title="Space overview — drop a page here to move it to the top level">▤ Overview</div>
            {renderTree('root', 0)}
          </>
        )}
        <button className="new-page" onClick={async () => {
          try {
            const p = await api.create({ title: 'Untitled page', spaceId: activeSpace });
            await refreshTree(); setActiveId(p.id); setEditing(true);
          } catch (e) { flash(e); }
        }}>+ New page</button>
        {templates.length > 0 && (
          <div className="tmpl-picker">
            <button className="mini" onClick={() => setShowTemplates(v => !v)}>
              {showTemplates ? '▾' : '▸'} from template
            </button>
            {showTemplates && templates.map(t => (
              <div key={t.id} className="tmpl-item" {...pressable(() => newFromTemplate(t))} title={(t.body || '').slice(0, 120)}>{t.name}</div>
            ))}
          </div>
        )}
        <button className="mini" style={{ margin: '4px 10px' }} onClick={async () => {
          if (trash) { setTrash(null); return; }
          try { setResults(null); setSearch(''); setTrash(await api.trash()); } catch (e) { flash(e); }
        }}>{trash ? '\u2190 Back to pages' : 'Trash'}</button>
        <div className="me">{me?.email}</div>
      </aside>

      <main className="main">
        {showOverview ? (
          <div className="overview">
            <h1>{(activeSpaceObj && activeSpaceObj.name) || 'Space'} · overview</h1>
            <div className="ov-stats">
              <div className="ov-stat"><b>{pages.length}</b><span>pages</span></div>
              {activeSpaceObj && activeSpaceObj.restricted && <div className="ov-stat"><b>🔒</b><span>restricted</span></div>}
            </div>
            <h2>Recently updated</h2>
            <div className="ov-recent">
              {pages.length === 0
                ? <div className="snippet">No pages in this space yet.</div>
                : [...pages].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 12).map(p => (
                    <div key={p.id} className="ov-row" {...pressable(() => { setShowOverview(false); setActiveId(p.id); })}>
                      <span className="ov-title">{p.title}</span>
                      <span className="hint">{String(p.updated_by || '').split('@')[0]} · {new Date(p.updated_at).toLocaleString()}</span>
                    </div>
                  ))}
            </div>
          </div>
        ) : page ? (
          <>
            <header className="page-head">
              {editing
                ? <input className="title-input" value={title}
                    onChange={e => { setTitle(e.target.value); scheduleSave(body, e.target.value); }} />
                : <h1>{page.restrictedTo && page.restrictedTo.length ? '🔒 ' : ''}{page.title}</h1>}
              <div className="actions">
                <span className="hint">
                  {page.created_by ? <>created by {page.created_by.split('@')[0]} · </> : null}
                  last edited by {page.updated_by?.split('@')[0]} · {new Date(page.updated_at).toLocaleString()}
                </span>
                {!editing && (
                  <button className="mini" onClick={async () => {
                    try { setComments(null); setViewingVersion(null); setHistory(await api.versions(page.id)); } catch (e) { flash(e); }
                  }}>History</button>
                )}
                {!editing && (
                  <button className="mini" onClick={openComments}>Comments</button>
                )}
                {!editing && (
                  <button className="mini" title="Download as PDF" onClick={exportPdf}>PDF</button>
                )}
                {!editing && (
                  <button className="mini" title="Export to Word (.docx)" onClick={() => window.open(`/api/pages/${page.id}/export.docx`, '_blank')}>Word</button>
                )}
                {editing && collabPeers.length > 1 && (
                  <span className="collab-peers" title="Editing now">
                    {collabPeers.map((u, i) => (
                      <span key={i} className="peer" style={{ color: u.color || 'var(--accent)' }}>● {u.name}</span>
                    ))}
                  </span>
                )}
                {canEdit
                  ? <button className="mini" onClick={() => { setHistory(null); setViewingVersion(null); setComments(null); setEditing(!editing); }}>{editing ? 'Done' : 'Edit'}</button>
                  : <span className="hint">read-only</span>}
                {editing && (
                  <>
                    <button className="mini" onClick={async () => {
                      try {
                        const sub = await api.create({ title: 'Untitled subpage', parentId: page.id });
                        await refreshTree(); setActiveId(sub.id);
                      } catch (e) { flash(e); }
                    }}>+ subpage</button>
                    <button className="mini" onClick={saveAsTemplate}>save as template</button>
                    <button className="mini" onClick={openPageRestrict}>{page.restrictedTo && page.restrictedTo.length ? '🔒 restricted' : 'restrict'}</button>
                    <button className="mini danger" onClick={async () => {
                      if (!confirm(`Move "${page.title}" and all its subpages to the trash?`)) return;
                      try { await api.remove(page.id); await refreshTree(); setActiveId(pages.find(p => p.id !== page.id)?.id || null); } catch (e) { flash(e); }
                    }}>move to trash</button>
                  </>
                )}
              </div>
            </header>
            <div className="labels-row">
              {(page.labels || []).map(l => (
                <span className="label-chip" key={l.id}>
                  <span className="label-name" onClick={() => openLabel(l)} title="Filter by this label">{l.name}</span>
                  {canEdit && <button className="label-x" title="Remove label" onClick={() => removeLabel(l.id)}>×</button>}
                </span>
              ))}
              {canEdit && <button className="label-add" onClick={addLabelPrompt}>+ label</button>}
            </div>
            <div className="attach-row">
              {(page.attachments || []).map(a => (
                <span className="attach-chip" key={a.id}>
                  <a href={`/api/attachments/${a.id}`} target="_blank" rel="noopener noreferrer">{a.filename}</a>
                  <span className="attach-size">{fmtSize(a.size)}</span>
                  {canEdit && <button className="attach-x" title="Remove" onClick={() => removeAttachment(a.id)}>×</button>}
                </span>
              ))}
              {canEdit && <button className="label-add" onClick={() => fileInputRef.current && fileInputRef.current.click()}>+ attach</button>}
              <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={onPickFile} />
            </div>
            {editing ? (
              <div className="split">
                <div className="cm-host" ref={editorRef} />
                <div className="preview" dangerouslySetInnerHTML={{ __html: render(body) }} />
              </div>
            ) : history ? (
              <div className="history">
                <div className="history-head">
                  <b>Version history</b>
                  <button className="mini" onClick={() => { setHistory(null); setViewingVersion(null); }}>Close</button>
                </div>
                {history.length === 0 ? (
                  <div className="snippet" style={{ padding: 10 }}>No saved versions yet — edits start the history.</div>
                ) : (
                  <div className="history-body">
                    <ul className="version-list">
                      {history.map(v => (
                        <li key={v.version_no}
                            className={viewingVersion?.version_no === v.version_no ? 'active' : ''}
                            onClick={async () => { try { setViewingVersion(await api.version(page.id, v.version_no)); } catch (e) { flash(e); } }}>
                          <div>v{v.version_no}{v.is_current && <span className="cur"> · current</span>}</div>
                          <div className="snippet">{String(v.edited_by || 'unknown').split('@')[0]} · {new Date(v.created_at).toLocaleString()}</div>
                        </li>
                      ))}
                    </ul>
                    <div className="version-view">
                      {viewingVersion ? (
                        <>
                          <div className="version-view-head">
                            <b>{viewingVersion.title}</b>
                            <button className="mini" onClick={async () => {
                              if (!confirm(`Restore v${viewingVersion.version_no}? The current content is kept as a new version.`)) return;
                              try {
                                const p = await api.restoreVersion(page.id, viewingVersion.version_no);
                                setPage(p); setBody(p.body); setTitle(p.title);
                                setHistory(await api.versions(p.id)); setViewingVersion(null);
                                await refreshTree();
                              } catch (e) { flash(e); }
                            }}>Restore this version</button>
                          </div>
                          <div className="preview" dangerouslySetInnerHTML={{ __html: render(viewingVersion.body) }} />
                        </>
                      ) : <div className="empty" style={{ minHeight: 120 }}>Select a version to preview</div>}
                    </div>
                  </div>
                )}
              </div>
            ) : comments ? (
              <div className="comments">
                <div className="history-head">
                  <b>Comments{comments.length ? ` (${comments.length})` : ''}</b>
                  <button className="mini" onClick={() => setComments(null)}>Close</button>
                </div>
                {canEdit && (
                  <div className="comment-composer">
                    <textarea placeholder="Add a comment…" value={newComment}
                      onChange={e => setNewComment(e.target.value)} />
                    <button className="mini" onClick={() => postComment(null, newComment)}>Comment</button>
                  </div>
                )}
                {comments.filter(c => !c.parent_id).length === 0 ? (
                  <div className="snippet" style={{ padding: 10 }}>No comments yet.</div>
                ) : comments.filter(c => !c.parent_id).map(root => (
                  <div className={`comment-thread${root.resolved ? ' resolved' : ''}`} key={root.id}>
                    <div className="comment-head">
                      <b>{String(root.author || 'unknown').split('@')[0]}</b>
                      <span className="hint">{new Date(root.created_at).toLocaleString()}</span>
                      {root.resolved && <span className="resolved-badge">resolved by {String(root.resolved_by || '').split('@')[0]}</span>}
                    </div>
                    <div className="comment-body">{root.body}</div>
                    {canEdit && (
                      <div className="comment-actions">
                        <button className="link" onClick={() => { setReplyTo(root.id); setReplyText(''); }}>Reply</button>
                        <button className="link" onClick={() => toggleResolve(root.id, !root.resolved)}>{root.resolved ? 'Reopen' : 'Resolve'}</button>
                        <button className="link danger" onClick={() => delComment(root.id)}>Delete</button>
                      </div>
                    )}
                    {comments.filter(c => String(c.parent_id) === String(root.id)).map(child => (
                      <div className="comment reply" key={child.id}>
                        <div className="comment-head">
                          <b>{String(child.author || 'unknown').split('@')[0]}</b>
                          <span className="hint">{new Date(child.created_at).toLocaleString()}</span>
                        </div>
                        <div className="comment-body">{child.body}</div>
                        {canEdit && (
                          <div className="comment-actions">
                            <button className="link danger" onClick={() => delComment(child.id)}>Delete</button>
                          </div>
                        )}
                      </div>
                    ))}
                    {replyTo === root.id && (
                      <div className="comment-composer reply">
                        <textarea placeholder="Reply…" value={replyText}
                          onChange={e => setReplyText(e.target.value)} />
                        <button className="mini" onClick={() => postComment(root.id, replyText)}>Reply</button>
                        <button className="mini" onClick={() => { setReplyTo(null); setReplyText(''); }}>Cancel</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="preview full"
                onClick={onTaskToggle}
                dangerouslySetInnerHTML={{ __html: render(page.body) }} />
            )}
          </>
        ) : <div className="empty">Select or create a page</div>}
      </main>

      {spaceSettings && activeSpaceObj && (
        <div className="modal-backdrop" onClick={() => setSpaceSettings(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <b>Space settings — {activeSpaceObj.name}</b>
              <button className="mini" onClick={() => setSpaceSettings(null)}>Close</button>
            </div>
            <label className="restrict-toggle">
              <input type="checkbox" checked={!!activeSpaceObj.restricted}
                onChange={e => toggleRestricted(e.target.checked)} />
              Restrict this space — only the members below (plus its creator and global admins) can see it
            </label>
            <div className="members">
              <div className="members-head">Members</div>
              {spaceSettings.members.length === 0
                ? <div className="snippet" style={{ padding: '6px 0' }}>
                    {activeSpaceObj.restricted
                      ? 'No members yet — only the creator and global admins can access.'
                      : 'Space is open to everyone; add members and restrict it to lock it down.'}
                  </div>
                : spaceSettings.members.map(m => (
                    <div className="member-row" key={m.email}>
                      <span className="member-email">{m.email}</span>
                      <span className="member-role">{m.role}</span>
                      <button className="attach-x" title="Remove" onClick={() => removeMember(m.email)}>×</button>
                    </div>
                  ))}
              <div className="member-add">
                <input placeholder="name@example.com" value={newMemberEmail}
                  onChange={e => setNewMemberEmail(e.target.value)} />
                <select value={newMemberRole} onChange={e => setNewMemberRole(e.target.value)}>
                  <option value="viewer">viewer</option>
                  <option value="editor">editor</option>
                  <option value="admin">admin</option>
                </select>
                <button className="mini" onClick={addMember}>Add</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pageRestrict && page && (
        <div className="modal-backdrop" onClick={() => setPageRestrict(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <b>Restrict page — {page.title}</b>
              <button className="mini" onClick={() => setPageRestrict(null)}>Close</button>
            </div>
            <div className="snippet" style={{ marginBottom: 12 }}>
              {pageRestrict.length === 0
                ? 'Anyone who can see this space can see this page. Add people to restrict it to them (space admins keep access).'
                : 'Only these people — plus space admins — can see this page.'}
            </div>
            <div className="members">
              {pageRestrict.map(em => (
                <div className="member-row" key={em}>
                  <span className="member-email">{em}</span>
                  <button className="attach-x" title="Remove" onClick={() => removeRestriction(em)}>×</button>
                </div>
              ))}
              <div className="member-add">
                <input placeholder="name@example.com" value={newRestrictEmail}
                  onChange={e => setNewRestrictEmail(e.target.value)} />
                <button className="mini" onClick={addRestriction}>Add</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && <div className="toast">{error}</div>}
    </div>
  );
}
