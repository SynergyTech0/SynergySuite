import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { api, connectWs } from './api.js';

// ---------- markdown-ish renderer ----------
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Inline formatting: code, bold, italic, strike, links, raw urls, mentions.
function inline(text, users) {
  let h = text;
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  h = h.replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1<em>$2</em>');
  // markdown links [text](url)
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  // bare urls (skip ones already inside an href="...")
  h = h.replace(/(^|[^"=>])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  for (const u of users) {
    const tag = '@' + esc(u.name);
    if (h.includes(tag)) h = h.split(tag).join(`<span class="mention">${tag}</span>`);
  }
  h = h.replace(/@(channel|here|everyone)\b/g, '<span class="mention">@$1</span>');
  return h;
}

function renderBody(body, users) {
  const escaped = esc(body);
  // Pull out fenced code blocks first so inline rules never touch them.
  const blocks = [];
  let work = escaped.replace(/```\n?([\s\S]*?)```/g, (_, code) => {
    blocks.push(code.replace(/\n$/, ''));
    return ` BLOCK${blocks.length - 1} `;
  });

  const lines = work.split('\n');
  const out = [];
  let listType = null; // 'ul' | 'ol'
  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };

  for (const raw of lines) {
    const line = raw;
    const block = /^ BLOCK(\d+) $/.exec(line);
    if (block) {
      closeList();
      out.push(`<pre class="codeblock"><code>${blocks[Number(block[1])]}</code></pre>`);
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    const quote = /^\s*&gt;\s?(.*)$/.exec(line);
    if (bullet) {
      if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
      out.push(`<li>${inline(bullet[1], users)}</li>`);
    } else if (numbered) {
      if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
      out.push(`<li>${inline(numbered[1], users)}</li>`);
    } else if (quote) {
      closeList();
      out.push(`<blockquote>${inline(quote[1], users)}</blockquote>`);
    } else if (line.trim() === '') {
      closeList();
      out.push('');
    } else {
      closeList();
      out.push(inline(line, users) + '<br/>');
    }
  }
  closeList();
  let html = out.join('\n');
  // trim a trailing <br/>
  html = html.replace(/(<br\/>)\n?$/, '');
  return html;
}

const fmtTime = ts => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDay = ts => {
  const d = new Date(ts), today = new Date();
  const yd = new Date(today); yd.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yd.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
};

const EMOJI = ['👍', '❤️', '😂', '🎉', '👀', '✅'];
// Sibling suite apps live next to chat: chat.example.com -> meet.example.com.
const suiteApp = (id) => `${location.protocol}//${location.hostname.replace(/^[^.]+/, id)}`;
const MEET_BASE = suiteApp('meet'); // SynergyMeet — video huddles
const DRIVE_BASE = suiteApp('drive'); // SynergyDrive — files
// Optional Synapse integration; the button only shows when VITE_SYNAPSE_URL is set at build time.
const SYNAPSE_URL = import.meta.env.VITE_SYNAPSE_URL || '';

// ---------- inline icons (Slack-ish line icons) ----------
const ICON = {
  home: 'M3 11 12 3l9 8M5 9.5V21h5v-6h4v6h5V9.5',
  dm: 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4V6a1 1 0 0 1 1-1z',
  bell: 'M12 3a5 5 0 0 0-5 5c0 3-1 4-2 5h14c-1-1-2-2-2-5a5 5 0 0 0-5-5zM10 19a2 2 0 0 0 4 0',
  files: 'M13 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8zM13 3v5h5',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  compose: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4.3-4.3',
  caret: 'M6 9l6 6 6-6',
  star: 'M12 4l2.5 5.3 5.5.6-4 3.9 1.1 5.6L12 16.9 7.4 19.4l1.1-5.6-4-3.9 5.5-.6z',
  headphones: 'M4 13v-1a8 8 0 0 1 16 0v1M4 13a2 2 0 0 1 2 2v2a2 2 0 0 1-4 0v-2a2 2 0 0 1 2-2zM20 13a2 2 0 0 1 2 2v2a2 2 0 0 1-4 0v-2a2 2 0 0 1 2-2z',
  plus: 'M12 5v14M5 12h14',
  hash: 'M9 4 7 20M17 4l-2 16M4 9h16M3 15h16',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  at: 'M16 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM16 8v5a3 3 0 0 0 5 2c1-2 1-4 0-6a9 9 0 1 0-4 9',
  video: 'M4 7h11v10H4zM15 10l5-3v10l-5-3',
  mic: 'M12 4a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V7a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v3',
  slash: 'M14 4 10 20',
  bold: 'M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z',
  link: 'M9 15l6-6M10 6l1-1a4 4 0 0 1 6 6l-1 1M14 18l-1 1a4 4 0 0 1-6-6l1-1',
  listUl: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  listOl: 'M10 6h10M10 12h10M10 18h10M4 5v3M4 5h1M3 17h2l-2 3h2',
  code: 'M8 8l-4 4 4 4M16 8l4 4-4 4',
  quote: 'M7 7H4v6h3l-1 4M17 7h-3v6h3l-1 4',
  emoji: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 10h.01M15 10h.01M8 14a4 4 0 0 0 8 0',
  send: 'M4 12l16-8-6 16-2-6-8-2z',
  board: 'M3 4h18v12H3zM8 20l4-4 4 4M7 12c2-3 3-3 5-1s3 1 5-2',
};
function Icon({ name, size = 18, className }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICON[name]} />
    </svg>
  );
}

function Avatar({ user, size = 36, radius }) {
  const initials = (user?.name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="avatar" style={{ width: size, height: size, background: user?.color || '#888', fontSize: size * 0.42, borderRadius: radius ?? Math.max(6, size * 0.22) }}>
      {initials}
    </div>
  );
}

// ---------- main app ----------
export default function App() {
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState([]);
  const [channels, setChannels] = useState([]);
  const [browsable, setBrowsable] = useState([]);
  const [online, setOnline] = useState(new Set());
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState({});
  const [thread, setThread] = useState(null);
  const [typing, setTyping] = useState({});
  const [connected, setConnected] = useState(false);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [filter, setFilter] = useState('');
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [showNewDm, setShowNewDm] = useState(false);
  const [showNewWorkspace, setShowNewWorkspace] = useState(false);
  const [workspaces, setWorkspaces] = useState([]);
  const [activeWs, setActiveWs] = useState(null);
  const [directory, setDirectory] = useState([]);
  const [error, setError] = useState('');
  const [showMore, setShowMore] = useState(false);

  const wsRef = useRef(null);
  const activeIdRef = useRef(null);
  const threadRef = useRef(null);
  const meRef = useRef(null);
  const activeWsRef = useRef(null);
  activeIdRef.current = activeId;
  threadRef.current = thread;
  meRef.current = me;
  activeWsRef.current = activeWs;

  const usersById = useMemo(() => Object.fromEntries(users.map(u => [u.id, u])), [users]);

  const flashError = useCallback(e => {
    setError(String(e.message || e));
    setTimeout(() => setError(''), 4000);
  }, []);

  // Loads the roster for a workspace. With no argument it refreshes the CURRENT
  // workspace (via ref), so existing callers keep working after a switch.
  const loadMe = useCallback(async wsId => {
    const target = wsId ?? activeWsRef.current ?? undefined;
    const d = await api.me(target);
    setMe(d.me); setUsers(d.users); setDirectory(d.directory || []);
    setChannels(d.channels); setBrowsable(d.browsable); setOnline(new Set(d.online));
    setWorkspaces(d.workspaces || []); setActiveWs(d.activeWorkspace);
    return d;
  }, []);

  const switchWorkspace = useCallback(async wsId => {
    if (Number(wsId) === Number(activeWsRef.current)) return;
    setThread(null); setSearchResults(null); setSearch(''); setFilter('');
    try {
      const d = await loadMe(wsId);
      const gen = d.channels.find(c => c.name === 'general') || d.channels.find(c => c.kind !== 'dm') || d.channels[0];
      setActiveId(gen ? Number(gen.id) : null);
    } catch (e) { setError(String(e.message || e)); setTimeout(() => setError(''), 4000); }
  }, [loadMe]);

  const onEvent = useCallback(ev => {
    switch (ev.type) {
      case 'hello':
        setOnline(new Set(ev.online));
        break;
      case 'presence':
        setOnline(prev => {
          const next = new Set(prev);
          ev.online ? next.add(ev.userId) : next.delete(ev.userId);
          return next;
        });
        break;
      case 'message.new': {
        const m = ev.message;
        const chId = Number(m.channel_id);
        if (m.parent_id) {
          const t = threadRef.current;
          if (t && Number(m.parent_id) === t.rootId) {
            setThread(prev => prev && { ...prev, replies: [...prev.replies.filter(r => r.id !== m.id), m] });
          }
          setMessages(prev => {
            const list = prev[chId];
            if (!list) return prev;
            return { ...prev, [chId]: list.map(r => Number(r.id) === Number(m.parent_id) ? { ...r, reply_count: (r.reply_count || 0) + 1 } : r) };
          });
        } else {
          setMessages(prev => prev[chId]
            ? { ...prev, [chId]: [...prev[chId].filter(x => x.id !== m.id), m] }
            : prev);
        }
        setTyping(prev => {
          const t = { ...(prev[chId] || {}) }; delete t[m.user_id];
          return { ...prev, [chId]: t };
        });
        const isMine = Number(m.user_id) === Number(meRef.current?.id);
        if (chId === activeIdRef.current && !m.parent_id) {
          api.markRead(chId, m.id).catch(() => {});
        } else if (!isMine) {
          setChannels(prev => prev.map(c => Number(c.id) === chId
            ? { ...c, unread: (c.unread || 0) + 1 }
            : c));
        }
        break;
      }
      case 'message.edited': {
        const m = ev.message;
        const chId = Number(m.channel_id);
        setMessages(prev => prev[chId]
          ? { ...prev, [chId]: prev[chId].map(x => x.id === m.id ? m : x) }
          : prev);
        setThread(prev => prev && { ...prev, replies: prev.replies.map(x => x.id === m.id ? m : x) });
        break;
      }
      case 'message.deleted': {
        const chId = Number(ev.channelId);
        setMessages(prev => prev[chId]
          ? { ...prev, [chId]: prev[chId].filter(x => Number(x.id) !== Number(ev.messageId)) }
          : prev);
        setThread(prev => prev && { ...prev, replies: prev.replies.filter(x => Number(x.id) !== Number(ev.messageId)) });
        break;
      }
      case 'typing': {
        const chId = Number(ev.channelId);
        setTyping(prev => ({ ...prev, [chId]: { ...(prev[chId] || {}), [ev.userId]: Date.now() } }));
        break;
      }
      case 'channel.created':
      case 'channel.invited':
        loadMe().catch(() => {});
        break;
      case 'member.joined':
        setChannels(prev => prev.map(c => Number(c.id) === Number(ev.channelId)
          ? { ...c, member_count: (c.member_count || 0) + 1, member_ids: [...(c.member_ids || []), ev.userId] }
          : c));
        break;
    }
  }, [loadMe]);

  // Deep link from suite search: /?ws=<id>&channel=<id>&msg=<id>[&thread=<root id>].
  const deepLinkRef = useRef(null);
  useEffect(() => {
    let ws;
    const link = new URLSearchParams(location.search);
    loadMe(Number(link.get('ws')) || undefined).then(d => {
      const linked = d.channels.find(c => Number(c.id) === Number(link.get('channel')));
      const general = linked || d.channels.find(c => c.name === 'general') || d.channels[0];
      if (linked) deepLinkRef.current = { msg: Number(link.get('msg')) || null, thread: Number(link.get('thread')) || null };
      if (general) setActiveId(Number(general.id));
      ws = connectWs(onEvent, setConnected);
      wsRef.current = ws;
    }).catch(flashError);
    return () => ws?.close();
  }, []); // eslint-disable-line

  useEffect(() => {
    const t = setInterval(() => {
      setTyping(prev => {
        const now = Date.now();
        const next = {};
        for (const [ch, m] of Object.entries(prev)) {
          next[ch] = Object.fromEntries(Object.entries(m).filter(([, ts]) => now - ts < 4000));
        }
        return next;
      });
    }, 1500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!activeId) return;
    setThread(null);
    if (!messages[activeId]) {
      api.messages(activeId).then(list => {
        setMessages(prev => ({ ...prev, [activeId]: list }));
        const last = list[list.length - 1];
        if (last) api.markRead(activeId, last.id).catch(() => {});
        const link = deepLinkRef.current;
        deepLinkRef.current = null;
        if (link) {
          const root = link.thread && list.find(m => Number(m.id) === link.thread);
          if (root) openThread(root);
          const at = link.thread || link.msg;
          if (at) setTimeout(() => document.getElementById(`msg-${at}`)?.scrollIntoView({ block: 'center' }), 50);
        }
      }).catch(flashError);
    } else {
      const list = messages[activeId];
      const last = list[list.length - 1];
      if (last) api.markRead(activeId, last.id).catch(() => {});
    }
    setChannels(prev => prev.map(c => Number(c.id) === activeId ? { ...c, unread: 0, has_mention: false } : c));
  }, [activeId]); // eslint-disable-line

  const openThread = useCallback(async root => {
    const replies = await api.messages(Number(root.channel_id), { parent: root.id }).catch(() => []);
    setThread({ rootId: Number(root.id), channelId: Number(root.channel_id), root, replies });
  }, []);

  const openDm = useCallback(async userId => {
    try {
      const ch = await api.openDm(userId, activeWsRef.current);
      await loadMe();
      setActiveId(Number(ch.id));
    } catch (e) { flashError(e); }
  }, [loadMe, flashError]);

  // Start (or open) a DM with anyone in the directory. The server adds them to
  // this workspace if needed (same as a channel invite), then returns the DM.
  const pickDm = useCallback(async userId => {
    setShowNewDm(false);
    setThread(null); setSearchResults(null); setSearch('');
    await openDm(userId);
  }, [openDm]);

  const active = channels.find(c => Number(c.id) === activeId);

  const channelLabel = useCallback(c => {
    if (!c) return '';
    if (c.kind !== 'dm') return c.name;
    const other = (c.member_ids || []).map(Number).find(id => id !== Number(me?.id));
    return usersById[other]?.name || 'Direct message';
  }, [me, usersById]);

  function goHome() {
    setThread(null); setSearchResults(null); setSearch('');
    const gen = channels.find(c => c.name === 'general') || channels.find(c => c.kind !== 'dm') || channels[0];
    if (gen) setActiveId(Number(gen.id));
  }
  function goActivity() {
    setThread(null); setSearchResults(null); setSearch('');
    const hit = channels.find(c => c.has_mention) || channels.find(c => c.unread);
    if (hit) setActiveId(Number(hit.id));
    else { setError('✨ You’re all caught up'); setTimeout(() => setError(''), 3000); }
  }
  async function doSearch(q) {
    setSearch(q);
    if (q.trim().length < 2) { setSearchResults(null); return; }
    try { setSearchResults(await api.search(q, activeWsRef.current)); } catch { /* noop */ }
  }

  const activeWorkspace = workspaces.find(w => Number(w.id) === Number(activeWs));
  const wsName = activeWorkspace?.name || 'SynergyChat';

  if (!me) return <div className="boot">Loading SynergyChat…</div>;

  const publicChannels = channels.filter(c => c.kind !== 'dm');
  const f = filter.trim().toLowerCase();
  const shownChannels = f ? publicChannels.filter(c => c.name.toLowerCase().includes(f)) : publicChannels;
  const dmUsers = users.filter(u => Number(u.id) !== Number(me.id));
  const dmChannelUserIds = new Set(
    channels.filter(c => c.kind === 'dm')
      .flatMap(c => (c.member_ids || []).map(Number))
      .filter(id => id !== Number(me.id)));
  const shownDmUsers = f ? dmUsers.filter(u => u.name.toLowerCase().includes(f)) : dmUsers;

  return (
    <div className="shell">
      {/* top bar */}
      <div className="topbar">
        <div className="topbar-left" />
        <div className="topbar-search">
          <Icon name="search" size={15} />
          <input
            placeholder={`Search ${wsName}`}
            value={search}
            onChange={e => doSearch(e.target.value)}
          />
          {searchResults && (
            <div className="search-drop">
              <div className="search-drop-head">{searchResults.length} result{searchResults.length === 1 ? '' : 's'}</div>
              {searchResults.length === 0 && <div className="search-empty">No messages found</div>}
              {searchResults.map(r => (
                <div key={r.id} className="search-hit" onMouseDown={() => { setSearchResults(null); setSearch(''); setActiveId(Number(r.channel_id)); }}>
                  <div className="hit-meta">{r.kind === 'dm' ? 'Direct message' : `#${r.channel_name}`} · {usersById[r.user_id]?.name}</div>
                  <div className="hit-body">{r.body.slice(0, 110)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="topbar-right">
          <span className={connected ? 'conn ok' : 'conn'} title={connected ? 'Connected' : 'Reconnecting…'} />
        </div>
      </div>

      <div className="body">
        {/* far-left workspace switcher */}
        <nav className="ws-rail">
          {workspaces.map(w => (
            <button
              key={w.id}
              className={`ws-tile ${Number(w.id) === Number(activeWs) ? 'active' : ''}`}
              title={w.name}
              onClick={() => switchWorkspace(w.id)}
            >
              {(w.name[0] || '?').toUpperCase()}
            </button>
          ))}
          <button className="ws-tile add" title="Add a workspace" onClick={() => setShowNewWorkspace(true)}><Icon name="plus" size={18} /></button>
        </nav>

        {/* nav rail */}
        <nav className="nav-rail">
          <button className="nav-item active" onClick={goHome}><span className="nav-ic"><Icon name="home" /></span>Home</button>
          <button className="nav-item" onClick={() => {
            setThread(null); setSearchResults(null); setSearch('');
            const dms = channels.filter(c => c.kind === 'dm');
            const t = dms.find(c => c.unread) || dms[0];
            if (t) { setActiveId(Number(t.id)); }
            else { setShowNewDm(true); }
          }}><span className="nav-ic"><Icon name="dm" /></span>DMs</button>
          <button className="nav-item" onClick={goActivity}><span className="nav-ic"><Icon name="bell" /></span>Activity</button>
          <div className="nav-more-wrap">
            <button className="nav-item" onClick={() => setShowMore(s => !s)}><span className="nav-ic"><Icon name="more" /></span>More</button>
            {showMore && (
              <div className="nav-more-menu" onMouseLeave={() => setShowMore(false)}>
                <button onClick={() => { setShowMore(false); setShowNewChannel(true); }}>Create a channel</button>
                <button onClick={() => { setShowMore(false); setShowNewWorkspace(true); }}>Create a workspace</button>
                <button onClick={() => { setShowMore(false); window.open(DRIVE_BASE, '_blank', 'noopener'); }}>Open SynergyDrive</button>
                <button onClick={() => { setShowMore(false); window.open(MEET_BASE, '_blank', 'noopener'); }}>Open SynergyMeet</button>
                <button onClick={() => { setShowMore(false); setShowNewDm(true); }}>New direct message</button>
              </div>
            )}
          </div>
          <div className="nav-spacer" />
          <button className="nav-me" title={me.name}><Avatar user={me} size={30} radius={9} /><span className={`nav-me-dot ${online.has(Number(me.id)) ? 'on' : ''}`} /></button>
        </nav>

        {/* channel sidebar */}
        <aside className="sidebar">
          <div className="ws-header">
            <div className="ws-name">{wsName} <Icon name="caret" size={16} /></div>
            <button className="ws-compose" title="New message" onClick={() => setShowNewDm(true)}><Icon name="compose" size={18} /></button>
          </div>

          <div className="conv-filter">
            <input placeholder="Find a conversation" value={filter} onChange={e => setFilter(e.target.value)} />
          </div>

          <div className="rail-links">
            <div className="rail-link" role="button" tabIndex={0} title="Start a huddle in SynergyMeet"
              onClick={() => window.open(MEET_BASE, '_blank', 'noopener')}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.open(MEET_BASE, '_blank', 'noopener'); } }}>
              <span className="rail-ic"><Icon name="headphones" size={17} /></span>Huddles</div>
            <div className="rail-link" role="button" tabIndex={0} title="Your files in SynergyDrive"
              onClick={() => window.open(DRIVE_BASE, '_blank', 'noopener')}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.open(DRIVE_BASE, '_blank', 'noopener'); } }}>
              <span className="rail-ic"><Icon name="files" size={17} /></span>Files</div>
          </div>

          <div className="side-scroll">
            <div className="side-section">
              <div className="side-head">
                <span>Channels</span>
                <button className="side-add" title="Add channels" onClick={() => setShowNewChannel(true)}><Icon name="plus" size={15} /></button>
              </div>
              {shownChannels.map(c => (
                <button key={c.id}
                  className={`side-item ${Number(c.id) === activeId ? 'active' : ''} ${c.unread ? 'unread' : ''}`}
                  onClick={() => setActiveId(Number(c.id))}>
                  <span className="side-ic">{c.kind === 'private' ? <Icon name="lock" size={15} /> : <span className="hashmark">#</span>}</span>
                  <span className="side-label">{c.name}</span>
                  {c.unread > 0 && <span className={`badge ${c.has_mention ? 'mention-badge' : ''}`}>{c.unread}</span>}
                </button>
              ))}
              {(f ? browsable.filter(c => c.name.toLowerCase().includes(f)) : browsable).map(c => (
                <button key={c.id} className="side-item browse" onClick={async () => {
                  try { await api.joinChannel(c.id); await loadMe(); setActiveId(Number(c.id)); } catch (e) { flashError(e); }
                }}>
                  <span className="side-ic"><span className="hashmark">#</span></span>
                  <span className="side-label">{c.name}</span>
                  <span className="join-hint">Join</span>
                </button>
              ))}
              <button className="side-item add-row" onClick={() => setShowNewChannel(true)}>
                <span className="side-ic"><Icon name="plus" size={15} /></span>
                <span className="side-label">Add channels</span>
              </button>
            </div>

            <div className="side-section dm-anchor">
              <div className="side-head"><span>Direct messages</span>
                <button className="side-add" title="New direct message" onClick={() => setShowNewDm(true)}><Icon name="plus" size={15} /></button>
              </div>
              {shownDmUsers.map(u => {
                const dm = channels.find(c => c.kind === 'dm' && (c.member_ids || []).map(Number).includes(Number(u.id)));
                return (
                  <button key={u.id}
                    className={`side-item dm ${dm && Number(dm.id) === activeId ? 'active' : ''} ${dm?.unread ? 'unread' : ''}`}
                    onClick={() => openDm(Number(u.id))}>
                    <span className="side-ic"><Avatar user={u} size={20} radius={5} /><span className={`presence ${online.has(Number(u.id)) ? 'on' : ''}`} /></span>
                    <span className="side-label">{u.name}{Number(u.id) === Number(me.id) ? ' (you)' : ''}</span>
                    {dm?.unread > 0 && <span className="badge">{dm.unread}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* main */}
        <main className="main">
          {active ? (
            <ChannelView
              key={active.id}
              channel={active}
              label={channelLabel(active)}
              online={online}
              me={me}
              users={users}
              directory={directory}
              usersById={usersById}
              messages={messages[Number(active.id)] || []}
              setMessages={setMessages}
              typing={typing[Number(active.id)] || {}}
              onTyping={() => wsRef.current?.typing(Number(active.id))}
              onOpenThread={openThread}
              onInvite={async uid => { try { await api.invite(active.id, uid); } catch (e) { flashError(e); } }}
              flashError={flashError}
            />
          ) : <div className="empty">Select a channel to get started</div>}
        </main>

        {thread && (
          <ThreadPanel
            thread={thread}
            channel={channels.find(c => Number(c.id) === thread.channelId)}
            label={channelLabel(channels.find(c => Number(c.id) === thread.channelId))}
            me={me}
            users={users}
            usersById={usersById}
            onClose={() => setThread(null)}
            flashError={flashError}
          />
        )}
      </div>

      {showNewDm && (
        <NewDmModal
          people={directory && directory.length ? directory : users}
          existingDmUserIds={dmChannelUserIds}
          memberIds={new Set(users.map(u => Number(u.id)))}
          me={me}
          onClose={() => setShowNewDm(false)}
          onPick={pickDm}
        />
      )}
      {showNewChannel && (
        <NewChannelModal
          onClose={() => setShowNewChannel(false)}
          onCreate={async (name, topic, kind) => {
            try {
              const ch = await api.createChannel(name, topic, kind, activeWsRef.current);
              await loadMe();
              setActiveId(Number(ch.id));
              setShowNewChannel(false);
            } catch (e) { flashError(e); }
          }}
        />
      )}

      {showNewWorkspace && (
        <NewWorkspaceModal
          onClose={() => setShowNewWorkspace(false)}
          onCreate={async name => {
            try {
              const ws = await api.createWorkspace(name);
              await switchWorkspace(ws.id);
              setShowNewWorkspace(false);
            } catch (e) { flashError(e); }
          }}
        />
      )}

      {error && <div className="toast">{error}</div>}
    </div>
  );
}

// ---------- channel view ----------
function ChannelView({ channel, label, online, me, users, directory, usersById, messages, setMessages, typing, onTyping, onOpenThread, onInvite, flashError }) {
  const invitable = (directory && directory.length ? directory : users);
  const listRef = useRef(null);
  const fileRef = useRef(null);
  const [showInvite, setShowInvite] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const inviteBtnRef = useRef(null);
  const invitePopRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const chId = Number(channel.id);
  const isDm = channel.kind === 'dm';
  const dmUser = isDm ? users.find(u => (channel.member_ids || []).map(Number).includes(Number(u.id)) && Number(u.id) !== Number(me.id)) : null;

  // Start a SynergyMeet video huddle for this channel and drop a join link in.
  async function startCall() {
    const room = `chat-${chId}-${Math.random().toString(36).slice(2, 8)}`;
    const url = `${MEET_BASE}/room/${room}`;
    window.open(url, '_blank', 'noopener');
    try { await api.send(chId, `📞 started a huddle — [Join the call](${url})`); } catch (e) { flashError(e); }
  }

  // Open the channel's whiteboard; the first time, Chat posts its link here for everyone.
  async function openWhiteboard() {
    const tab = window.open('', '_blank');
    try {
      const { url } = await api.whiteboard(chId);
      if (tab) tab.location.href = url;
      else window.open(url, '_blank', 'noopener');
    } catch (e) { tab?.close(); flashError(e); }
  }

  // Upload a file to SynergyDrive, then post it as an attachment link.
  async function doUpload(file) {
    if (!file) return;
    setUploading(true);
    try {
      const f = await api.upload(file);
      const kb = f.size ? ` · ${f.size < 1024 * 1024 ? Math.max(1, Math.round(f.size / 1024)) + ' KB' : (f.size / 1048576).toFixed(1) + ' MB'}` : '';
      await api.send(chId, `📎 [${f.name}](${f.url})${kb}`);
    } catch (e) { flashError(e); }
    finally { setUploading(false); }
  }

  // Move focus into the "Add people" list when it opens; Escape closes it and
  // hands focus back to the button that opened it.
  useEffect(() => {
    if (!showInvite) return;
    invitePopRef.current?.querySelector('button')?.focus();
    const onKey = e => {
      if (e.key !== 'Escape') return;
      setShowInvite(false);
      inviteBtnRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showInvite]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, chId]);

  async function loadOlder() {
    if (!messages.length) return;
    const older = await api.messages(chId, { before: messages[0].id }).catch(() => []);
    if (older.length) setMessages(prev => ({ ...prev, [chId]: [...older, ...prev[chId]] }));
  }

  const typingNames = Object.keys(typing).map(id => usersById[id]?.name).filter(Boolean);

  return (
    <>
      <header className="chan-header">
        <div className="chan-heading">
          <button className="chan-name">
            {isDm
              ? <><span className={`presence lg ${dmUser && online.has(Number(dmUser.id)) ? 'on' : ''}`} />{label}</>
              : <><span className="chan-ic">{channel.kind === 'private' ? <Icon name="lock" size={15} /> : '#'}</span>{label}</>}
            <Icon name="caret" size={15} className="chan-caret" />
          </button>
          {channel.topic && <div className="chan-topic">{channel.topic}</div>}
        </div>
        <div className="chan-tools">
          {!isDm && SYNAPSE_URL && (
            /* Start a Synapse session against this channel. A session is a
               bounded piece of work with an outcome; when it closes, its brief
               is posted back here. Deliberately a link and not an API call --
               Synapse creates the session itself, with the person already
               signed in there, so neither app needs a credential for the
               other in this direction. */
            <a
              className="members-pill"
              href={`${SYNAPSE_URL}/?channel=${channel.id}&channelName=${encodeURIComponent(label)}`}
              target="_blank"
              rel="noreferrer"
              title="Work something out in a Synapse session; the brief comes back here"
            >
              Synapse
            </a>
          )}
          {!isDm && (
            <div className="invite-wrap">
              <button className="members-pill" title="Members" aria-expanded={showMembers}
                onClick={() => { setShowMembers(s => !s); setShowInvite(false); }}>
                <span className="member-dots">{(channel.member_ids || []).slice(0, 3).map(id => <span key={id}>{(usersById[id]?.name || '?')[0]}</span>)}</span>
                {channel.member_count}
              </button>
              {showMembers && (
                <div className="invite-pop">
                  <div className="invite-title">Members of #{label}</div>
                  {(channel.member_ids || []).map(id => usersById[id]).filter(Boolean).map(u => (
                    <div key={u.id} className="member-row">
                      <Avatar user={u} size={22} radius={5} /> {u.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <button className="tool-btn call-btn" title="Start a video huddle" onClick={startCall}><Icon name="headphones" /></button>
          <button className="tool-btn" title="Whiteboard for this conversation" aria-label="Whiteboard" onClick={openWhiteboard}><Icon name="board" /></button>
          {!isDm && (
            <div className="invite-wrap">
              <button ref={inviteBtnRef} className="tool-btn" title="Add people" aria-label="Add people"
                aria-expanded={showInvite} onClick={() => { setShowInvite(s => !s); setShowMembers(false); }}><Icon name="at" /></button>
              {showInvite && (
                <div className="invite-pop" ref={invitePopRef} role="group" aria-label={`Add people to #${label}`}>
                  <div className="invite-title">Add people to #{label}</div>
                  {invitable.filter(u => !(channel.member_ids || []).map(Number).includes(Number(u.id))).map(u => (
                    <button type="button" key={u.id} className="invite-row"
                      onClick={() => { onInvite(Number(u.id)); setShowInvite(false); inviteBtnRef.current?.focus(); }}>
                      <Avatar user={u} size={22} radius={5} /> {u.name}
                    </button>
                  ))}
                  {invitable.filter(u => !(channel.member_ids || []).map(Number).includes(Number(u.id))).length === 0 &&
                    <div className="invite-empty">Everyone's already here</div>}
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="tabs">
        <button className="tab active"><Icon name="dm" size={15} /> Messages</button>
        <button className="tab"><Icon name="files" size={15} /> Files</button>
        <button className="tab tab-add"><Icon name="plus" size={15} /></button>
      </div>

      <div className="msg-list" ref={listRef}>
        {messages.length >= 50 && <button className="load-older" onClick={loadOlder}>Load older messages</button>}
        {messages.length === 0 && (
          <div className="chan-intro">
            <div className="intro-glyph">{isDm ? <Avatar user={dmUser} size={64} /> : <span className="intro-hash">#</span>}</div>
            <h2>{isDm ? label : `#${label}`}</h2>
            <p>{isDm
              ? `This is the very beginning of your direct message history with ${label}.`
              : `This is the start of the #${label} channel. ${channel.topic || 'Share announcements and updates here.'}`}</p>
          </div>
        )}
        <MessageList messages={messages} me={me} users={users} usersById={usersById} onOpenThread={onOpenThread} flashError={flashError} />
      </div>

      <div className="composer-wrap">
        <input
          ref={fileRef}
          type="file"
          style={{ display: 'none' }}
          onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; doUpload(file); }}
        />
        <div className="typing-line">
          {uploading ? 'Uploading to Drive…' : (typingNames.length > 0 && `${typingNames.join(', ')} ${typingNames.length === 1 ? 'is' : 'are'} typing…`)}
        </div>
        <Composer
          placeholder={`Message ${isDm ? label : '#' + label}`}
          users={users}
          onTyping={onTyping}
          onAttach={() => fileRef.current?.click()}
          onStartCall={startCall}
          onSend={async body => {
            try { await api.send(chId, body); } catch (e) { flashError(e); }
          }}
        />
      </div>
    </>
  );
}

// ---------- messages ----------
function MessageList({ messages, me, users, usersById, onOpenThread, flashError, inThread = false }) {
  const [editing, setEditing] = useState(null);
  let lastDay = '', lastUser = null, lastTs = 0;

  return messages.map(m => {
    const day = fmtDay(m.created_at);
    const showDay = day !== lastDay;
    lastDay = day;
    const grouped = !showDay && lastUser === m.user_id && (new Date(m.created_at) - lastTs) < 5 * 60 * 1000;
    lastUser = m.user_id; lastTs = new Date(m.created_at).getTime();
    const u = usersById[m.user_id];
    const mine = Number(m.user_id) === Number(me.id);

    const rx = {};
    for (const r of (m.reactions || [])) {
      rx[r.emoji] = rx[r.emoji] || { count: 0, mine: false };
      rx[r.emoji].count++;
      if (Number(r.user_id) === Number(me.id)) rx[r.emoji].mine = true;
    }

    return (
      <React.Fragment key={m.id}>
        {showDay && <div className="day-divider"><span>{day}</span></div>}
        <div id={`msg-${m.id}`} className={`msg ${grouped ? 'grouped' : ''}`}>
          {!grouped ? <Avatar user={u} /> : <div className="avatar-spacer">{fmtTime(m.created_at)}</div>}
          <div className="msg-body">
            {!grouped && (
              <div className="msg-meta">
                <span className="msg-author">{u?.name || '?'}</span>
                <span className="msg-time">{fmtTime(m.created_at)}</span>
                {m.edited_at && <span className="msg-edited">(edited)</span>}
              </div>
            )}
            {editing === m.id ? (
              <EditBox
                initial={m.body}
                onCancel={() => setEditing(null)}
                onSave={async body => {
                  try { await api.edit(m.id, body); setEditing(null); } catch (e) { flashError(e); }
                }}
              />
            ) : (
              <div className="msg-text" dangerouslySetInnerHTML={{ __html: renderBody(m.body, users) }} />
            )}
            <div className="rx-row">
              {Object.entries(rx).map(([emoji, info]) => (
                <button key={emoji} className={`rx ${info.mine ? 'mine' : ''}`}
                  onClick={() => api.react(m.id, emoji).catch(flashError)}>
                  {emoji} <span className="rx-count">{info.count}</span>
                </button>
              ))}
              {Object.keys(rx).length > 0 && (
                <button className="rx add-rx" title="Add reaction" onClick={() => api.react(m.id, '👍').catch(flashError)}><Icon name="emoji" size={15} /></button>
              )}
            </div>
            {!inThread && m.reply_count > 0 && (
              <button className="thread-link" onClick={() => onOpenThread(m)}>
                <span className="thread-dot" /> {m.reply_count} {m.reply_count === 1 ? 'reply' : 'replies'}
                <span className="thread-go">View thread</span>
              </button>
            )}
          </div>
          <div className="msg-actions">
            {EMOJI.slice(0, 3).map(e => (
              <button key={e} title={`React ${e}`} onClick={() => api.react(m.id, e).catch(flashError)}>{e}</button>
            ))}
            {!inThread && <button title="Reply in thread" onClick={() => onOpenThread(m)}><Icon name="dm" size={16} /></button>}
            {mine && <button title="Edit message" onClick={() => setEditing(m.id)}>✏️</button>}
            {mine && <button title="Delete message" onClick={() => { if (confirm('Delete this message?')) api.remove(m.id).catch(flashError); }}>🗑️</button>}
          </div>
        </div>
      </React.Fragment>
    );
  });
}

function EditBox({ initial, onSave, onCancel }) {
  const [val, setVal] = useState(initial);
  return (
    <div className="editbox">
      <textarea value={val} autoFocus onChange={e => setVal(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSave(val); }
          if (e.key === 'Escape') onCancel();
        }} />
      <div className="edit-actions">
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" onClick={() => onSave(val)}>Save changes</button>
      </div>
    </div>
  );
}

// ---------- thread panel ----------
function ThreadPanel({ thread, channel, label, me, users, usersById, onClose, flashError }) {
  const all = [thread.root, ...thread.replies];
  const isDm = channel?.kind === 'dm';
  return (
    <aside className="thread-panel">
      <header className="thread-header">
        <div>
          <div className="thread-title">Thread</div>
          <div className="thread-sub">{isDm ? label : `#${label}`}</div>
        </div>
        <button className="tool-btn" onClick={onClose} title="Close"><Icon name="plus" size={18} className="x-icon" /></button>
      </header>
      <div className="msg-list thread-list">
        <MessageList messages={all} me={me} users={users} usersById={usersById} onOpenThread={() => {}} flashError={flashError} inThread />
      </div>
      <div className="composer-wrap">
        <Composer
          placeholder="Reply…"
          users={users}
          onTyping={() => {}}
          onSend={async body => {
            try { await api.send(thread.channelId, body, thread.rootId); } catch (e) { flashError(e); }
          }}
        />
      </div>
    </aside>
  );
}

// ---------- composer ----------
function Composer({ placeholder, users, onSend, onTyping, onAttach, onStartCall }) {
  const [val, setVal] = useState('');
  const [mentionQ, setMentionQ] = useState(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const taRef = useRef(null);
  const lastTyping = useRef(0);

  const candidates = mentionQ === null ? [] :
    users.filter(u => u.name.toLowerCase().startsWith(mentionQ.toLowerCase())).slice(0, 6);

  function handleChange(e) {
    const v = e.target.value;
    setVal(v);
    const m = /(^|\s)@(\w*)$/.exec(v.slice(0, e.target.selectionStart));
    setMentionQ(m ? m[2] : null);
    const now = Date.now();
    if (now - lastTyping.current > 2000) { lastTyping.current = now; onTyping(); }
  }

  function insertMention(name) {
    const el = taRef.current;
    const pos = el.selectionStart;
    const before = val.slice(0, pos).replace(/@\w*$/, '@' + name + ' ');
    setVal(before + val.slice(pos));
    setMentionQ(null);
    el.focus();
  }

  // wrap the current selection with markdown markers
  function surround(before, after = before) {
    const el = taRef.current;
    const s = el.selectionStart, e = el.selectionEnd;
    const sel = val.slice(s, e) || 'text';
    const next = val.slice(0, s) + before + sel + after + val.slice(e);
    setVal(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = s + before.length;
      el.selectionEnd = s + before.length + sel.length;
    });
  }
  function linePrefix(prefix) {
    const el = taRef.current;
    const s = el.selectionStart;
    const lineStart = val.lastIndexOf('\n', s - 1) + 1;
    const next = val.slice(0, lineStart) + prefix + val.slice(lineStart);
    setVal(next);
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = s + prefix.length; });
  }
  function insertEmoji(em) {
    const el = taRef.current;
    const s = el.selectionStart;
    setVal(val.slice(0, s) + em + val.slice(s));
    setShowEmoji(false);
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = s + em.length; });
  }

  function submit() {
    const body = val.trim();
    if (!body) return;
    setVal('');
    setMentionQ(null);
    onSend(body);
  }

  const tools = [
    { name: 'bold', title: 'Bold', fn: () => surround('**') },
    { name: 'italic', title: 'Italic', fn: () => surround('_') },
    { name: 'strike', title: 'Strikethrough', fn: () => surround('~~') },
    { sep: true },
    { name: 'link', title: 'Link', fn: () => surround('[', '](https://)') },
    { sep: true },
    { name: 'listOl', title: 'Ordered list', fn: () => linePrefix('1. ') },
    { name: 'listUl', title: 'Bulleted list', fn: () => linePrefix('- ') },
    { name: 'quote', title: 'Blockquote', fn: () => linePrefix('> ') },
    { sep: true },
    { name: 'code', title: 'Code', fn: () => surround('`') },
    { name: 'codeblock', title: 'Code block', fn: () => surround('```\n', '\n```') },
  ];

  return (
    <div className="composer">
      {candidates.length > 0 && (
        <div className="mention-pop">
          {candidates.map(u => (
            <div key={u.id} className="invite-row" onMouseDown={e => { e.preventDefault(); insertMention(u.name); }}>
              <Avatar user={u} size={20} radius={5} /> @{u.name}
            </div>
          ))}
        </div>
      )}
      {showEmoji && (
        <div className="emoji-pop">
          {['😀', '😂', '😊', '😍', '🤔', '👍', '👏', '🙌', '🔥', '🎉', '❤️', '✅', '👀', '💯', '🚀', '😅', '🙏', '😎', '🥳', '💪'].map(em => (
            <button key={em} onMouseDown={e => { e.preventDefault(); insertEmoji(em); }}>{em}</button>
          ))}
        </div>
      )}
      <div className="composer-box">
        <div className="format-bar">
          {tools.map((t, i) => t.sep
            ? <span key={i} className="fmt-sep" />
            : (
              <button key={i} className="fmt-btn" title={t.title} onMouseDown={e => { e.preventDefault(); t.fn(); }}>
                {t.name === 'strike'
                  ? <span className="fmt-strike">S</span>
                  : t.name === 'codeblock'
                    ? <span className="fmt-cb"><Icon name="code" size={16} /></span>
                    : <Icon name={t.name} size={16} />}
              </button>
            ))}
        </div>
        <textarea
          ref={taRef}
          value={val}
          placeholder={placeholder}
          onChange={handleChange}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && candidates.length === 0) { e.preventDefault(); submit(); }
            if (e.key === 'Tab' && candidates.length > 0) { e.preventDefault(); insertMention(candidates[0].name); }
          }}
        />
        <div className="composer-actions">
          <div className="ca-left">
            <button className="ca-btn" title="Attach a file (saved to Drive)" onClick={() => onAttach?.()}><Icon name="plus" size={18} /></button>
            <button className="ca-btn" title="Emoji" onMouseDown={e => { e.preventDefault(); setShowEmoji(s => !s); }}><Icon name="emoji" size={18} /></button>
            <button className="ca-btn" title="Mention someone" onMouseDown={e => { e.preventDefault(); setVal(v => v + '@'); taRef.current?.focus(); }}><Icon name="at" size={18} /></button>
            <button className="ca-btn call" title="Start a video huddle" onClick={() => onStartCall?.()}><Icon name="video" size={18} /></button>
            <button className="ca-btn" title="Record audio clip"><Icon name="mic" size={18} /></button>
          </div>
          <button className={`ca-send ${val.trim() ? 'ready' : ''}`} onClick={submit} disabled={!val.trim()} title="Send">
            <Icon name="send" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- new workspace modal ----------
function NewWorkspaceModal({ onClose, onCreate }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Create a workspace</h3>
        <p className="modal-sub">A workspace is its own space with separate channels, members, and messages. You'll start with a fresh #general — add people from any channel's “Add people”.</p>
        <label>Workspace name
          <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Acme Corp" maxLength={60}
            onKeyDown={e => { if (e.key === 'Enter' && name.trim().length >= 2 && !busy) { setBusy(true); onCreate(name.trim()); } }} />
        </label>
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={name.trim().length < 2 || busy}
            onClick={() => { setBusy(true); onCreate(name.trim()); }}>
            {busy ? 'Creating…' : 'Create workspace'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- new channel modal ----------
function NewDmModal({ people, existingDmUserIds, memberIds, me, onClose, onPick }) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const list = people
    .filter(u => Number(u.id) !== Number(me.id))
    .filter(u => !query || (u.name || '').toLowerCase().includes(query) || (u.email || '').toLowerCase().includes(query))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>New message</h3>
        <p className="modal-sub">Start a direct message with anyone in your organization. People who aren’t in this workspace yet are added when you message them.</p>
        <label>To
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search people by name or email" />
        </label>
        <div className="dm-picker">
          {list.length === 0 && <div className="dm-picker-empty">No people match “{q}”.</div>}
          {list.map(u => {
            const has = existingDmUserIds.has(Number(u.id));
            const member = memberIds.has(Number(u.id));
            const tag = has ? 'Open' : member ? 'Message' : 'Add & message';
            return (
              <button key={u.id} className="dm-picker-item" onClick={() => onPick(Number(u.id))}>
                <Avatar user={u} size={30} radius={7} />
                <span className="dm-picker-who">
                  <span className="dm-picker-name">{u.name}</span>
                  <span className="dm-picker-email">{u.email}</span>
                </span>
              <span className={`dm-picker-tag ${has ? 'open' : member ? '' : 'add'}`}>{tag}</span>
              </button>
            );
          })}
        </div>
        <div className="modal-actions"><button onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  );
}

function NewChannelModal({ onClose, onCreate }) {
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [kind, setKind] = useState('public');
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Create a channel</h3>
        <p className="modal-sub">Channels are where your team communicates. They're best organized around a topic.</p>
        <label>Name
          <div className="input-hash"><span>#</span><input autoFocus value={name} onChange={e => setName(e.target.value.replace(/\s+/g, '-').toLowerCase())} placeholder="e.g. marketing" /></div>
        </label>
        <label>Description <span className="opt">(optional)</span>
          <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="What's this channel about?" />
        </label>
        <label className="row">
          <input type="checkbox" checked={kind === 'private'} onChange={e => setKind(e.target.checked ? 'private' : 'public')} />
          <span><strong>Make private</strong><br /><span className="opt">When a channel is set to private, it can only be viewed or joined by invitation.</span></span>
        </label>
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!name.trim()} onClick={() => onCreate(name, topic, kind)}>Create</button>
        </div>
      </div>
    </div>
  );
}
