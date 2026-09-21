#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/../.."

if [ ! -f .env.production ]; then
  echo "Missing backend/.env.production. Copy .env.production.example, edit it, and retry." >&2
  exit 1
fi

docker compose --env-file .env.production -f docker-compose.vps.yml up -d --build
docker compose --env-file .env.production -f docker-compose.vps.yml ps

echo "PadhaiKaro is starting on the API_DOMAIN configured in backend/.env.production."
echo "Check logs with: docker compose --env-file .env.production -f docker-compose.vps.yml logs -f app scheduler"
