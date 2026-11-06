# Power View app icon

Created with the built-in image_gen tool (imagegen skill), 2026-10-20. AppIcon.png is the
original generated transparent master. AppIcon.iconset contains standard macOS raster
sizes; AppIcon.icns is included by build-native-macos.sh.

Design prompt: Premium front-facing macOS rounded-square cobalt blue app icon for Power
View. Bold white geometric P incorporating three staggered Gantt bars, cyan accent on the
final bar, generous negative space, subtle bevel and restrained depth. Readable at 32px.
Transparent outside the tile. No words, mockup or watermark.

2026-10-24: Replaced the manually assembled ICNS with output from Apple's iconutil. The
converter fails as Invalid Iconset inside the restricted sandbox but succeeds with
approved access outside it. CFBundleIconFile now explicitly names AppIcon.icns and the
bundle version is 2. Finder Get Info visually displayed both small and large custom icons
with Power View not running. Dock automation timed out, so pinned-Dock refresh was not
visually verified.
