#!/usr/bin/env bash
set -e

echo "=== Building Csotic macOS Packages (.dmg & .app) ==="

# Ensure npm dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "Installing NPM dependencies..."
    npm install
fi

# Build frontend and Tauri macOS bundles
echo "Building Tauri release binaries..."
npm run build:installer:mac

# Ensure dist-installer directory exists
mkdir -p dist-installer

# Copy produced artifacts to dist-installer
echo "Copying generated packages to dist-installer/..."
cp src-tauri/target/release/bundle/dmg/*.dmg dist-installer/ 2>/dev/null || true
cp -R src-tauri/target/release/bundle/macos/*.app dist-installer/ 2>/dev/null || true

echo "=== macOS Bundles Generated in dist-installer/ ==="
ls -lh dist-installer/
