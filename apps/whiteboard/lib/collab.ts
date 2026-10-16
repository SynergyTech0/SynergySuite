/**
 * Where browsers reach the collaboration server: WHITEBOARD_COLLAB_URL, else /collab on this
 * app's own address (the gateway sends it to server/collab.mjs), else the local dev port.
 * Read at request time, so one published image works on any domain.
 */
export function collabUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.WHITEBOARD_COLLAB_URL) return env.WHITEBOARD_COLLAB_URL;
  if (env.SUITE_DOMAIN) return `wss://whiteboard.${env.SUITE_DOMAIN}/collab`;
  return `ws://localhost:${env.COLLAB_PORT || 3751}`;
}
