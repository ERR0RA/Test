#!/usr/bin/env bash
# Build a minified zip of the extension ready to upload to the Chrome Web Store.
#
# What it does:
#   - Copies all extension files into ./build/
#   - Runs terser on the three JS files we author (content.js, popup.js, patch.js)
#   - Leaves the already-minified vendored libs untouched
#   - Drops dev-only files (README, LICENSE, .git, .DS_Store, .claude, the build
#     output itself) from the zip so the upload is as small as possible
#   - Writes ~/Desktop/sparx-solver.zip ready to upload
#
# Usage: ./build.sh
#
# Requires Node.js (for npx terser). First run will install terser on demand.
# Note: Chrome Web Store allows minification but bans heavy obfuscation. Stick to
# the default terser settings used here — don't add string-encoding, control-flow
# flattening, etc. or your submission will get rejected.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BUILD="$ROOT/build"
ZIP="$HOME/Desktop/sparx-solver.zip"

echo "→ Cleaning build/"
rm -rf "$BUILD" "$ZIP"
mkdir -p "$BUILD"

echo "→ Copying extension files into build/"
# Only the files Chrome actually loads. Dev-only stuff stays out.
for f in manifest.json popup.html panel.css \
         icon16.png icon48.png icon128.png \
         html2canvas.min.js katex.min.js katex.min.css katex-autorender.min.js marked.min.js; do
  cp "$ROOT/$f" "$BUILD/$f"
done

echo "→ Minifying content.js → build/content.js"
npx --yes terser "$ROOT/content.js" --compress --mangle --output "$BUILD/content.js"

echo "→ Minifying popup.js → build/popup.js"
npx --yes terser "$ROOT/popup.js" --compress --mangle --output "$BUILD/popup.js"

echo "→ Minifying patch.js → build/patch.js"
npx --yes terser "$ROOT/patch.js" --compress --mangle --output "$BUILD/patch.js"

echo "→ Zipping → $ZIP"
( cd "$BUILD" && zip -qr "$ZIP" . )

# Print the size delta so you can see the savings
ORIGINAL=$(du -ch "$ROOT/content.js" "$ROOT/popup.js" "$ROOT/patch.js" | tail -1 | awk '{print $1}')
MINIFIED=$(du -ch "$BUILD/content.js" "$BUILD/popup.js" "$BUILD/patch.js" | tail -1 | awk '{print $1}')
ZIPSIZE=$(du -h "$ZIP" | awk '{print $1}')
echo
echo "Done."
echo "  Hand-written JS — original:  $ORIGINAL"
echo "  Hand-written JS — minified:  $MINIFIED"
echo "  Final zip size:              $ZIPSIZE"
echo "  Upload: $ZIP"
