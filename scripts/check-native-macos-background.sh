#!/bin/sh
# Render production SwiftUI views to files. Never launch/control the user's app.
set -eu
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
artifact_path="${1:-${TMPDIR:-/tmp}/power-view-background-check}"
mkdir -p "$artifact_path"
artifact_path=$(CDPATH= cd -- "$artifact_path" && pwd)
printf '{"status":"running"}\n' > "$artifact_path/verification.json"
export CLANG_MODULE_CACHE_PATH="${TMPDIR:-/tmp}/power-view-clang-cache"
export SWIFTPM_MODULECACHE_OVERRIDE="${TMPDIR:-/tmp}/power-view-module-cache"
scratch_path="${TMPDIR:-/tmp}/power-view-swift-build"
run_checks() {
  swift build --disable-sandbox --package-path "$repo_root/apps/macos" --scratch-path "$scratch_path" || return 1
  binary_path=$(swift build --disable-sandbox --package-path "$repo_root/apps/macos" --scratch-path "$scratch_path" --show-bin-path) || return 1
  checker_path="$artifact_path/Power View Background Check.app"
  mkdir -p "$checker_path/Contents/MacOS" || return 1
  cat > "$checker_path/Contents/Info.plist" <<'PLIST' || return 1
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.powerview.background-check</string>
<key>CFBundleExecutable</key><string>BackgroundCheck</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSBackgroundOnly</key><true/>
</dict></plist>
PLIST
  set -- -parse-as-library -swift-version 6 -D POWER_VIEW_BACKGROUND_CHECK -target arm64-apple-macos14.0 \
    -I "$binary_path" "$binary_path/PowerViewCore.o"
  for source_path in "$repo_root/apps/macos/Sources/PowerView/"*.swift; do
    set -- "$@" "$source_path"
  done
  swiftc "$@" "$repo_root/apps/macos/Tests/PowerViewApplicationTests/NativeTimeFixtureTransport.swift" "$repo_root/apps/macos/Tools/ChromeSceneFixtureTransport.swift" "$repo_root/apps/macos/Tools/BackgroundInterfaceChecks.swift" \
    -o "$checker_path/Contents/MacOS/BackgroundCheck" || return 1
  # Execute only the background-only checker. Never use `open`, desktop input or the user's app bundle.
  if [ -d "$repo_root/apps/macos/dist/Power View.app" ]; then
    "$checker_path/Contents/MacOS/BackgroundCheck" "$artifact_path" "$repo_root/apps/macos/dist/Power View.app"
  else
    "$checker_path/Contents/MacOS/BackgroundCheck" "$artifact_path"
  fi
}
run_checks > "$artifact_path/check.log" 2>&1 || {
    printf '{"status":"failed"}\n' > "$artifact_path/verification.json"
    cat "$artifact_path/check.log"
    exit 1
  }
printf 'Background interface checks passed. Artifacts: %s\n' "$artifact_path"
