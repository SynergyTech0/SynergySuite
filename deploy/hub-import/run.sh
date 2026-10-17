#!/usr/bin/env bash
# Copy data from an older Synergy Hub install into this suite, one part at a time.
#
#   deploy/hub-import/run.sh <part> user@server [--dry-run] [importer options]
#
# Each part reads one old database over your own SSH access with <part>.sql and pipes
# the result straight into that suite app's importer (scripts/import-hub.mjs), so
# nothing (password hashes included) is written to disk on the way. Run it from the
# repository root after quickstart.sh.
#
# Each <part>.sql starts with a line naming the old database container and the suite
# service whose importer reads it, e.g. `-- hub-import: container=saauth-db service=auth`,
# plus script=<path> when the importer isn't scripts/import-hub.mjs in that container.
# Set HUB_DB_CONTAINER if your old container has another name. Parts: ls deploy/hub-import/*.sql
set -euo pipefail

die() { echo "hub-import: $*" >&2; exit 1; }
[ $# -ge 2 ] || die "usage: $0 <part> user@server [--dry-run] [options]"
part=$1 target=$2; shift 2
here=$(cd "$(dirname "$0")" && pwd)
ENV_FILE=${ENV_FILE:-deploy/.env}
[ -f "$ENV_FILE" ] || die "$ENV_FILE not found. Run deploy/quickstart.sh first."

sql=$here/$part.sql
[ -f "$sql" ] || die "unknown part '$part' (no $sql)"
header=$(head -n 1 "$sql")
container=$(sed -n 's/.*container=\([^ ]*\).*/\1/p' <<<"$header")
service=$(sed -n 's/.*service=\([^ ]*\).*/\1/p' <<<"$header")
[ -n "$container" ] && [ -n "$service" ] || die "$sql must start with: -- hub-import: container=<name> service=<name>"
script=$(sed -n 's/.*script=\([^ ]*\).*/\1/p' <<<"$header")
container=${HUB_DB_CONTAINER:-$container}

ssh "$target" "docker exec -i $container sh -c 'psql -X -q -At -v ON_ERROR_STOP=1 -U \"\${POSTGRES_USER:-postgres}\" -d \"\${POSTGRES_DB:-\${POSTGRES_USER:-postgres}}\"'" < "$sql" \
  | docker compose -f deploy/compose.yml --env-file "$ENV_FILE" exec -T "$service" node "${script:-scripts/import-hub.mjs}" "$@"
