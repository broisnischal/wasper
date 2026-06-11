#!/bin/sh
# wasper installer — https://studio.stroke.click/install.sh
# Usage: curl -fsSL https://studio.stroke.click/install.sh | sh
set -e

REPO="broisnischal/wasper"
BINARY="wasper"
INSTALL_DIR="/usr/local/bin"

bold()  { printf '\033[1m%s\033[0m' "$1"; }
green() { printf '\033[32m%s\033[0m' "$1"; }
red()   { printf '\033[31m%s\033[0m' "$1"; }
dim()   { printf '\033[2m%s\033[0m' "$1"; }

echo ""
printf "  $(bold 'wasper') installer\n"
echo ""

# ── Prefer bun/npm global install if bun is available ──────────────────────────
if command -v bun >/dev/null 2>&1; then
  echo "  $(dim '→') bun detected — installing via npm registry..."
  echo ""
  bun add -g wasper-cli
  echo ""
  echo "  $(green '✓') wasper installed via bun"
  echo "  $(dim 'Run:') wasper --help"
  echo ""
  exit 0
fi

# ── Standalone binary install ───────────────────────────────────────────────────
OS="$(uname -s 2>/dev/null || echo unknown)"
ARCH="$(uname -m 2>/dev/null || echo unknown)"

case "$OS" in
  Darwin) OS_KEY="darwin" ;;
  Linux)  OS_KEY="linux"  ;;
  *)
    echo "  $(red '✗') Unsupported OS: $OS"
    echo "  Install bun first (https://bun.sh) then re-run this script, or"
    echo "  download a binary from https://github.com/${REPO}/releases"
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64 | amd64)   ARCH_KEY="x64"   ;;
  arm64  | aarch64)  ARCH_KEY="arm64"  ;;
  *)
    echo "  $(red '✗') Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

ASSET_NAME="${BINARY}-${OS_KEY}-${ARCH_KEY}"

# Fetch latest release tag from GitHub
echo "  $(dim '→') Fetching latest release..."
LATEST=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
  | grep '"tag_name"' \
  | head -1 \
  | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')

if [ -z "$LATEST" ]; then
  echo "  $(red '✗') Could not determine latest release. Check https://github.com/${REPO}/releases"
  exit 1
fi

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${LATEST}/${ASSET_NAME}"

echo "  $(dim '→') Downloading wasper ${LATEST} for ${OS_KEY}/${ARCH_KEY}..."

TMP="$(mktemp)"
if ! curl -fsSL "$DOWNLOAD_URL" -o "$TMP"; then
  echo "  $(red '✗') Download failed: $DOWNLOAD_URL"
  rm -f "$TMP"
  exit 1
fi
chmod +x "$TMP"

# Install — use sudo only if needed
if [ -w "$INSTALL_DIR" ]; then
  mv "$TMP" "${INSTALL_DIR}/${BINARY}"
elif command -v sudo >/dev/null 2>&1; then
  echo "  $(dim '→') sudo required to write to ${INSTALL_DIR}..."
  sudo mv "$TMP" "${INSTALL_DIR}/${BINARY}"
else
  # Fall back to ~/.local/bin
  INSTALL_DIR="${HOME}/.local/bin"
  mkdir -p "$INSTALL_DIR"
  mv "$TMP" "${INSTALL_DIR}/${BINARY}"
  echo ""
  echo "  $(dim 'Note:') Installed to ${INSTALL_DIR}. Make sure it is in your PATH:"
  echo "  $(dim '      export PATH=\"\$HOME/.local/bin:\$PATH\"')"
fi

echo ""
echo "  $(green '✓') wasper ${LATEST} installed to ${INSTALL_DIR}/${BINARY}"
echo "  $(dim 'Run:') wasper --help"
echo ""
