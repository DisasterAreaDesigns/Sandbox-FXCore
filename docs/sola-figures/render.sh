#!/bin/sh
# Rasterise each fig*.svg here to a 2x PNG with headless Chrome (macOS path).
# Run gen-figs.js first.
cd "$(dirname "$0")"
for f in fig*.svg; do
  w=$(sed -n 's/.*width="\([0-9]*\)" height="\([0-9]*\)".*/\1/p' "$f" | head -1)
  h=$(sed -n 's/.*width="\([0-9]*\)" height="\([0-9]*\)".*/\2/p' "$f" | head -1)
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=2 --window-size=$w,$h --screenshot="$PWD/${f%.svg}.png" "file://$PWD/$f" >/dev/null 2>&1
done
ls -la *.png
