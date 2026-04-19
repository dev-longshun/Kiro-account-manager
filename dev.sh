#!/bin/bash
set -e

cd "$(dirname "$0")/Kiro-account-manager"

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

npm run dev
