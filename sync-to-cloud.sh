#!/bin/bash
# Sincronizar datos locales al servidor público de ViriatoTempo
# Uso: ./sync-to-cloud.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_FILE="$SCRIPT_DIR/../backend/data.json"
REMOTE_URL="${VIRIATO_API_URL:-https://viriatotempo.onrender.com}"
SYNC_TOKEN="${VIRIATO_SYNC_TOKEN:-viriato-sync-2026}"

if [ ! -f "$DATA_FILE" ]; then
  echo "❌ No se encontró data.json en $DATA_FILE"
  exit 1
fi

echo "📤 Sincronizando datos a $REMOTE_URL ..."
echo "   Archivo: $DATA_FILE ($(du -h "$DATA_FILE" | cut -f1))"

# Enviar solo events, participants y results (sin users ni splits por seguridad)
# Usar jq si está disponible, si no enviar todo
if command -v jq &> /dev/null; then
  PAYLOAD=$(jq '{events, participants, results}' "$DATA_FILE")
else
  PAYLOAD=$(cat "$DATA_FILE")
fi

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$REMOTE_URL/sync" \
  -H "Content-Type: application/json" \
  -H "X-Sync-Token: $SYNC_TOKEN" \
  -d "$PAYLOAD")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -1)

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Sincronización completada: $BODY"
else
  echo "❌ Error ($HTTP_CODE): $BODY"
  exit 1
fi
