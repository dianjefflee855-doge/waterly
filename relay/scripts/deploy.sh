#!/usr/bin/env bash
# Deploy the Waterly relay to YOUR OWN Cloudflare account.
# Usage: ./scripts/deploy.sh [--origin https://your-web-host] [--domain relay.example.com] [--registration-key]
set -euo pipefail
cd "$(dirname "$0")/.."
ORIGIN="" DOMAIN="" SETKEY=0
while [ $# -gt 0 ]; do case "$1" in
  --origin) ORIGIN="$2"; shift 2;; --domain) DOMAIN="$2"; shift 2;; --registration-key) SETKEY=1; shift;;
  -h|--help) sed -n 2,3p "$0"; exit 0;; *) echo "unknown arg: $1" >&2; exit 2;; esac; done
command -v npx >/dev/null || { echo "Node.js >= 22 is required" >&2; exit 1; }
[ -d node_modules ] || npm install
npx wrangler whoami >/dev/null 2>&1 || npx wrangler login
ARGS=()
[ -n "$ORIGIN" ] && ARGS+=(--var "ALLOWED_ORIGINS:$ORIGIN")
[ -n "$DOMAIN" ] && ARGS+=(--route "$DOMAIN" )
if [ "$SETKEY" = 1 ]; then
  echo "Enter a registration key (only Macs that know it can register on your relay):"
  npx wrangler secret put REGISTRATION_KEY
fi
npx wrangler deploy "${ARGS[@]}"
echo
echo "Done. Put the relay URL (https://<worker>.<you>.workers.dev or https://$DOMAIN) into:"
echo "  - Waterly on your Mac: 远程访问 → 中继地址"
echo "  - the web client: 「中继服务器」 field, ?relay=..., or <meta name=\"waterly-relay\">"
