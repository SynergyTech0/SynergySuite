-- hub-import: container=saauth-db service=auth
-- What run.sh reads from an older Synergy Hub's SynergyAuth database: people (with
-- bcrypt password hashes), app tiles and per-person app grants. Sessions, tokens,
-- signing keys and authenticator secrets stay behind.
SELECT json_build_object(
  'users', (SELECT coalesce(json_agg(u ORDER BY u.id), '[]') FROM (
    SELECT id, email, name, password_hash, role, disabled, mfa_enabled, mfa_required, created_ms FROM sa_users) u),
  'apps', (SELECT coalesce(json_agg(a ORDER BY a.sort, a.name), '[]') FROM (
    SELECT id, slug, name, description, url, icon, color, category, sort, open_to_all, disabled FROM sa_apps) a),
  'user_apps', (SELECT coalesce(json_agg(g), '[]') FROM (SELECT user_id, app_id FROM sa_user_apps) g)
);
