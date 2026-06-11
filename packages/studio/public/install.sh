#!/bin/sh
# wasper installer — https://studio.stroke.click/install.sh
# Usage: curl -fsSL https://studio.stroke.click/install.sh | sh
#
# Installs a standalone wasper binary (no bun / node required at runtime).
set -e

REPO="broisnischal/wasper"
BINARY="wasper"
INSTALL_DIR="/usr/local/bin"

bold()  { printf '\033[1m%s\033[0m' "$1"; }
green() { printf '\033[32m%s\033[0m' "$1"; }
red()   { printf '\033[31m%s\033[0m' "$1"; }
dim()   { printf '\033[2m%s\033[0m' "$1"; }
cyan()  { printf '\033[36m%s\033[0m' "$1"; }

echo ""
printf "  $(bold 'wasper') installer\n"
echo ""

# ── Detect OS ────────────────────────────────────────────────────────────────
OS="$(uname -s 2>/dev/null || echo unknown)"
ARCH="$(uname -m 2>/dev/null || echo unknown)"

case "$OS" in
  Darwin) OS_KEY="darwin" ;;
  Linux)  OS_KEY="linux"  ;;
  *)
    echo "  $(red '✗') This script is for macOS/Linux."
    echo ""
    echo "  On Windows, open PowerShell and run:"
    echo ""
    echo "  $(cyan 'irm https://studio.stroke.click/install.ps1 | iex')"
    echo ""
    echo "  Or install via npm (requires Node.js):"
    echo "  $(dim 'npm install -g wasper-cli')"
    echo ""
    echo "  Or download the .exe directly:"
    echo "  $(dim "https://github.com/${REPO}/releases")"
    echo ""
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64 | amd64)  ARCH_KEY="x64"  ;;
  arm64  | aarch64) ARCH_KEY="arm64" ;;
  *)
    echo "  $(red '✗') Unsupported architecture: $ARCH"
    echo "  Download manually: $(cyan "https://github.com/${REPO}/releases")"
    exit 1
    ;;
esac

ASSET_NAME="${BINARY}-${OS_KEY}-${ARCH_KEY}"

# ── Fetch latest release tag ─────────────────────────────────────────────────
echo "  $(dim '→') Resolving latest release..."

LATEST=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
  | grep '"tag_name"' \
  | head -1 \
  | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')

if [ -z "$LATEST" ]; then
  echo "  $(red '✗') Could not fetch latest release."
  echo "  Check: $(cyan "https://github.com/${REPO}/releases")"
  exit 1
fi

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${LATEST}/${ASSET_NAME}"
CHECKSUM_URL="https://github.com/${REPO}/releases/download/${LATEST}/checksums.txt"

echo "  $(dim '→') Downloading wasper ${LATEST} (${OS_KEY}/${ARCH_KEY})..."

TMP="$(mktemp)"
trap 'rm -f "$TMP" "$TMP.checksums"' EXIT

if ! curl -fsSL --progress-bar "$DOWNLOAD_URL" -o "$TMP"; then
  echo "  $(red '✗') Download failed."
  echo "  URL: $DOWNLOAD_URL"
  echo "  Make sure the release exists: $(cyan "https://github.com/${REPO}/releases/tag/${LATEST}")"
  exit 1
fi

chmod +x "$TMP"

# ── Verify checksum (optional — skip if sha256sum not available) ─────────────
if command -v sha256sum >/dev/null 2>&1; then
  echo "  $(dim '→') Verifying checksum..."
  if curl -fsSL "$CHECKSUM_URL" -o "$TMP.checksums" 2>/dev/null; then
    EXPECTED=$(grep "$ASSET_NAME" "$TMP.checksums" | awk '{print $1}')
    ACTUAL=$(sha256sum "$TMP" | awk '{print $1}')
    if [ -n "$EXPECTED" ] && [ "$EXPECTED" != "$ACTUAL" ]; then
      echo "  $(red '✗') Checksum mismatch — aborting."
      echo "    expected: $EXPECTED"
      echo "    got:      $ACTUAL"
      exit 1
    fi
    echo "  $(dim '✓') Checksum verified"
  fi
fi

# ── Install ──────────────────────────────────────────────────────────────────
if [ -w "$INSTALL_DIR" ]; then
  mv "$TMP" "${INSTALL_DIR}/${BINARY}"
elif command -v sudo >/dev/null 2>&1; then
  echo "  $(dim '→') Writing to ${INSTALL_DIR} (sudo required)..."
  sudo mv "$TMP" "${INSTALL_DIR}/${BINARY}"
else
  INSTALL_DIR="${HOME}/.local/bin"
  mkdir -p "$INSTALL_DIR"
  mv "$TMP" "${INSTALL_DIR}/${BINARY}"
  echo ""
  echo "  $(dim 'Note:') Installed to ${INSTALL_DIR} — add to PATH if needed:"
  echo "  $(dim '      export PATH=\"\$HOME/.local/bin:\$PATH\"')"
fi

echo ""
echo "  $(green '✓') wasper ${LATEST} installed"
echo "  $(dim 'Binary:') ${INSTALL_DIR}/${BINARY}"
echo ""
echo "  $(dim 'Get started:')"
echo "  $(cyan "wasper --url https://petstore.swagger.io/v2/swagger.json")"
echo ""
echo "  $(dim 'Docs:') https://studio.stroke.click/docs"
echo ""
