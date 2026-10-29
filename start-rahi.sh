#!/bin/bash
# Rahi test run for Mac / Linux. Run: ./start-rahi.sh
# Needs Node.js 20+ from https://nodejs.org
set -e
cd "$(dirname "$0")"

command -v node >/dev/null 2>&1 || {
  echo "Node.js is not installed. Get it free from https://nodejs.org (LTS), then run this again."
  exit 1
}

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only, takes a few minutes)..."
  npm install
fi

if [ ! -f apps/api/dist/main.js ]; then
  echo "Building the API..."
  npm --workspace apps/api run build
fi

export NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/api/v1
if [ ! -d apps/admin-web/.next ]; then
  echo "Building the admin app..."
  npm --workspace apps/admin-web run build
fi

export NODE_ENV=development PORT=3001
export DEV_ADMIN_EMAIL=admin@rahi.test
export DEV_ADMIN_PASSWORD=af3a83300eef19bdd5cd37f7

node apps/api/dist/main.js > rahi-api.log 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null' EXIT INT TERM

echo "Rahi API is up (log: rahi-api.log)."
echo "Open http://localhost:3000 and sign in with:"
echo "  Email:    admin@rahi.test"
echo "  Password: af3a83300eef19bdd5cd37f7"
echo "Stop everything with Ctrl+C."
npm --workspace apps/admin-web run start
