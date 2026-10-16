// WebSocket hub: tracks online users, broadcasts events to channel members.
const db = require('./db');

const clients = new Map(); // userId -> Set<ws>

function onlineIds() {
  return [...clients.keys()];
}

function sendTo(userId, event) {
  const set = clients.get(userId);
  if (!set) return;
  const payload = JSON.stringify(event);
  for (const ws of set) {
    if (ws.readyState === 1) ws.send(payload);
  }
}

function broadcastAll(event) {
  for (const id of clients.keys()) sendTo(id, event);
}

async function broadcastChannel(channelId, event, exceptUserId) {
  const ids = await db.memberIds(channelId);
  for (const id of ids) {
    if (id === exceptUserId) continue;
    sendTo(id, event);
  }
}

function addClient(ws, user) {
  const id = Number(user.id);
  let set = clients.get(id);
  const firstConn = !set;
  if (!set) { set = new Set(); clients.set(id, set); }
  set.add(ws);

  ws.send(JSON.stringify({ type: 'hello', userId: id, online: onlineIds() }));
  if (firstConn) broadcastAll({ type: 'presence', userId: id, online: true });

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'typing' && msg.channelId) {
      if (await db.isMember(msg.channelId, id)) {
        broadcastChannel(Number(msg.channelId), {
          type: 'typing', channelId: Number(msg.channelId), userId: id,
        }, id);
      }
    } else if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  });

  ws.on('close', () => {
    set.delete(ws);
    if (set.size === 0) {
      clients.delete(id);
      broadcastAll({ type: 'presence', userId: id, online: false });
    }
  });
}

module.exports = { addClient, sendTo, broadcastChannel, broadcastAll, onlineIds };
