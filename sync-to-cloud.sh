#!/bin/bash
# Sincronizar datos locales al servidor público de ViriatoTempo
# 1. Filtra datos sensibles (users, splits, ignoredDuplicates)
# 2. Copia data.json al repo deploy
# 3. Envía datos al API de Render (en memoria)
# 4. Hace commit+push para que futuros redeploys tengan datos
#
# Uso: ./sync-to-cloud.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_FILE="$SCRIPT_DIR/../backend/data.json"
DEPLOY_DATA="$SCRIPT_DIR/data.json"
REMOTE_URL="${VIRIATO_API_URL:-https://viriatotempo.onrender.com}"
SYNC_TOKEN="${VIRIATO_SYNC_TOKEN:-viriato-sync-2026}"

if [ ! -f "$DATA_FILE" ]; then
  echo "❌ No se encontró data.json en $DATA_FILE"
  exit 1
fi

echo "📤 Sincronizando datos a $REMOTE_URL ..."
echo "   Archivo: $DATA_FILE ($(du -h "$DATA_FILE" | cut -f1))"

# ── Paso 1: Filtrar campos públicos (sin users, ignoredDuplicates) ──
echo "🔒 Filtrando datos sensibles..."
if command -v python3 &> /dev/null; then
  python3 -c "
import json, sys
with open('$DATA_FILE') as f:
    data = json.load(f)
public = {
    'events': data.get('events', []),
    'participants': data.get('participants', []),
    'results': data.get('results', []),
    'splits': data.get('splits', []),
    'laps': data.get('laps', [])
}
with open('$DEPLOY_DATA', 'w') as f:
    json.dump(public, f)
print(f'   Events: {len(public[\"events\"])}, Participants: {len(public[\"participants\"])}, Results: {len(public[\"results\"])}, Splits: {len(public[\"splits\"])}, Laps: {len(public[\"laps\"])}')
"
elif command -v jq &> /dev/null; then
  jq '{events, participants, results, splits, laps}' "$DATA_FILE" > "$DEPLOY_DATA"
else
  echo "⚠️ Ni python3 ni jq disponibles — copiando data.json completo"
  cp "$DATA_FILE" "$DEPLOY_DATA"
fi

DEPLOY_SIZE=$(du -h "$DEPLOY_DATA" | cut -f1)
echo "   data.json para deploy: $DEPLOY_SIZE"

# ── Paso 2: Enviar al API de Render (carga en memoria inmediata) ──
echo "📡 Enviando al API..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$REMOTE_URL/sync" \
  -H "Content-Type: application/json" \
  -H "X-Sync-Token: $SYNC_TOKEN" \
  --data-binary "@$DEPLOY_DATA")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ API sincronizado: $BODY"
else
  echo "❌ Error API ($HTTP_CODE): $BODY"
  echo "   (Continuando con commit al repo de todas formas...)"
fi

# ── Paso 3: Commit + push al repo deploy (persistencia en Git) ──
echo "📦 Guardando en repo deploy..."
cd "$SCRIPT_DIR"
git add data.json
if git diff --cached --quiet data.json 2>/dev/null; then
  echo "   Sin cambios en data.json — nada que commitear"
else
  git commit -m "sync: actualizar data.json ($(date '+%Y-%m-%d %H:%M'))"
  echo "🚀 Pushing al repo..."
  git push origin main
  echo "✅ data.json guardado en repo — Render tendrá datos tras redeploy"
fi

echo ""
echo "🎉 ¡Sincronización completa!"
