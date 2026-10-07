# JOTA-JOTI Camera - Final Production Review

## Scope

Final flat-root build for GitHub Pages. The participant application is light-mode, camera-first, offline-safe, and uses the organiser Google Sheet for map settings and location data through Apps Script. Media remains private to organisers by default.

## Build checks

- JavaScript syntax: PASS for 29 `.js` files.
- Google Apps Script syntax: PASS using a temporary `.js` syntax check.
- Flat repository layout: PASS. No runtime subdirectories are present.
- Root `index.html`: PASS.
- Root `admin.html`: PASS.
- GitHub Pages `/admin` fallback: PASS via included `404.html` router.
- PWA manifest paths: PASS.
- Service worker shell paths: PASS.
- New Apps Script deployment URL present: PASS.
- Previous Apps Script URL absent: PASS.
- Organiser password absent from source files: PASS.
- Light-only colour-scheme: PASS. No dark `prefers-color-scheme` rule remains.

## Interaction checks

- Camera / video mode switching: wired.
- Swipe left/right photo/video switching: wired.
- Pinch zoom: wired.
- 1x / 2x quick zoom: wired, with 2x hidden if hardware zoom does not support it.
- Camera flip: wired.
- Torch: wired when supported.
- Sound picker: wired.
- Challenge picker: wired.
- Photo shutter: wired.
- Video start/stop: wired.
- Review next/retake/delete: wired.
- Submit: wired.
- Map zoom, locate, list, marker actions: wired.
- My Posts memory marker, rail, locate, show-on-map, retry, delete: wired.
- Settings actions: wired.
- Admin media and sound bulk actions: wired.

## Reliability / performance review

- `loadConfig()` does not block the first camera screen on remote configuration refresh.
- My Posts thumbnail loads are concurrency-capped rather than fired as an unbounded burst.
- My Posts map clustering uses screen-space grid bucketing rather than an O(n²) full scan.
- Map tile failures invalidate/redraw the map while the Boulder fallback remains visible.
- Failed map tile placeholders are not drawn as empty outlined boxes.
- Admin bulk downloads are split into 180 MiB target ZIP parts to reduce peak browser memory pressure.
- Bulk media deletion uses batched storage/database operations.
- Camera streams are stopped when leaving the camera or when the page becomes hidden.
- Offline recording state is stored in IndexedDB and can be recovered after interruption.

## Visual QA

Eight representative UI screens were rendered for review: welcome, camera, map, challenges, My Posts, settings, admin media, and admin audio. The contact sheet was reviewed for spacing, hierarchy, contrast, control sizing, and overall JOTA-JOTI consistency.

## Device matrix

Responsive CSS was reviewed against compact phone, regular phone, large phone/tablet, and landscape constraints. Actual camera/microphone/GPS hardware access cannot be granted in this build environment, so physical-device acceptance testing is still required before the event.

## Final limitation

A live Supabase upload, live Apps Script request, and hardware camera/microphone/GPS test could not be executed from this environment. Those require the deployed GitHub Pages site and real devices/accounts.
