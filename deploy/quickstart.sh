#!/usr/bin/env bash
# Run Synergy Suite on this machine with one command:
#
#   deploy/quickstart.sh              # the whole suite
#   deploy/quickstart.sh calendar     # just the sign-in pieces plus the apps you name
#
# The first run writes deploy/.env (random secrets, an admin account, the domain
# suite.lvh.me, Caddy's local CA instead of Let's Encrypt). Later runs keep that file as it is.
# Set SUITE_DOMAIN before the first run to use another domain that resolves to 127.0.0.1.
# See "Try it on your machine" in deploy/README.md.
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=deploy/.env
COMPOSE=(docker compose -f deploy/compose.yml --env-file "$ENV_FILE")
# Always started, whatever apps are named: the database, sign-in and the gateway.
CORE=(postgres auth auth-init oauth2-proxy caddy demo)

say() { printf '%s\n' "$*"; }
die() { printf 'quickstart: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "Docker is not installed (https://docs.docker.com/get-docker/)."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required ('docker compose')."
docker info >/dev/null 2>&1 || die "Docker is not running, or this user cannot reach it."
command -v openssl >/dev/null || die "openssl is required to generate secrets."

hex() { openssl rand -hex "$1"; }

# Set KEY=value in the env file, replacing the line from .env.example (values are hex/base64/
# plain words, so they need no quoting).
setvar() {
  local key=$1 value=$2 tmp
  tmp=$(mktemp)
  if grep -q "^${key}=" "$ENV_FILE"; then
    awk -v k="$key" -v v="$value" 'BEGIN { FS = OFS = "=" } $1 == k { print k "=" v; next } { print }' "$ENV_FILE" > "$tmp"
  else
    cat "$ENV_FILE" > "$tmp"
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

getvar() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 | tr -d '\r'; }

if [ -f "$ENV_FILE" ]; then
  say "Using the existing $ENV_FILE (delete it to start over with new secrets)."
else
  domain=${SUITE_DOMAIN:-suite.lvh.me}
  say "Writing $ENV_FILE for https://*.$domain ..."
  tr -d '\r' < deploy/.env.example > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  setvar SUITE_DOMAIN "$domain"
  setvar POSTGRES_PASSWORD "$(hex 24)"
  setvar SA_ENCRYPTION_KEY "$(hex 32)"
  setvar OIDC_CLIENT_ID suite-gateway
  setvar OIDC_CLIENT_SECRET "$(hex 32)"
  setvar OAUTH2_COOKIE_SECRET "$(hex 16)"
  setvar PROXY_SHARED_SECRET "$(hex 32)"
  setvar CAL_SVC_TOKEN "$(hex 32)"
  setvar SEED_ADMIN_EMAIL "admin@$domain"
  setvar SEED_ADMIN_PASSWORD "Suite-$(hex 8)"
  # Local mode: certificates from Caddy's own CA, and every port bound to this machine only.
  setvar CADDY_GLOBAL_OPTIONS local_certs
  setvar HTTP_PUBLISH 127.0.0.1:80
  setvar HTTPS_PUBLISH 127.0.0.1:443
  setvar MAIL_ENCRYPTION_KEY "$(openssl rand -base64 32)"
  setvar BOOKS_ENCRYPTION_KEY "$(hex 32)"
  setvar INSIGHTS_SECRET "$(hex 32)"
  setvar STALWART_ADMIN_PASSWORD "$(hex 24)"
  setvar MAIL_MASTER_PASSWORD "$(hex 24)"
  # Out of the way of a local mail server; nothing outside this machine can reach them.
  setvar MAIL_SMTP_PUBLISH 127.0.0.1:2525
  setvar MAIL_SUBMISSION_PUBLISH 127.0.0.1:4465
  setvar MAIL_IMAPS_PUBLISH 127.0.0.1:4993
  setvar MAIL_ADMIN_PUBLISH 18080
  # DEMO_MODE=1 deploy/quickstart.sh: a demo instance with sample content (see deploy/README.md).
  if [ "${DEMO_MODE:-}" = 1 ]; then setvar DEMO_MODE 1; fi
fi

# Settings added since an existing .env was written.
if [ -z "$(getvar INSIGHTS_SECRET)" ]; then setvar INSIGHTS_SECRET "$(hex 32)"; fi

domain=$(getvar SUITE_DOMAIN)
[ -n "$domain" ] || die "SUITE_DOMAIN is empty in $ENV_FILE."
https_publish=$(getvar HTTPS_PUBLISH)
https_port=${https_publish##*:}
https_port=${https_port:-443}

# The browser must reach auth.<domain>, sso.<domain> and the apps at this machine. The
# containers don't need this: they talk to each other on the compose network.
resolve() {
  if command -v getent >/dev/null; then getent hosts "$1" | awk '{ print $1; exit }'
  elif command -v python3 >/dev/null; then python3 -c 'import socket,sys; print(socket.gethostbyname(sys.argv[1]))' "$1" 2>/dev/null
  elif command -v dscacheutil >/dev/null; then dscacheutil -q host -a name "$1" | awk '/ip_address/ { print $2; exit }'
  fi
}
addr=$(resolve "auth.$domain" || true)
if [ "$addr" != "127.0.0.1" ]; then
  say ""
  say "Warning: auth.$domain does not resolve to 127.0.0.1 here (got '${addr:-nothing}')."
  say "Some routers block DNS answers that point at 127.0.0.1. Add this line to /etc/hosts"
  say "(C:\\Windows\\System32\\drivers\\etc\\hosts on Windows) and run this again if sign-in fails:"
  say ""
  hosts="127.0.0.1"
  for h in auth sso admin base books builder calendar chat contacts crm desk drive engage forms insights mail meet notes office people planner portal search sites todo trust; do hosts="$hosts $h.$domain"; done
  say "  $hosts"
  say ""
fi

services=()
if [ $# -gt 0 ]; then services=("${CORE[@]}" "$@"); fi

# The suite's images are built by .github/workflows/images.yml and published to the GitHub
# Container Registry, so by default they are downloaded, not built here. Anything that can't be
# downloaded (offline, or not published yet) is built
# here instead. SYNERGY_BUILD=local builds everything here.
#
# Building many images at once opens many downloads in parallel, which a slow or flaky
# connection drops (npm ECONNRESET). Compose hands a build of many services to BuildKit,
# which runs them all at once whatever COMPOSE_PARALLEL_LIMIT says, so build them in
# batches of SYNERGY_BUILD_PARALLEL (default 4) and retry a failed batch: images that
# already finished come from the build cache, so a retry only redoes what failed.
# SYNERGY_BUILD_ATTEMPTS sets the tries per batch and per download (default 3).
batch_size="${SYNERGY_BUILD_PARALLEL:-4}"
attempts="${SYNERGY_BUILD_ATTEMPTS:-3}"
registry="${SYNERGY_REGISTRY:-ghcr.io/synergytech0}"
case "$batch_size" in ''|*[!0-9]*|0) die "SYNERGY_BUILD_PARALLEL must be a whole number above 0." ;; esac

# The services whose suite image isn't on this machine. Every image is named after the service
# that builds it (office-collab runs the office image, so it shows up as office).
missing_images() {
  "${COMPOSE[@]}" config --images ${services[@]+"${services[@]}"} | sort -u | while IFS= read -r img; do
    case "$img" in "$registry"/synergysuite-*) ;; *) continue ;; esac
    docker image inspect "$img" >/dev/null 2>&1 && continue
    img="${img#"$registry"/synergysuite-}"
    printf '%s\n' "${img%%:*}"
  done
}

to_build=()
if [ "${SYNERGY_BUILD:-pull}" = local ]; then
  if [ ${#services[@]} -gt 0 ]; then
    to_build=("${services[@]}")
  else
    while IFS= read -r s; do [ -n "$s" ] && to_build+=("$s"); done < <("${COMPOSE[@]}" config --services)
  fi
else
  say "Downloading the suite's images ..."
  "${COMPOSE[@]}" pull --ignore-pull-failures ${services[@]+"${services[@]}"} || true
  attempt=1
  while :; do
    to_build=()
    while IFS= read -r s; do [ -n "$s" ] && to_build+=("$s"); done < <(missing_images)
    if [ ${#to_build[@]} -eq 0 ] || [ "$attempt" -ge "$attempts" ]; then break; fi
    attempt=$((attempt + 1))
    say "${#to_build[@]} images didn't download. Trying them again, attempt $attempt of $attempts ..."
    sleep 10
    "${COMPOSE[@]}" pull --ignore-pull-failures "${to_build[@]}" || true
  done
  if [ ${#to_build[@]} -gt 0 ]; then
    say ""
    say "These images couldn't be downloaded, so they are built here: ${to_build[*]}"
    say ""
  fi
fi

build_batch() {
  local attempt=1
  until "${COMPOSE[@]}" build "$@"; do
    if [ "$attempt" -ge "$attempts" ]; then
      die "Building $* failed $attempts times. If the log shows ECONNRESET or a timeout, the connection dropped: run this again (finished images are kept), or try SYNERGY_BUILD_PARALLEL=1."
    fi
    attempt=$((attempt + 1))
    say "The build failed (often a dropped download). Retrying, attempt $attempt of $attempts ..."
    sleep 15
  done
}

if [ ${#to_build[@]} -gt 0 ]; then
  say "Building ${#to_build[@]} images, $batch_size at a time (the first build takes a while) ..."
fi
i=0
while [ "$i" -lt "${#to_build[@]}" ]; do
  build_batch "${to_build[@]:$i:$batch_size}"
  i=$((i + batch_size))
done

say "Starting the suite ..."
"${COMPOSE[@]}" up -d ${services[@]+"${services[@]}"}

# Up means: auth-init has registered the admin and gateway, and Caddy sends a signed-out
# visitor of an app to the sign-in gateway.
probe_host=calendar
if [ ${#services[@]} -gt 0 ]; then
  probe_host=$(printf '%s\n' "$@" | grep -E -m1 '^(admin|base|books|builder|calendar|chat|contacts|crm|desk|drive|engage|forms|insights|mail|notes|office|people|planner|portal|search|sites|todo|trust)$' || echo auth)
fi
say "Waiting for sign-in to be ready ..."
ready=""
for _ in $(seq 1 120); do
  state=$("${COMPOSE[@]}" ps -a --format '{{.Service}} {{.State}} {{.ExitCode}}' auth-init 2>/dev/null | awk '{ print $2 ":" $3 }')
  case "$state" in
    exited:0) ;;
    exited:*) "${COMPOSE[@]}" logs auth-init >&2 || true; die "auth-init failed (log above)." ;;
    *) sleep 3; continue ;;
  esac
  if command -v curl >/dev/null; then
    code=$(curl -sk --noproxy '*' -o /dev/null -w '%{http_code}' --max-time 5 \
      --resolve "$probe_host.$domain:$https_port:127.0.0.1" "https://$probe_host.$domain:$https_port/" || true)
    case "$code" in 2??|3??) ready=1; break ;; esac
  else
    ready=1; break
  fi
  sleep 3
done
[ -n "$ready" ] || die "the suite did not come up in time; see: ${COMPOSE[*]} logs"

# Caddy's local root certificate, for the browser to trust (see below).
ca_note=""
if [ "$(getvar CADDY_GLOBAL_OPTIONS)" = local_certs ] &&
   "${COMPOSE[@]}" cp caddy:/data/caddy/pki/authorities/local/root.crt deploy/local-ca.crt >/dev/null 2>&1; then
  ca_note=deploy/local-ca.crt
fi

port_suffix=""
if [ "$https_port" != 443 ]; then
  port_suffix=":$https_port"
  say ""
  say "Note: HTTPS_PUBLISH is not port 443. Sign-in redirects always use 443, so forward 443 to"
  say "port $https_port (or set HTTPS_PUBLISH back to 127.0.0.1:443) for sign-in to work in a browser."
fi
password=$(getvar SEED_ADMIN_PASSWORD)

say ""
say "Synergy Suite is running."
say ""
say "  Open:      https://$probe_host.$domain$port_suffix/"
[ "$probe_host" = auth ] || say "  Admin:     https://auth.$domain$port_suffix/admin"
say "  Sign in:   $(getvar SEED_ADMIN_EMAIL)"
if [ -n "$password" ]; then
  say "  Password:  $password   (from $ENV_FILE; if you changed it after signing in, use yours)"
else
  say "  Password:  printed once by auth-init: ${COMPOSE[*]} logs auth-init"
fi
if [ "$(getvar DEMO_MODE)" = 1 ]; then
  demo_email=$(getvar DEMO_EMAIL)
  demo_password=$(getvar DEMO_PASSWORD)
  say "  Demo:      ${demo_email:-demo@$(getvar MAIL_DOMAIN | grep . || echo "$domain")} / ${demo_password:-SynergyDemo1}   (shared demo login; sample content resets automatically)"
fi
if [ -n "$ca_note" ]; then
  say ""
  say "Certificates come from Caddy's local CA, so the browser warns until you trust it:"
  say "  $ca_note"
  say "  macOS:   sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain $ca_note"
  say "  Linux:   sudo cp $ca_note /usr/local/share/ca-certificates/synergy-suite-local.crt && sudo update-ca-certificates"
  say "           (Chrome and Firefox on Linux: import it under Settings > Certificates > Authorities)"
  say "  Windows: certutil -addstore -f Root local-ca.crt   (from an administrator prompt)"
fi
say ""
say "Stop:   ${COMPOSE[*]} down"
say "Reset:  ${COMPOSE[*]} down -v && rm $ENV_FILE   (deletes all data)"
