#!/usr/bin/env bash
# Read-only, first-install B1 host delta for RCAT POS staging. No DNS, Docker or host mutations.
set -euo pipefail
set +x

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${RCAT_POS_ENV_FILE:-$ROOT/.env.staging}"

fail() { printf 'B1 HOST DELTA BLOCKED: %s\n' "$*" >&2; exit 1; }

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  printf 'Usage: bash scripts/ops/onprem-host-delta.sh (read-only; initial staging install only)\n'
  exit 0
fi
[[ $# -eq 0 ]] || fail "This read-only command accepts no arguments"

# Reuse the existing protected-env and staging-only policy instead of duplicating validation.
bash "$ROOT/scripts/ops/onprem-staging.sh" preflight >/dev/null || fail "Protected staging configuration preflight failed"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

[[ "$(uname -s)" == Linux ]] || fail "Linux staging host required"
for command_name in ss ip docker awk df; do
  command -v "$command_name" >/dev/null 2>&1 || fail "Missing host command: $command_name"
done

# Bind to a local interface only; the existing preflight permits just loopback / IOT LAN.
if [[ "$RCAT_POS_HOST_BIND_IP" != 127.0.0.1 ]]; then
  assigned="$(ip -o -4 addr show | awk -v target="$RCAT_POS_HOST_BIND_IP" '
    { split($4, addr, "/"); if (addr[1] == target) found = 1 }
    END { print found ? "yes" : "no" }
  ')" || fail "Cannot inspect assigned IPv4 addresses"
  [[ "$assigned" == yes ]] || fail "Approved LAN bind IP is not assigned to this host"
fi

# ss checks the host network namespace. Never infer port availability from CI images.
listening="$(ss -H -ltn)" || fail "Cannot read host TCP listeners"
for port in "$RCAT_POS_CUSTOMER_PORT" "$RCAT_POS_MERCHANT_PORT" "$RCAT_POS_ADMIN_PORT"; do
  occupied="$(printf '%s\n' "$listening" | awk -v target="$port" '
    NF >= 4 { address = $4; sub(/^.*:/, "", address); if (address == target) { print "yes"; exit } }
  ')" || fail "Cannot inspect port $port"
  [[ "$occupied" != yes ]] || fail "TCP port $port already listens on host; investigate collision"
done

# First-install safety. Re-running after deployment must use the targeted verify command instead.
existing="$(docker ps -aq --filter 'label=com.docker.compose.project=rcat-pos-staging' 2>/dev/null)" ||
  fail "Docker daemon unavailable or operator lacks permission"
[[ -z "$existing" ]] || fail "Staging Compose project already exists; use verify or reviewed upgrade procedure"

memory_kib="$(awk '/^MemAvailable:/ {print $2; exit}' /proc/meminfo)"
disk_kib="$(df -Pk "$ROOT" | awk 'END {print $4}')"
[[ "$memory_kib" =~ ^[0-9]+$ && "$disk_kib" =~ ^[0-9]+$ ]] ||
  fail "Could not measure available memory and source-filesystem capacity"
(( memory_kib > 0 && disk_kib > 0 )) || fail "No measurable available memory/disk headroom"

printf 'B1 HOST DELTA: port_collision=none compose_project=absent bind=%s ports=%s,%s,%s memory_available_mib=%s source_fs_available_mib=%s\n' \
  "$RCAT_POS_HOST_BIND_IP" "$RCAT_POS_CUSTOMER_PORT" "$RCAT_POS_MERCHANT_PORT" "$RCAT_POS_ADMIN_PORT" \
  "$((memory_kib / 1024))" "$((disk_kib / 1024))"
printf 'PENDING: capacity sizing, RMS HTTPS/firewall, restricted secrets/OAuth and C owner policy are NOT approved by this probe. No deployment executed.\n'
