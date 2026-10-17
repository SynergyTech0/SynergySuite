-- hub-import: container=sboards-db service=planner
-- What run.sh reads from an older Synergy Hub's SynergyBoards database. Planner grew out of
-- SynergyBoards and keeps its tables, so each table comes across whole, row for row. People come
-- by email only (their old sign-in subjects mean nothing here). Pending invites (their tokens) and
-- notifications stay behind.
SELECT json_build_object(
  'users', (SELECT coalesce(json_agg(u ORDER BY u.created_at), '[]') FROM (
    SELECT id, email, name, avatar_url, is_mind, created_at FROM users) u),
  'workspaces', (SELECT coalesce(json_agg(t), '[]') FROM workspaces t),
  'workspace_members', (SELECT coalesce(json_agg(t), '[]') FROM workspace_members t),
  'boards', (SELECT coalesce(json_agg(t), '[]') FROM boards t),
  'board_members', (SELECT coalesce(json_agg(t), '[]') FROM board_members t),
  'board_stars', (SELECT coalesce(json_agg(t), '[]') FROM board_stars t),
  'sprints', (SELECT coalesce(json_agg(t), '[]') FROM sprints t),
  'sprint_reports', (SELECT coalesce(json_agg(t), '[]') FROM sprint_reports t),
  'lists', (SELECT coalesce(json_agg(t ORDER BY t.position), '[]') FROM lists t),
  'labels', (SELECT coalesce(json_agg(t), '[]') FROM labels t),
  'components', (SELECT coalesce(json_agg(t), '[]') FROM components t),
  'versions', (SELECT coalesce(json_agg(t), '[]') FROM versions t),
  'custom_fields', (SELECT coalesce(json_agg(t), '[]') FROM custom_fields t),
  'cards', (SELECT coalesce(json_agg(t ORDER BY t.created_at), '[]') FROM cards t),
  'card_labels', (SELECT coalesce(json_agg(t), '[]') FROM card_labels t),
  'card_members', (SELECT coalesce(json_agg(t), '[]') FROM card_members t),
  'card_watchers', (SELECT coalesce(json_agg(t), '[]') FROM card_watchers t),
  'card_components', (SELECT coalesce(json_agg(t), '[]') FROM card_components t),
  'card_fix_versions', (SELECT coalesce(json_agg(t), '[]') FROM card_fix_versions t),
  'card_field_values', (SELECT coalesce(json_agg(t), '[]') FROM card_field_values t),
  'issue_links', (SELECT coalesce(json_agg(t), '[]') FROM issue_links t),
  'checklists', (SELECT coalesce(json_agg(t), '[]') FROM checklists t),
  'checklist_items', (SELECT coalesce(json_agg(t), '[]') FROM checklist_items t),
  'comments', (SELECT coalesce(json_agg(t ORDER BY t.created_at), '[]') FROM comments t),
  'attachments', (SELECT coalesce(json_agg(t), '[]') FROM attachments t),
  'work_logs', (SELECT coalesce(json_agg(t), '[]') FROM work_logs t),
  'activities', (SELECT coalesce(json_agg(t ORDER BY t.created_at), '[]') FROM activities t),
  'automations', (SELECT coalesce(json_agg(t), '[]') FROM automations t),
  'saved_filters', (SELECT coalesce(json_agg(t), '[]') FROM saved_filters t)
);
