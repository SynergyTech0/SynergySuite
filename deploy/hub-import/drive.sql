-- hub-import: container=sdrive-postgres service=drive
-- What run.sh reads from an older Synergy Hub's SynergyDrive database: folders, files and every
-- kept version. People appear only as the ids the hub derived from their email (see
-- apps/drive/scripts/import-hub.mjs). The contents are in the hub's object storage;
-- drive.files.sh sends them.
SELECT json_build_object(
  'folders', (SELECT coalesce(json_agg(f ORDER BY f.created_at), '[]') FROM (
    SELECT id, parent_folder_id, shared_drive_id, name, owner_id, created_at, updated_at, deleted_at FROM folders) f),
  'files', (SELECT coalesce(json_agg(f ORDER BY f.created_at), '[]') FROM (
    SELECT id, parent_folder_id, shared_drive_id, name, mimetype, owner_id, created_at, updated_at, deleted_at FROM files) f),
  'versions', (SELECT coalesce(json_agg(v ORDER BY v.file_id, v.version_number), '[]') FROM (
    SELECT file_id, version_number, storage_path, uploaded_by, size_bytes, sha256_hash, created_at, deleted_at FROM file_versions) v)
);
