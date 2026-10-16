/**
 * Where browsers reach the collaboration server. Read at run time, so one published image works
 * on any domain: LOOP_COLLAB_URL, else wss://loop.<SUITE_DOMAIN>/collab, else the local server.
 */
export function collabUrl(): string {
  if (process.env.LOOP_COLLAB_URL) return process.env.LOOP_COLLAB_URL;
  if (process.env.SUITE_DOMAIN) return `wss://loop.${process.env.SUITE_DOMAIN}/collab`;
  return `ws://localhost:${process.env.COLLAB_PORT || 3771}`;
}
