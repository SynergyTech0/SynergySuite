import { createDb } from "@synergy/db";

/**
 * Phone keeps who has which number, the SIP trunks those numbers arrive on, every call and who it
 * rang, and voicemail. The media itself never touches this database: calls run in the suite's
 * LiveKit server, and only voicemail recordings are stored here.
 */
const SCHEMA = `
-- A SIP trunk: a phone company (Telnyx, Twilio, Voip.ms…) or the office PBX (Asterisk,
-- FreeSWITCH, 3CX…). Calls to its numbers come in through it; calls out leave through it.
CREATE TABLE IF NOT EXISTS trunks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  kind               TEXT NOT NULL DEFAULT 'provider' CHECK (kind IN ('provider', 'pbx')),
  -- Where calls out are sent, e.g. sip.telnyx.com or pbx.office.lan:5060.
  address            TEXT NOT NULL DEFAULT '',
  transport          TEXT NOT NULL DEFAULT 'udp' CHECK (transport IN ('udp', 'tcp', 'tls')),
  username           TEXT NOT NULL DEFAULT '',
  password           TEXT NOT NULL DEFAULT '',
  -- Calls in are only taken from these addresses (empty: any), or with this login.
  inbound_addresses  TEXT[] NOT NULL DEFAULT '{}',
  inbound_username   TEXT NOT NULL DEFAULT '',
  inbound_password   TEXT NOT NULL DEFAULT '',
  -- What LiveKit calls the pieces made for this trunk.
  lk_inbound_id      TEXT,
  lk_outbound_id     TEXT,
  lk_dispatch_id     TEXT,
  synced_at          TIMESTAMPTZ,
  sync_error         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Numbers in E.164 (+15551234567). One person each; unassigned numbers don't take calls.
CREATE TABLE IF NOT EXISTS numbers (
  number      TEXT PRIMARY KEY,
  trunk_id    UUID NOT NULL REFERENCES trunks(id) ON DELETE CASCADE,
  assigned_to TEXT,
  label       TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS numbers_assigned_uniq ON numbers (assigned_to) WHERE assigned_to IS NOT NULL;

-- Everyone who has opened Phone, so people can find each other by name.
CREATE TABLE IF NOT EXISTS people (
  email     TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  email             TEXT PRIMARY KEY,
  dnd               BOOLEAN NOT NULL DEFAULT false,
  -- Send every call to someone else: an email (a colleague) or a phone number.
  forward_to        TEXT,
  -- Ring this phone number as well, e.g. a mobile; whichever answers first gets the call.
  also_ring         TEXT,
  voicemail         BOOLEAN NOT NULL DEFAULT true,
  ring_seconds      INTEGER NOT NULL DEFAULT 20 CHECK (ring_seconds BETWEEN 5 AND 60),
  greeting_text     TEXT NOT NULL DEFAULT '',
  -- A recorded greeting: 16-bit mono WAV.
  greeting_audio    BYTEA,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per call, in the LiveKit room of the same name. A phone number called into a Meet
-- meeting is a call of its own (meeting_leg) in that meeting's room.
CREATE TABLE IF NOT EXISTS calls (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room         TEXT NOT NULL,
  direction    TEXT NOT NULL CHECK (direction IN ('internal', 'inbound', 'outbound')),
  -- Who started it: a person (email) or, for calls from outside, a phone number.
  from_email   TEXT,
  from_number  TEXT,
  from_name    TEXT NOT NULL DEFAULT '',
  -- Who it was for: a person, a number (calls out), or both (a call to someone's number).
  to_email     TEXT,
  to_number    TEXT,
  state        TEXT NOT NULL DEFAULT 'ringing'
               CHECK (state IN ('ringing', 'active', 'voicemail', 'ended', 'missed', 'declined', 'failed')),
  -- When nobody has answered by then, the call goes to voicemail (or is missed).
  ring_deadline TIMESTAMPTZ,
  answered_by  TEXT,
  answered_at  TIMESTAMPTZ,
  ended_at     TIMESTAMPTZ,
  end_reason   TEXT,
  -- The voicemail worker is in the room (ringback, then the greeting and recording).
  agent_at     TIMESTAMPTZ,
  -- Opened as a meeting in Meet.
  meeting      BOOLEAN NOT NULL DEFAULT false,
  meeting_leg  BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  held_deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS calls_room_idx ON calls (room, created_at DESC);
CREATE INDEX IF NOT EXISTS calls_state_idx ON calls (state, ring_deadline) WHERE state IN ('ringing', 'voicemail', 'active');
CREATE INDEX IF NOT EXISTS calls_from_idx ON calls (from_email, created_at DESC);
CREATE INDEX IF NOT EXISTS calls_to_idx ON calls (to_email, created_at DESC);

-- Everyone a call reached or tried to: the person it was for, a forward, a transfer, someone
-- added. A party is a person (email) or a phone number; identity is who they are in the room.
CREATE TABLE IF NOT EXISTS parties (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id    UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  email      TEXT,
  number     TEXT,
  identity   TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('caller', 'callee', 'added')),
  state      TEXT NOT NULL DEFAULT 'ringing' CHECK (state IN ('ringing', 'joined', 'left', 'declined', 'missed', 'failed')),
  invited_by TEXT,
  joined_at  TIMESTAMPTZ,
  left_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (call_id, identity)
);
CREATE INDEX IF NOT EXISTS parties_email_idx ON parties (email, created_at DESC) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS parties_ringing_idx ON parties (email) WHERE state = 'ringing';

CREATE TABLE IF NOT EXISTS voicemails (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id     UUID REFERENCES calls(id) ON DELETE SET NULL,
  owner       TEXT NOT NULL,
  from_email  TEXT,
  from_number TEXT,
  from_name   TEXT NOT NULL DEFAULT '',
  -- 16-bit mono WAV.
  audio       BYTEA NOT NULL,
  duration_ms INTEGER NOT NULL,
  transcript  TEXT,
  transcript_error TEXT,
  heard_at    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  held_deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS voicemails_owner_idx ON voicemails (owner, created_at DESC);

-- Calls a person removed from their own history. The call itself stays for everyone else.
CREATE TABLE IF NOT EXISTS hidden_calls (
  email     TEXT NOT NULL,
  call_id   UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  hidden_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (email, call_id)
);
`;

type Db = ReturnType<typeof createDb>;
const g = globalThis as unknown as { __phoneDb?: Db; __phoneReady?: Promise<void> };

export function db(): Db {
  if (!g.__phoneDb) g.__phoneDb = createDb({ devUrl: "postgres://postgres@127.0.0.1:5499/phone", max: 10 });
  return g.__phoneDb;
}

export function ready(): Promise<void> {
  if (!g.__phoneReady) {
    g.__phoneReady = db().migrate(SCHEMA, "phone").catch((e) => {
      g.__phoneReady = undefined; // let the next request retry instead of failing forever
      throw e;
    });
  }
  return g.__phoneReady;
}

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  await ready();
  return (await db().q(text, params)).rows as T[];
}

/** Runs `fn` in one transaction; `tq` queries inside it. */
export async function tx<T>(fn: (tq: <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>) => Promise<T>): Promise<T> {
  await ready();
  const client = await db().pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(async (text, params = []) => (await client.query(text, params as unknown[])).rows);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
