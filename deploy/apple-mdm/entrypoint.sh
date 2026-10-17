#!/bin/sh
# Starts one half of Apple device management: `apple-mdm scep` or `apple-mdm mdm`.
# Without its keys it stays idle, so the rest of the suite runs the same either way.
set -eu
role="${1:-}"
data="${APPLE_MDM_DATA:-/data}"
ca="${APPLE_MDM_CA:-/scep-depot/scep/ca.pem}"

idle() {
  echo "Apple device management is off: $1. See apps/devices/README.md." >&2
  exec sleep 2147483647
}

case "$role" in
  scep)
    [ -n "${DEVICES_SCEP_CHALLENGE:-}" ] || idle "DEVICES_SCEP_CHALLENGE is empty"
    # The certificate authority for device identities, made once and kept in the volume.
    if [ ! -f "$data/scep/ca.pem" ]; then
      mkdir -p "$data/scep"
      scepserver ca -init -depot "$data/scep" -organization "${DEVICES_ORG_NAME:-Synergy}" -common_name "${DEVICES_ORG_NAME:-Synergy} Device CA"
    fi
    exec scepserver -depot "$data/scep" -challenge "$DEVICES_SCEP_CHALLENGE" -port 8080 -allowrenew 0
    ;;
  mdm)
    [ -n "${DEVICES_MDM_API_KEY:-}" ] && [ -n "${DEVICES_MDM_WEBHOOK_KEY:-}" ] || idle "DEVICES_MDM_API_KEY or DEVICES_MDM_WEBHOOK_KEY is empty"
    # NanoMDM checks each device's certificate against the SCEP certificate authority.
    i=0
    while [ ! -f "$ca" ]; do
      i=$((i + 1))
      [ "$i" -le 120 ] || { echo "No SCEP certificate authority at $ca" >&2; exit 1; }
      sleep 1
    done
    mkdir -p "$data/nanomdm"
    exec nanomdm -listen :9000 -ca "$ca" -storage filekv -storage-dsn "$data/nanomdm" \
      -api "$DEVICES_MDM_API_KEY" \
      -webhook-url "${DEVICES_MDM_WEBHOOK_URL:-http://devices:3810/api/svc/apple/webhook}" \
      -webhook-hmac-key "$DEVICES_MDM_WEBHOOK_KEY"
    ;;
  *)
    echo "usage: apple-mdm scep|mdm" >&2
    exit 2
    ;;
esac
