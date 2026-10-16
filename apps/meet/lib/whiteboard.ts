/**
 * A meeting's whiteboard, in the suite's Whiteboard app. Meet checks who is in the meeting (through
 * LiveKit, so nobody can claim a room they aren't in) and asks Whiteboard, server to server, for the
 * meeting's board: everyone signed in who is in the room can then draw on it. Guests without a suite
 * account can't open boards.
 */

type Env = Record<string, string | undefined>;

/** Where Whiteboard is from this server: WHITEBOARD_INTERNAL_URL, else the compose host in production, else localhost. */
export function whiteboardUrl(env: Env = process.env): string {
  const u = env.WHITEBOARD_INTERNAL_URL || (env.NODE_ENV === "production" ? "http://whiteboard:3750" : "http://localhost:3750");
  return u.replace(/\/+$/, "");
}

/** The signed-in people among a room's participants (guests' identities start with "guest:"). */
export function staffIn(participants: { identity: string }[]): string[] {
  return [...new Set(participants.map((p) => p.identity).filter((id) => !id.startsWith("guest:") && id.includes("@")))];
}

export class WhiteboardError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

/** The board for `room`, made the first time anyone asks; `people` can all edit it. */
export async function meetingBoard(
  room: string,
  owner: string,
  people: string[],
  opts: { env?: Env; fetch?: typeof fetch } = {},
): Promise<{ id: string; url: string; created: boolean }> {
  const env = opts.env ?? process.env;
  const f = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(`${whiteboardUrl(env)}/api/svc/boards`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(env.PROXY_SHARED_SECRET ? { "x-proxy-auth-secret": env.PROXY_SHARED_SECRET } : {}) },
      body: JSON.stringify({ source: `meet:${room}`, title: `Meeting whiteboard: ${room}`, owner, people }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new WhiteboardError("Couldn't reach Whiteboard");
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string; url?: string; created?: boolean; error?: string };
  if (!res.ok || !data.url || !data.id) throw new WhiteboardError(data.error || `Whiteboard answered ${res.status}`);
  return { id: data.id, url: data.url, created: !!data.created };
}
