// A channel's whiteboard, in the suite's Whiteboard app. Chat knows who is in the channel, so it
// asks Whiteboard (server to server, with PROXY_SHARED_SECRET) for the channel's board and lists
// the members, who can then all draw on it. Asking again later brings in people who joined since.

function whiteboardUrl(env = process.env) {
  const u = env.WHITEBOARD_INTERNAL_URL || (env.NODE_ENV === 'production' ? 'http://whiteboard:3750' : 'http://localhost:3750');
  return u.replace(/\/+$/, '');
}

function boardTitle(channel) {
  if (channel.kind === 'dm') return 'Chat whiteboard';
  return `#${channel.name} whiteboard`;
}

async function channelBoard(channel, owner, people, { env = process.env, fetch: f = fetch } = {}) {
  let res;
  try {
    res = await f(`${whiteboardUrl(env)}/api/svc/boards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(env.PROXY_SHARED_SECRET ? { 'x-proxy-auth-secret': env.PROXY_SHARED_SECRET } : {}) },
      body: JSON.stringify({ source: `chat:${channel.id}`, title: boardTitle(channel), owner, people }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw Object.assign(new Error('Could not reach Whiteboard'), { status: 502 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) throw Object.assign(new Error(data.error || `Whiteboard answered ${res.status}`), { status: 502 });
  return { id: data.id, url: data.url, created: !!data.created };
}

module.exports = { channelBoard, whiteboardUrl, boardTitle };
