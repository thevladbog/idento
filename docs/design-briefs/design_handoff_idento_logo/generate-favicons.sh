#!/usr/bin/env bash
# Regenerates runtime favicon/app-icon binaries from the handoff SVGs and
# distributes them into web/, panel/, and landing/ public dirs.
# Requires: rsvg-convert (librsvg), magick (ImageMagick 7).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSETS="$HERE/assets"
ROOT="$(cd "$HERE/../../.." && pwd)"   # docs/design-briefs/design_handoff_idento_logo -> repo root
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

# favicon.ico — size-tiered (16 = filled tile, 32/48 = simplified badge)
rsvg-convert -w 16 -h 16 "$ASSETS/favicon-16.svg" -o f16.png
rsvg-convert -w 32 -h 32 "$ASSETS/favicon-32.svg" -o f32.png
rsvg-convert -w 48 -h 48 "$ASSETS/favicon-32.svg" -o f48.png
magick f16.png f32.png f48.png favicon.ico

# opaque tile PNGs — apple-touch + PWA "any"
rsvg-convert -w 180 -h 180 "$ASSETS/app-icon-ios.svg" -o apple-touch-icon.png
rsvg-convert -w 192 -h 192 "$ASSETS/app-icon-ios.svg" -o icon-192.png
rsvg-convert -w 512 -h 512 "$ASSETS/app-icon-ios.svg" -o icon-512.png

# maskable — full-bleed green, white mark @~60% centered by the badge rect
cat > maskable.svg <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#00935E"/>
  <g transform="translate(102.4,102.4) scale(4.8)">
    <rect x="12" y="8" width="40" height="48" rx="10" fill="none" stroke="#fff" stroke-width="5"/>
    <rect x="26" y="14" width="12" height="4.5" rx="2.25" fill="#fff"/>
    <circle cx="32" cy="30" r="6.5" fill="#fff"/>
    <path d="M22 48 a10 10 0 0 1 20 0 Z" fill="#fff"/>
    <circle cx="50" cy="49" r="10" fill="#fff" stroke="#00935E" stroke-width="3.5"/>
    <path d="M45.7 49 l3 3 L54.6 45.4" fill="none" stroke="#00935E" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>
SVG
rsvg-convert -w 512 -h 512 maskable.svg -o maskable-512.png

# distribute into each app's public dir
for app in web panel landing; do
  DEST="$ROOT/$app/public"
  cp favicon.ico apple-touch-icon.png icon-192.png icon-512.png maskable-512.png "$DEST/"
  cp "$ASSETS/favicon-32.svg" "$DEST/favicon.svg"
  cp "$ASSETS/logo-mark.svg" "$ASSETS/logo-mark-white.svg" "$DEST/"
done

echo "Distributed to web/panel/landing public dirs."
magick identify "$ROOT/web/public/favicon.ico"

# ── desktop (Tauri) icons — dark kiosk tile ──
rsvg-convert -w 1024 -h 1024 "$ASSETS/app-icon-dark.svg" -o kiosk-1024.png

# macOS: same dark tile inset with HIG margins (geometry of app-icon-macos.svg, dark fill)
cat > kiosk-macos.svg <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
  <rect x="6" y="6" width="108" height="108" rx="26" fill="#09090B"/>
  <g transform="translate(28,28) scale(1)"><rect x="12" y="8" width="40" height="48" rx="10" fill="none" stroke="#fff" stroke-width="5"/><rect x="26" y="14" width="12" height="4.5" rx="2.25" fill="#fff"/><circle cx="32" cy="30" r="6.5" fill="#fff"/><path d="M22 48 a10 10 0 0 1 20 0 Z" fill="#fff"/><circle cx="50" cy="49" r="10" fill="#00935E" stroke="#09090B" stroke-width="3.5"/><path d="M45.7 49 l3 3 L54.6 45.4" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g>
</svg>
SVG
rsvg-convert -w 1024 -h 1024 kiosk-macos.svg -o kiosk-macos-1024.png

(cd "$ROOT/desktop" && npx tauri icon "$WORK/kiosk-1024.png")
mkdir -p "$WORK/macos-icons"
(cd "$ROOT/desktop" && npx tauri icon "$WORK/kiosk-macos-1024.png" -o "$WORK/macos-icons")
cp "$WORK/macos-icons/icon.icns" "$ROOT/desktop/src-tauri/icons/icon.icns"

# tray/menu-bar template (black glyph + alpha; macOS recolors via iconAsTemplate)
rsvg-convert -w 32 -h 32 --stylesheet <(echo '*{color:#000}') "$ASSETS/tray-icon-template.svg" -o "$ROOT/desktop/src-tauri/icons/tray-icon.png" 2>/dev/null \
  || rsvg-convert -w 32 -h 32 "$ASSETS/tray-icon-template.svg" -o "$ROOT/desktop/src-tauri/icons/tray-icon.png"
rsvg-convert -w 64 -h 64 "$ASSETS/tray-icon-template.svg" -o "$ROOT/desktop/src-tauri/icons/tray-icon@2x.png"
echo "Desktop icons regenerated in desktop/src-tauri/icons/."
