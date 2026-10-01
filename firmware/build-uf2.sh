#!/bin/bash
# Build the .uf2 images from the src/ trees.
#
# These are full 2MB flash images for a Waveshare RP2040-Zero: CircuitPython
# in the low 1MB, the CIRCUITPY FAT filesystem in the high 1MB. Both halves
# in base/ were lifted out of a working board's flash dump (CircuitPython
# 10.1.4, 2026-03-09), so this rebuilds only the filesystem half and leaves
# the interpreter exactly as it was.
#
# To move to a newer CircuitPython, dump a board that is running it --
#   picotool save -a newdump.uf2
# -- and re-split it with mkuf2.py rather than editing base/ by hand.
#
# macOS only: it uses hdiutil to mount the FAT image.
#
# Two runs are not byte-identical: about 70 bytes of FAT directory entries
# hold each file's timestamp, so they move with the clock. The file contents
# are the same. Don't go hunting for a bug there.

set -e
cd "$(dirname "$0")"
BASE_FW=base/circuitpython-10.1.4-rp2040-zero-fw.bin
BASE_FS=base/circuitpython-10.1.4-rp2040-zero-fs.img
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

build() {
    local src=$1 out=$2
    echo "==> $out"
    cp "$BASE_FS" "$WORK/fs.img"
    local dev
    dev=$(hdiutil attach -imagekey diskimage-class=CRawDiskImage -nobrowse \
              "$WORK/fs.img" | awk '{print $1}' | head -1)
    local v=/Volumes/SANDBOX-FX

    # Clear the previous payload; leave the volume's own hidden files alone.
    rm -rf "$v/code.py" "$v/boot.py" "$v/boot_out.txt" "$v/hardware_id.json" \
           "$v/lib" "$v/sd" "$v/settings.toml"

    # cp rather than ditto: ditto fails to create a nested directory on this
    # FAT volume, and silently drops lib/adafruit_display_text with it.
    export COPYFILE_DISABLE=1
    ( cd "$src"
      find . -type d ! -name . -exec mkdir -p "$v/{}" \;
      find . -type f ! -name '.DS_Store' -exec cp "{}" "$v/{}" \; )
    dot_clean -m "$v" 2>/dev/null || true
    find "$v" \( -name '._*' -o -name '.DS_Store' \) -delete 2>/dev/null || true

    # Every file must have landed intact; a full filesystem fails quietly.
    ( cd "$src"
      for f in $(find . -type f ! -name '.DS_Store'); do
          cmp -s "$f" "$v/$f" || { echo "MISMATCH: $f" >&2; exit 1; }
      done )

    df -k "$v" | tail -1
    sync
    hdiutil detach "$dev" -quiet
    cat "$BASE_FW" "$WORK/fs.img" > "$WORK/image.bin"
    python3 mkuf2.py wrap "$WORK/image.bin" "$out"
}

build disk-hid/src        disk-hid/sandbox.uf2
build production-prog/src production-prog/production.uf2
echo "done"
