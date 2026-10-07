# JOTA-JOTI Camera 1.5.0 final audit

## Included
- Real app code for GitHub Pages
- Supabase integration
- Google Apps Script / Google Drive backup bridge
- SQL setup
- PWA/service worker
- JOTA-JOTI logo and app icons
- Participant camera, map, challenges, My Posts and Settings
- Organiser admin page

## Visual changes
- Camera follows the standalone demo layout: JOTA-JOTI identity at upper left, No challenge beneath it, fixed right-side Flip/Torch/Zoom/Music rail, centred capture controls.
- Music is always available from the camera rail and is mixed into live video recordings when the browser supports the Web Audio + MediaRecorder path.
- Bottom navigation uses a fixed five-column grid and does not wrap.
- Participant UI remains light with JOTA-JOTI purple and yellow accents.

## Map changes
- Canonical OpenStreetMap tile endpoint is the default.
- Map is instantiated immediately and resized after route visibility changes.
- A map is shown even when the organiser has zero locations.
- Browser location is overlaid when location permission is granted; otherwise the map uses the configured Kalgoorlie centre.
- Challenge/location markers open a compact popup containing available descriptions, instructions, points and capture actions.
- Map/List remains usable when network tiles or organiser data are unavailable.

## Challenge data
- Supabase challenges already support `description` and `instructions`.
- Organiser challenge forms expose description and instructions.
- The participant Challenges page and Map popup consume the same fields.

## Static validation
- All JavaScript files pass `node --check`.
- `Code.gs` passes JavaScript syntax validation in a Node-compatible syntax check.
- Local relative JavaScript imports were checked for missing files.
- `index.html` contains no participant footer.
- `app.css` contains no prefers-color-scheme dark-mode branch.
- Service-worker cache version is bumped to prevent stale camera/map UI from surviving a publish.

## Device test limitation
Real iPhone/Android camera hardware, Dynamic Island rendering and GPS permission prompts cannot be certified from this build environment. Those require a physical device or device emulator with the relevant browser permissions.
