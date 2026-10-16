#!/bin/sh
# Fills ${VARS} in plan.template.ndjson from the environment and writes the plan stalwart-cli applies.
# Secrets must not contain double quotes or backslashes (use openssl rand -hex 24).
set -eu
for v in MAIL_DOMAIN MAIL_HOSTNAME STALWART_ADMIN_PASSWORD MAIL_MASTER_PASSWORD; do
  eval "val=\${$v:-}"
  [ -n "$val" ] || { echo "render.sh: $v is not set" >&2; exit 1; }
  case "$val" in *\"*|*\\*) echo "render.sh: $v must not contain \" or \\" >&2; exit 1 ;; esac
done
umask 077
awk '{
  sub(/\r$/, "")
  while (match($0, /\$\{[A-Z_]+\}/)) {
    name = substr($0, RSTART + 2, RLENGTH - 3)
    $0 = substr($0, 1, RSTART - 1) ENVIRON[name] substr($0, RSTART + RLENGTH)
  }
  print
}' /stalwart/plan.template.ndjson > /plan/plan.ndjson
# Demo mode: refuse relaying to outside domains and route every queued message to local delivery,
# so no mail leaves the server. Turning demo mode off does not undo this (see deploy/README.md).
if [ "${DEMO_MODE:-}" = 1 ]; then
  tr -d '\r' < /stalwart/plan.demo.ndjson >> /plan/plan.ndjson
  echo "render.sh: demo mode, outbound mail disabled"
fi
chown 65532 /plan/plan.ndjson  # stalwart-cli runs as 65532
echo "render.sh: plan written"
