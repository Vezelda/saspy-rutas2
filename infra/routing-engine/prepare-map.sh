#!/usr/bin/env bash
# Descarga el mapa de Paraguay y lo procesa para OSRM.
# Correr una sola vez antes del primer "docker compose up",
# y de nuevo (borrando ./data primero) cuando quieran refrescar el mapa.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="$SCRIPT_DIR/data"
PBF="paraguay-latest.osm.pbf"
IMAGE="ghcr.io/project-osrm/osrm-backend"

mkdir -p "$DATA_DIR"
cd "$DATA_DIR"

echo "==> Descargando mapa de Paraguay (OpenStreetMap, Geofabrik)..."
curl -L --fail -o "$PBF" "https://download.geofabrik.de/south-america/$PBF"

echo "==> osrm-extract (perfil: auto/car)..."
docker run -t --rm -v "$DATA_DIR:/data" "$IMAGE" \
  osrm-extract -p /opt/car.lua "/data/$PBF"

echo "==> osrm-partition..."
docker run -t --rm -v "$DATA_DIR:/data" "$IMAGE" \
  osrm-partition "/data/paraguay-latest.osrm"

echo "==> osrm-customize..."
docker run -t --rm -v "$DATA_DIR:/data" "$IMAGE" \
  osrm-customize "/data/paraguay-latest.osrm"

echo "==> Listo. Ahora: docker compose up -d"
