#!/usr/bin/env bash
# Only Nginx Proxy Manager may reach the port the stack's nginx is published on (RUNBOOK §0.7).
#
# Anything else that reached it could send its own X-Forwarded-For and pick the client address the
# API records and rate-limits by. Docker publishes ports through its own iptables rules, which the
# host's INPUT rules never see, so the filter goes in DOCKER-USER, the chain Docker leaves to us.
#
# What it does, idempotently:
#   - keeps its rules in a chain of its own, IMS-ORIGIN: accept from NPM_SOURCE_IP, drop the rest;
#   - removes any earlier jump to that chain (for example, one for an old port), then adds one jump
#     from DOCKER-USER for traffic to IMS_LISTEN_IP:IMS_HTTP_PORT.
# DOCKER-USER sees a packet after Docker has rewritten its destination to the container, so the
# match is conntrack's ORIGINAL destination: the address and port the client actually asked for.
#
# Values come from infra/.env: IMS_LISTEN_IP, IMS_HTTP_PORT, NPM_SOURCE_IP. Run as root, after
# Docker has started. firewall/ims-docker-user.service runs it at every boot.
#
# Usage:  firewall/ims-docker-user.sh [--remove] [path/to/.env]
#   --remove   take the jump and the chain out again (the undo)
set -euo pipefail

CHAIN=IMS-ORIGIN
REMOVE=0
if [ "${1:-}" = "--remove" ]; then REMOVE=1; shift; fi
ENV_FILE="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.env}"

drop_jumps() {
  # `iptables -S` prints each rule as the arguments that created it; -A becomes -D to delete it.
  iptables -S DOCKER-USER | grep -- "-j ${CHAIN}\$" | sed 's/^-A /-D /' | while read -r rule; do
    # shellcheck disable=SC2086  # the rule is a list of iptables arguments on purpose
    iptables $rule
  done
}

if ! iptables -S DOCKER-USER >/dev/null 2>&1; then
  echo "FATAL: no DOCKER-USER chain. Is Docker running with its iptables rules?" >&2
  exit 2
fi

if [ "$REMOVE" = 1 ]; then
  drop_jumps
  iptables -F "$CHAIN" 2>/dev/null || true
  iptables -X "$CHAIN" 2>/dev/null || true
  echo "removed: ${CHAIN} and its jump from DOCKER-USER"
  exit 0
fi

[ -r "$ENV_FILE" ] || { echo "FATAL: cannot read ${ENV_FILE}" >&2; exit 2; }
value() { sed -nE "s/^$1=[\"']?([^\"'#[:space:]]*)[\"']?.*$/\1/p" "$ENV_FILE" | tail -1; }
LISTEN=$(value IMS_LISTEN_IP)
PORT=$(value IMS_HTTP_PORT)
NPM=$(value NPM_SOURCE_IP)

IPV4='^([0-9]{1,3}\.){3}[0-9]{1,3}$'
[[ $LISTEN =~ $IPV4 ]] || { echo "FATAL: IMS_LISTEN_IP is not an IPv4 address: '${LISTEN}'" >&2; exit 2; }
[[ $NPM =~ $IPV4 ]] || { echo "FATAL: NPM_SOURCE_IP is not an IPv4 address: '${NPM}'" >&2; exit 2; }
[[ $PORT =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] \
  || { echo "FATAL: IMS_HTTP_PORT is not a port: '${PORT}'" >&2; exit 2; }

iptables -N "$CHAIN" 2>/dev/null || true
iptables -F "$CHAIN"
iptables -A "$CHAIN" -s "$NPM" -j RETURN
iptables -A "$CHAIN" -j DROP

drop_jumps
iptables -I DOCKER-USER 1 -p tcp -m conntrack --ctdir ORIGINAL \
  --ctorigdst "$LISTEN" --ctorigdstport "$PORT" -j "$CHAIN"

echo "applied: ${LISTEN}:${PORT} reachable from ${NPM} only"
iptables -S DOCKER-USER | grep -- "-j ${CHAIN}\$"
iptables -S "$CHAIN"
