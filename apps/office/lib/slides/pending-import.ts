// Hands a .pptx chosen on the documents list to the slide editor it opens.
// Navigation is client-side, so module state survives the route change; the
// editor imports the file once its collab doc has synced.
const pending = new Map<string, File>();

export function setPendingImport(docId: string, file: File) {
  pending.set(docId, file);
}

export function takePendingImport(docId: string): File | undefined {
  const f = pending.get(docId);
  pending.delete(docId);
  return f;
}
