#!/bin/sh
set -eu
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
sh "$repo_root/scripts/build-native-macos.sh"
app_path="$repo_root/apps/macos/dist/Power View.app"
codesign --verify --deep --strict "$app_path"
archive="$repo_root/apps/macos/dist/power-view-macos-arm64.zip"
ditto -c -k --sequesterRsrc --keepParent "$app_path" "$archive"
shasum -a 256 "$archive" > "$archive.sha256"
printf '%s\n' "$archive"
