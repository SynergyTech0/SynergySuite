// Where a spreadsheet comment thread sits, stored as JSON on comment_threads.anchor.
export function cleanAnchor(a: unknown): string {
  if (!a || typeof a !== "object") return "";
  const { sheetId, ref } = a as { sheetId?: unknown; ref?: unknown };
  if (typeof sheetId !== "string" || typeof ref !== "string" || !/^[A-Z]{1,3}\d{1,7}(:[A-Z]{1,3}\d{1,7})?$/.test(ref)) return "";
  return JSON.stringify({ sheetId: sheetId.slice(0, 100), ref });
}
