#!/usr/bin/env bash
# Build a Firefox .xpi package suitable for upload to
# Mozilla Add-on Developer Hub (https://addons.mozilla.org/developers/).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v zip >/dev/null 2>&1; then
  echo "error: zip is required (e.g. pacman -S zip / apt install zip)" >&2
  exit 1
fi

if [[ ! -f manifest.json ]]; then
  echo "error: manifest.json not found in $ROOT" >&2
  exit 1
fi

VERSION="$(
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' manifest.json | head -n1
)"
if [[ -z "$VERSION" ]]; then
  echo "error: could not read version from manifest.json" >&2
  exit 1
fi

NAME="jobsdb-extractor"
OUT_DIR="${ROOT}/dist"
OUT_FILE="${OUT_DIR}/${NAME}-${VERSION}.xpi"

mkdir -p "$OUT_DIR"
rm -f "$OUT_FILE"

# Stage only extension runtime files so the archive root is clean.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

FILES=(
  manifest.json
  background
  content
  popup
  icons
)

for item in "${FILES[@]}"; do
  if [[ ! -e "$item" ]]; then
    echo "error: missing required path: $item" >&2
    exit 1
  fi
  cp -a "$item" "$STAGE/"
done

(
  cd "$STAGE"
  # -FS keeps the archive in sync; -X omits extra file attributes for cleaner diffs.
  zip -r -FS -X "$OUT_FILE" . \
    -x '*/.DS_Store' \
    -x '*~' \
    -x '*.swp'
)

SIZE="$(wc -c <"$OUT_FILE" | tr -d ' ')"
echo "Built: $OUT_FILE ($SIZE bytes)"
echo
echo "Next steps:"
echo "  1. Open https://addons.mozilla.org/developers/"
echo "  2. Create / select this add-on → Upload New Version"
echo "  3. Upload the .xpi (or rename to .zip — same format)"
echo "  4. Submit for review (or use self-distribution / unlisted if preferred)"
