# Handoff: Idento Logo & App Icon System

## Overview
Brand mark for Idento — an event check-in / badge-printing product. The mark is an outlined attendee badge (lanyard slot, avatar silhouette) with a green "checked-in" corner accent. This package contains production-ready SVG assets plus the HTML design reference.

## About the Design Files
`Idento Logo.dc.html` (+ `support.js`) is a **design reference created in HTML** — the exploration canvas showing all rounds and contexts. It is not production code. The task is to integrate the **SVG assets in `assets/`** into the target codebase (favicons, app icons, headers) and, where needed, re-export raster sizes from them.

## Fidelity
**High-fidelity.** Geometry, colors, and stroke weights are final. Use the SVGs as-is; do not redraw.

## Design Tokens
- Brand green: `#00935E` (hover/dark shade in product: `#00714A`, tint: `#E7F5EE`)
- Ink: `#09090B`
- Wordmark font: **Inter 800**, letter-spacing `-0.02em` (Latin "Idento" / Cyrillic "Иденто")

## Mark Geometry (viewBox 0 0 64 64)
The main badge is centered at (32,32); the check disc is a corner accent that slightly overflows the badge. **Never center the mark by its bounding box** — align by the badge rect, or the composition looks off-center (this was a bug we fixed; the circular Android icon shows it worst).
- Badge: rect x12 y8 w40 h48 rx10, stroke 5 (no fill)
- Lanyard slot: rect x26 y14 w12 h4.5 rx2.25
- Head: circle (32,30) r6.5; shoulders: `M22 48 a10 10 0 0 1 20 0 Z`
- Check disc: circle (50,49) r10, white ✓ stroke 3, round caps
- Separation ring: the disc sits in a r13.5 gap. In `logo-mark*.svg` the gap is a transparent **mask** (works on any background). In the app-icon tiles it is baked as a tile-colored stroke.

## Simplification Tiers (legibility)
1. **≥ 40 px** — full mark (`logo-mark.svg`)
2. **24–39 px** — drop the lanyard slot, heavier strokes (`favicon-32.svg`)
3. **≤ 20 px** — filled green tile with white avatar silhouette only, no check (`favicon-16.svg`)
4. **Tray/menu-bar** — monochrome template, no check (`tray-icon-template.svg`, uses `currentColor`)

## Lockups
- Horizontal: mark height = cap-height × ~1.35; gap between mark and wordmark ≈ 30% of mark width; baseline-align wordmark to badge bottom.
- Vertical: wordmark centered under mark, gap ≈ 25% of mark height.
- Clear space: ≥ 25% of mark height on all sides.
- Minimum lockup height: 20 px (below that, use mark alone).

> **In-product convention (idento web/panel/landing):** no standalone wordmark SVG is
> shipped. Where a surface already renders the text "Idento"/"Иденто" as its logo, the
> mark (`logo-mark.svg`) is placed beside that existing text label; the image is
> decorative (`alt=""`). Where the mark stands alone (e.g. the panel login card) it
> carries `alt="Idento"`.

## Assets
| File | Use |
|---|---|
| `logo-mark.svg` | Primary mark, any light background (masked ring) |
| `logo-mark-white.svg` | Dark backgrounds |
| `logo-mark-mono.svg` | Print / single-color documents |
| `favicon-32.svg` | Favicon 24–48 px (export 32/48 PNG) |
| `favicon-16.svg` | Favicon 16 px (export 16 PNG) |
| `app-icon-ios.svg` | iOS App Store (export 1024²; iOS applies its own mask — keep rx≈22%) |
| `app-icon-android-circle.svg` / `-squircle.svg` | Android adaptive foreground previews; for a true adaptive icon put the white mark on a 66% safe-zone layer over a `#00935E` background layer |
| `app-icon-macos.svg` | macOS (squircle with margins, per HIG) |
| `app-icon-windows.svg` | Windows (near-square, edge-to-edge) |
| `app-icon-dark.svg` | Dark-tile variant (e.g. Kiosk app) |
| `tray-icon-template.svg` | System tray / menu bar, inherits currentColor |

## Files
- `Idento Logo.dc.html`, `support.js` — design reference (open the HTML in a browser; Round 3 at top is final)
