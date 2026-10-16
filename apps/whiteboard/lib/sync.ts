/**
 * The browser side of live collaboration, kept free of Excalidraw and Yjs so it can be tested on
 * its own: which local changes to send, how other people's presence becomes cursors on the
 * canvas, and where the middle of the screen is.
 */

export type Versioned = { id: string; version: number };

/**
 * Elements whose version differs from the one last written to or read from the shared document.
 * Excalidraw bumps an element's version on every change, deletion included.
 */
export function changedSince<T extends Versioned>(elements: readonly T[], known: Map<string, number>): T[] {
  return elements.filter((e) => known.get(e.id) !== e.version);
}

/** What each person shares through Yjs awareness. */
export type Presence = {
  user?: { name?: string; email?: string; color?: { background: string; stroke: string } };
  pointer?: { x: number; y: number; tool: "pointer" | "laser" };
  button?: "up" | "down";
  selected?: Record<string, true>;
};

export type Peer = {
  id: string;
  username: string;
  email: string;
  color: { background: string; stroke: string };
  pointer?: Presence["pointer"];
  button?: "up" | "down";
  selectedElementIds?: Record<string, true>;
};

/** Everyone else connected to the board (one entry per browser tab), for Excalidraw's collaborators. */
export function peersFrom(states: Map<number, Presence>, selfId: number): Peer[] {
  const out: Peer[] = [];
  for (const [id, s] of states) {
    if (id === selfId || !s?.user?.email) continue;
    out.push({
      id: String(id),
      username: s.user.name || s.user.email,
      email: s.user.email,
      color: s.user.color ?? { background: "#1971c233", stroke: "#1971c2" },
      ...(s.pointer && Number.isFinite(s.pointer.x) && Number.isFinite(s.pointer.y) ? { pointer: s.pointer } : {}),
      ...(s.button ? { button: s.button } : {}),
      ...(s.selected ? { selectedElementIds: s.selected } : {}),
    });
  }
  return out;
}

/** The people on a board right now, once each, for the faces in the header. */
export function uniquePeople(peers: Peer[]): { email: string; name: string; color: string }[] {
  const seen = new Map<string, { email: string; name: string; color: string }>();
  for (const p of peers) if (!seen.has(p.email)) seen.set(p.email, { email: p.email, name: p.username, color: p.color.stroke });
  return [...seen.values()];
}

export type View = { scrollX: number; scrollY: number; zoom: { value: number }; width: number; height: number };

/** The scene point in the middle of what the person is looking at. */
export function viewportCenter(v: View): { x: number; y: number } {
  const z = v.zoom.value || 1;
  return { x: -v.scrollX + v.width / 2 / z, y: -v.scrollY + v.height / 2 / z };
}

/** Moves skeletons so their bounding box is centred on (cx, cy). Arrows bound to shapes keep x/y 0 and are left alone. */
export function centreOn<T extends { x?: unknown; y?: unknown; width?: unknown; height?: unknown; type: string; start?: unknown }>(items: T[], cx: number, cy: number): T[] {
  const boxes = items.filter((i) => !(i.type === "arrow" && i.start)).map((i) => ({
    x: Number(i.x) || 0, y: Number(i.y) || 0, w: Number(i.width) || 0, h: Number(i.height) || 40,
  }));
  if (!boxes.length) return items;
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));
  const dx = Math.round(cx - (minX + maxX) / 2);
  const dy = Math.round(cy - (minY + maxY) / 2);
  return items.map((i) => (i.type === "arrow" && i.start ? i : { ...i, x: (Number(i.x) || 0) + dx, y: (Number(i.y) || 0) + dy }));
}

/**
 * Where a new sticky note goes: (x, y), or moved down and right in steps until it no longer sits
 * exactly on another note, so two people adding notes at once can both see theirs.
 */
export function freeSpot(x: number, y: number, taken: { x: number; y: number }[], step = 30): { x: number; y: number } {
  let at = { x, y };
  for (let i = 0; i < 50 && taken.some((t) => Math.abs(t.x - at.x) < step / 2 && Math.abs(t.y - at.y) < step / 2); i++) {
    at = { x: at.x + step, y: at.y + step };
  }
  return at;
}
