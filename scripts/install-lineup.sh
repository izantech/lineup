#!/usr/bin/env bash
set -euo pipefail

OWNER="izantech"
REPO="lineup"
VERSION=""

usage() {
  cat <<USAGE
Bootstrap installer for Lineup CLI shim.

Usage:
  ./scripts/install-lineup.sh [--version <tag>] [--help]

Options:
  --version <tag>   Install shim pointing to a specific release tag (default: latest)
  --help            Show this message
USAGE
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --version)
        if [[ $# -lt 2 ]]; then
          echo "Missing value for --version" >&2
          exit 1
        fi
        VERSION="$2"
        shift 2
        ;;
      --version=*)
        VERSION="${1#*=}"
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        echo "Unknown option: $1" >&2
        usage
        exit 1
        ;;
    esac
  done
}

resolve_latest_tag() {
  curl -fsSL "https://api.github.com/repos/${OWNER}/${REPO}/releases/latest" \
    | grep -m1 '"tag_name"' \
    | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'
}

parse_args "$@"

require_cmd curl
require_cmd tar
require_cmd node

if [[ -z "$VERSION" ]]; then
  VERSION="$(resolve_latest_tag)"
fi

if [[ -z "$VERSION" ]]; then
  echo "Unable to resolve Lineup release tag." >&2
  exit 1
fi

LINEUP_HOME="${HOME}/.lineup"
BOOTSTRAP_ROOT="${LINEUP_HOME}/bootstrap/releases"
RELEASE_ROOT="${BOOTSTRAP_ROOT}/${VERSION}"
SOURCE_ROOT="${RELEASE_ROOT}/source"
TMP_DIR="${RELEASE_ROOT}/tmp.$$"
LOCAL_BIN="${HOME}/.local/bin"
SHIM_PATH="${LOCAL_BIN}/lineup"
CURRENT_LINK="${LINEUP_HOME}/current"
TARBALL_URL="https://codeload.github.com/${OWNER}/${REPO}/tar.gz/refs/tags/${VERSION}"

mkdir -p "$RELEASE_ROOT" "$LOCAL_BIN"
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"

echo "Downloading ${OWNER}/${REPO} ${VERSION}..."
curl -fsSL "$TARBALL_URL" -o "${TMP_DIR}/release.tar.gz"

echo "Extracting release..."
tar -xzf "${TMP_DIR}/release.tar.gz" -C "$TMP_DIR"

EXTRACTED_ROOT="$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -n1)"
if [[ -z "$EXTRACTED_ROOT" ]]; then
  echo "Failed to locate extracted release directory." >&2
  exit 1
fi

rm -rf "$SOURCE_ROOT"
mv "$EXTRACTED_ROOT" "$SOURCE_ROOT"
rm -rf "$TMP_DIR"

if [[ ! -f "${SOURCE_ROOT}/scripts/lineup.mjs" ]]; then
  rm -rf "$SOURCE_ROOT"
  echo "Release ${VERSION} is missing scripts/lineup.mjs (installer artifacts unavailable)." >&2
  exit 1
fi

cat > "$SHIM_PATH" <<'SHIM'
#!/usr/bin/env bash
set -euo pipefail
LINEUP_HOME="${LINEUP_HOME:-$HOME/.lineup}"
SCRIPT="${LINEUP_HOME}/current/scripts/lineup.mjs"
if [[ ! -f "$SCRIPT" ]]; then
  echo "Lineup CLI script not found at $SCRIPT" >&2
  echo "Run scripts/install-lineup.sh again." >&2
  exit 1
fi
exec node "$SCRIPT" "$@"
SHIM

chmod +x "$SHIM_PATH"
ln -sfn "$SOURCE_ROOT" "$CURRENT_LINK"

echo "Installed Lineup shim: $SHIM_PATH"
echo "Current release: $VERSION"

if [[ ":$PATH:" != *":${LOCAL_BIN}:"* ]]; then
  echo "Add ${LOCAL_BIN} to PATH to run 'lineup' directly."
fi

echo "Try: lineup status --host all"
