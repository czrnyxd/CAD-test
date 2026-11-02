#!/usr/bin/env bash
# Runs ON THE VPS (started by deploy/deploy-vps.ps1). Installs/updates BusBar CAD next to other
# services: own folder, own Docker Compose project, port only on 127.0.0.1.
#   $BUSBAR_BASE/src.new  – freshly uploaded code (unpacked by the PowerShell script)
#   $BUSBAR_BASE/src      – current code,  src.old – previous (for rollback)
#   $BUSBAR_BASE/.env     – access code, created once, never overwritten
set -euo pipefail

BASE="${BUSBAR_BASE:-/opt/busbar-cad}"
PORT_DEFAULT="${1:-8090}"
NEW="$BASE/src.new"

[ -d "$NEW" ] || { echo "Brak $NEW – uruchom deploy-vps.ps1"; exit 1; }
command -v docker >/dev/null || { echo "Brak Dockera na serwerze"; exit 1; }

if [ ! -f "$BASE/.env" ]; then
  ( umask 077; printf 'API_TOKEN=%s\nBUSBAR_PORT=%s\n' "$(openssl rand -hex 12)" "$PORT_DEFAULT" > "$BASE/.env" )
  echo ">>> Utworzono nowy kod dostępu (zapisany w $BASE/.env)."
fi
PORT="$(grep '^BUSBAR_PORT=' "$BASE/.env" | cut -d= -f2)"
PORT="${PORT:-$PORT_DEFAULT}"

rm -rf "$BASE/src.old"
if [ -d "$BASE/src" ]; then mv "$BASE/src" "$BASE/src.old"; fi
mv "$NEW" "$BASE/src"
cp "$BASE/.env" "$BASE/src/.env"

cd "$BASE/src"
echo ">>> Budowanie i uruchamianie kontenera busbar-cad (port 127.0.0.1:$PORT)..."
docker compose -p busbar-cad up -d --build

ok=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
if [ "$ok" != 1 ]; then
  echo "!!! Serwer nie odpowiada. Logi: docker compose -p busbar-cad logs --tail=50"
  exit 1
fi

echo ">>> BusBar CAD działa na http://127.0.0.1:$PORT"
echo ">>> Kod dostępu dla tabletów: $(grep '^API_TOKEN=' "$BASE/.env" | cut -d= -f2)"
