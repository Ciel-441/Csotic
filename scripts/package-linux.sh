#!/usr/bin/env bash
set -e

echo "=== Building Csotic Linux Packages (.deb & .AppImage) ==="

# Check for required system libraries on Ubuntu / Debian
if command -v apt-get &> /dev/null; then
    echo "Ensuring required build libraries are installed..."
    sudo apt-get update -qq || true
    sudo apt-get install -y -qq libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libgtk-3-dev libdbus-1-dev libssl-dev patchelf build-essential curl || true
fi

# Ensure npm dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "Installing NPM dependencies..."
    npm install
fi

# Build frontend and Tauri Linux bundles
echo "Building Tauri release binaries..."
npm run build:installer:linux

# Ensure dist-installer directory exists
mkdir -p dist-installer

# Copy produced artifacts to dist-installer
echo "Copying generated packages to dist-installer/..."
cp src-tauri/target/release/bundle/deb/*.deb dist-installer/ 2>/dev/null || true
cp src-tauri/target/release/bundle/appimage/*.AppImage dist-installer/ 2>/dev/null || true

echo "=== Linux Bundles Generated in dist-installer/ ==="
ls -lh dist-installer/
