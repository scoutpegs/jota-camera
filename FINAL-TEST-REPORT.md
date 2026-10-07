# JOTA-JOTI Camera / Media Platform - Final Product Test Report

Build target: flat-root GitHub Pages deployment with `/admin/` compatibility.

## Static checks

- JavaScript syntax: PASS for all 29 root `.js` files.
- CSS parsing: PASS for `app.css` and `admin.css`.
- Local HTML references: PASS for `index.html`, `admin.html`, and `admin/index.html`.
- Relative JavaScript module references: PASS.
- Current Google Apps Script deployment URL: present.
- Previous Apps Script deployment URL: absent.
- Organiser password literal: absent from the package source.
- Service-worker shell list: all listed runtime files exist.
- PWA manifest: valid JSON.
- Tile-map project/unproject round trip: PASS at the Kalgoorlie default centre.
- Final ZIP extraction/integrity: PASS.

## Camera and recording checks

- Camera permission requested immediately after participant name: PASS by source inspection.
- Microphone requested in the same first-run permission step: PASS by source inspection.
- Live camera uses `getUserMedia`: PASS.
- Device-specific MediaRecorder format selection uses `MediaRecorder.isTypeSupported`: PASS.
- Recorder construction has a native fallback and cleans up audio resources on failure: PASS.
- Photo capture path: PASS by source inspection.
- Video recording path: PASS by source inspection.
- 1x / 2x zoom controls plus pinch zoom: PASS.
- Front/rear camera switch: PASS where the device exposes it.
- Torch: shown only where supported.
- Native OS camera/file capture fallback for browsers without working live camera recording: PASS.
- Offline recording stores media in IndexedDB before upload: PASS by source inspection.
- Automatic retry after connection returns: PASS by source inspection.

## Map and challenge checks

- Boulder default centre: PASS.
- Map renders with zero event pins and zero submissions: PASS by source inspection and fallback renderer.
- Live OpenStreetMap tiles layer over the fallback when available.
- Google Sheet is the source for map settings and Locations data.
- `ChallengeNumbers` from a Google Sheet location is resolved to the corresponding challenge: PASS.
- Challenge markers open challenge actions: PASS.
- Optional radius enforcement is displayed and enforced when enabled: PASS.
- Current participant location and reported accuracy are shown when location is available: PASS.
- My Posts contains a map-first memory view with geotagged memories: PASS.
- My Posts has an empty state that still leaves the map usable: PASS.

## Admin checks

- `/admin/` route helper redirects to `admin.html`: PASS.
- Media library search/filter/pagination: present.
- Download selected media: present.
- Download all media: present.
- Large media exports are split into multiple ZIP parts instead of requiring one giant in-memory archive: PASS by source inspection.
- Delete selected media: present.
- Delete all media: present with explicit confirmation.
- Add audio accepts MP3 files and stores them in the sounds bucket: present.
- Download all audio: present.
- Delete all audio: present with explicit confirmation.
- Admin challenge editor and location linkage: present.
- Google Sheet map/location inspection and sync action: present.

## Product/UI checks

- Light mode only: PASS.
- Global `A` admin button removed from participant navigation: PASS.
- Camera occupies the full app viewport and hides the global navigation while active: PASS.
- Safe-area support for notched/home-indicator devices: PASS.
- Visual viewport resize handling for mobile browser UI changes: PASS.
- Small-phone, tablet, portrait, and landscape CSS breakpoints are present.
- Unnecessary camera blur/backdrop effects removed.
- Map memory markers use the light visual system.
- Empty states include useful next actions rather than decorative placeholders.

## Local HTTP smoke test

A local HTTP server successfully served the main runtime pages/assets, including the app shell, camera modules, map modules, admin page, manifest, service worker, logo and icon files.

## Device/live-service limitation

Physical camera, microphone, GPS and PWA installation tests on every iPhone, iPad and Android model cannot be performed inside this build environment. The code was hardened for the supported browser APIs and multiple responsive viewport classes were checked, but final hardware acceptance still needs to be performed from the published GitHub Pages site on real devices.

Live Supabase and Google Apps Script requests are also not executable from this build environment, so those final account-side service checks remain deployment acceptance tests.
