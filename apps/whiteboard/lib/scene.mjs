// How a board's drawing is kept in its Yjs document. Plain JavaScript so the collaboration
// server and the web app read it the same way.
//
//   elements  Y.Map: element id -> the Excalidraw element as JSON. Deleted elements stay as
//             tombstones (isDeleted: true) so a late edit from another person can't bring them back.
//   files     Y.Map: file id -> { id, mimeType, dataURL, created } as JSON (pasted images).

export const ELEMENTS = "elements";
export const FILES = "files";

/** The largest image anyone can add to a board, as a data URL. */
export const MAX_FILE_CHARS = 4 * 1024 * 1024;

function parse(json) {
  if (typeof json !== "string") return null;
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" && typeof v.id === "string" ? v : null;
  } catch {
    return null;
  }
}

/** The elements in a Y.Map (or any iterable of JSON strings) that aren't deleted, parsed. */
export function liveElements(values) {
  const out = [];
  for (const json of values) {
    const el = parse(json);
    if (el && !el.isDeleted) out.push(el);
  }
  return out;
}

/**
 * The words on a board for search and eDiscovery, in reading order (top to bottom, then left to
 * right), and how many things are drawn on it.
 */
export function sceneSummary(values) {
  const live = liveElements(values);
  const words = live
    .filter((el) => el.type === "text" && typeof el.text === "string" && el.text.trim())
    .sort((a, b) => (Math.round(a.y / 20) - Math.round(b.y / 20)) || a.x - b.x)
    .map((el) => el.text.replace(/\s+/g, " ").trim());
  // Bound text is counted with its shape, so a sticky note is one thing.
  const count = live.filter((el) => !(el.type === "text" && el.containerId)).length;
  return { text: words.join("\n").slice(0, 200_000), count };
}
