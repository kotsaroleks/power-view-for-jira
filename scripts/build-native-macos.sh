#!/bin/sh
set -eu
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
scratch_path="${TMPDIR:-/tmp}/power-view-native-build"
export CLANG_MODULE_CACHE_PATH="${TMPDIR:-/tmp}/power-view-clang-cache"
export SWIFTPM_MODULECACHE_OVERRIDE="${TMPDIR:-/tmp}/power-view-module-cache"
swift build --disable-sandbox --package-path "$repo_root/apps/macos" --scratch-path "$scratch_path" -c debug
binary_path=$(swift build --disable-sandbox --package-path "$repo_root/apps/macos" --scratch-path "$scratch_path" -c debug --show-bin-path)
dist_path="$repo_root/apps/macos/dist"
mkdir -p "$dist_path"
staging_path=$(mktemp -d "$dist_path/.native-build.XXXXXX")
trap 'rm -rf "$staging_path"' EXIT HUP INT TERM
app_path="$staging_path/Power View.app"
mkdir -p "$app_path/Contents/MacOS"
cp "$binary_path/PowerView" "$app_path/Contents/MacOS/PowerView"
cp "$repo_root/apps/macos/Info.plist" "$app_path/Contents/Info.plist"
mkdir -p "$app_path/Contents/Resources"
cp "$repo_root/apps/macos/Resources/AppIcon.icns" "$app_path/Contents/Resources/AppIcon.icns"
cat "$repo_root/packages/ui/src/tokens.css" "$repo_root/apps/web/src/styles/global.css" > "$app_path/Contents/Resources/report-print.css"
python3 - "$repo_root" "$app_path" <<'PY'
import json, os, sys
from pathlib import Path
root, app = map(Path, sys.argv[1:])
source = root / '.secrets/day-off-github.local.json'
target = app / 'Contents/Resources/day-off-github.json'
try:
    raw = os.environ.get('POWERVIEW_DAY_OFF_GITHUB_CONFIG')
    config = json.loads(raw) if raw else json.loads(source.read_text()) if source.exists() else None
    if config is not None:
        fields = ('owner', 'repo', 'branch', 'root', 'token')
        if not isinstance(config, dict) or not all(isinstance(config.get(key), str) and config[key].strip() for key in fields):
            raise ValueError()
        target.write_text(json.dumps({key: config[key] for key in fields}))
        target.chmod(0o600)
    elif target.exists():
        target.unlink()
except Exception:
    raise SystemExit('Invalid shared Day Off build configuration; no credentials were printed.')
PY
if [ -n "${POWER_VIEW_GOOGLE_CLIENT_ID:-}" ]; then
  /usr/libexec/PlistBuddy -c "Add :PowerViewGoogleClientID string $POWER_VIEW_GOOGLE_CLIENT_ID" "$app_path/Contents/Info.plist"
fi
if [ -n "${POWER_VIEW_GOOGLE_CLIENT_SECRET:-}" ]; then
  /usr/libexec/PlistBuddy -c "Add :PowerViewGoogleClientSecret string $POWER_VIEW_GOOGLE_CLIENT_SECRET" "$app_path/Contents/Info.plist"
fi
plutil -lint "$app_path/Contents/Info.plist"
codesign --force --sign - "$app_path"
# Do not overwrite an executable that may still be mapped by the user's running app.
# Keep the previous bundle intact; publish the fully built replacement by rename.
python3 - "$app_path" "$dist_path" <<'PY'
import os, sys, uuid
from pathlib import Path
staged, dist = map(Path, sys.argv[1:])
target = dist / 'Power View.app'
previous = None
if target.exists() or target.is_symlink():
    backups = dist / '.previous-builds'
    backups.mkdir(exist_ok=True)
    previous = backups / ('Power View-' + uuid.uuid4().hex + '.app')
    os.rename(target, previous)
try:
    os.rename(staged, target)
except BaseException:
    if previous is not None:
        os.rename(previous, target)
    raise
PY
printf '%s\n' "$dist_path/Power View.app"
