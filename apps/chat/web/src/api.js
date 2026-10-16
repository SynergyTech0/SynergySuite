// Dev-only per-tab impersonation: /?as=email adds an x-dev-user header to every
// request (the server ignores it unless DEV_USER_EMAIL is set).
const DEV_AS = new URLSearchParams(location.search).get('as');

async function req(method, url, body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (DEV_AS) headers['x-dev-user'] = DEV_AS;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  me: ws => req('GET', '/api/me' + (ws ? `?ws=${ws}` : '')),
  createWorkspace: name => req('POST', '/api/workspaces', { name }),
  createChannel: (name, topic, kind, workspaceId) => req('POST', '/api/channels', { name, topic, kind, workspaceId }),
  joinChannel: id => req('POST', `/api/channels/${id}/join`),
  invite: (id, userId) => req('POST', `/api/channels/${id}/invite`, { userId }),
  leaveChannel: id => req('POST', `/api/channels/${id}/leave`),
  openDm: (userId, workspaceId) => req('POST', '/api/dms', { userId, workspaceId }),
  messages: (id, opts = {}) => {
    const p = new URLSearchParams();
    if (opts.before) p.set('before', opts.before);
    if (opts.parent) p.set('parent', opts.parent);
    return req('GET', `/api/channels/${id}/messages?${p}`);
  },
  send: (id, body, parentId) => req('POST', `/api/channels/${id}/messages`, { body, parentId }),
  edit: (id, body) => req('PATCH', `/api/messages/${id}`, { body }),
  remove: id => req('DELETE', `/api/messages/${id}`),
  react: (id, emoji) => req('POST', `/api/messages/${id}/reactions`, { emoji }),
  whiteboard: id => req('POST', `/api/channels/${id}/whiteboard`),
  markRead: (id, lastMessageId) => req('POST', `/api/channels/${id}/read`, { lastMessageId }),
  search: (q, ws) => req('GET', `/api/search?q=${encodeURIComponent(q)}${ws ? `&ws=${ws}` : ''}`),
  // Upload an attachment; the server stores it in SynergyDrive and returns
  // { id, name, size, url }. Uses FormData so the browser sets the multipart
  // boundary — do NOT set Content-Type by hand here.
  upload: async file => {
    const fd = new FormData();
    fd.append('file', file);
    const headers = {};
    if (DEV_AS) headers['x-dev-user'] = DEV_AS;
    const res = await fetch('/api/upload', { method: 'POST', headers, body: fd, credentials: 'same-origin' });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    return res.json();
  },
};

export function connectWs(onEvent, onStatus) {
  let ws = null;
  let closed = false;
  let retry = 500;

  function open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws${location.search}`);
    ws.onopen = () => { retry = 500; onStatus?.(true); };
    ws.onmessage = e => {
      try { onEvent(JSON.parse(e.data)); } catch {}
    };
    ws.onclose = () => {
      onStatus?.(false);
      if (!closed) setTimeout(open, retry = Math.min(retry * 2, 8000));
    };
    ws.onerror = () => ws.close();
  }
  open();

  const ping = setInterval(() => {
    if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'ping' }));
  }, 25000);

  return {
    typing: channelId => {
      if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'typing', channelId }));
    },
    close: () => { closed = true; clearInterval(ping); ws?.close(); },
  };
}
