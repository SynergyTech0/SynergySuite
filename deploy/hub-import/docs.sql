-- hub-import: container=sdocs-db service=office
-- What run.sh reads from an older Synergy Hub's SynergyDocs database: every document,
-- spreadsheet and presentation (its shared editing state, base64, and a spreadsheet's saved
-- workbook), with sharing, comments and version history. Office in the suite grew out of
-- SynergyDocs and stores them the same way.
SELECT json_build_object(
  'documents', (SELECT coalesce(json_agg(d ORDER BY d.created_at), '[]') FROM (
    SELECT id, org, owner_email, kind, title, snippet, translate(encode(ydoc, 'base64'), E'\n', '') AS ydoc,
           snapshot, created_at, updated_at, scope, company_role, starred FROM documents) d),
  'doc_grants', (SELECT coalesce(json_agg(g), '[]') FROM (
    SELECT doc_id, email, role, granted_by, created_ms FROM doc_grants) g),
  'comment_threads', (SELECT coalesce(json_agg(t), '[]') FROM (
    SELECT id, doc_id, quote, resolved, created_ms FROM comment_threads) t),
  'comments', (SELECT coalesce(json_agg(c), '[]') FROM (
    SELECT id, thread_id, doc_id, author_email, author_name, body, created_ms FROM comments) c),
  'doc_versions', (SELECT coalesce(json_agg(v), '[]') FROM (
    SELECT id, doc_id, author_email, author_name, html, label, created_ms FROM doc_versions) v)
);
