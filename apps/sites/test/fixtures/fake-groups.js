// Preloaded into the server under test (node --require) in place of @synergy/groups: groups come
// from the JSON file at FAKE_GROUPS_FILE, { "<id>": { name, kind, owners: [], members: [] } },
// read on every call so a test can change them while the server runs.
const fs = require('node:fs');
const Module = require('node:module');

const read = () => JSON.parse(fs.readFileSync(process.env.FAKE_GROUPS_FILE, 'utf8'));
const fake = {
  async groupsOf(email) {
    if (process.env.FAKE_GROUPS_DOWN && fs.existsSync(process.env.FAKE_GROUPS_DOWN)) throw new Error('groups down');
    return Object.entries(read())
      .filter(([, g]) => g.owners.includes(email) || g.members.includes(email))
      .map(([id, g]) => ({ id, name: g.name, kind: g.kind, role: g.owners.includes(email) ? 'owner' : 'member' }));
  },
  async groupMembers(id) {
    if (process.env.FAKE_GROUPS_DOWN && fs.existsSync(process.env.FAKE_GROUPS_DOWN)) throw new Error('groups down');
    const g = read()[id];
    if (!g) throw new Error('no such group');
    return { owners: g.owners.map(email => ({ email })), members: g.members.map(email => ({ email })) };
  },
  async addResource(id, resource) {
    const f = process.env.FAKE_GROUPS_FILE + '.resources';
    const all = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
    all.push({ id, ...resource });
    fs.writeFileSync(f, JSON.stringify(all));
  },
};

const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === '@synergy/groups') return fake;
  return load.call(this, request, ...rest);
};
