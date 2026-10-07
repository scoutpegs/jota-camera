# JOTA-JOTI Camera final production test report

Build target: flat-root GitHub Pages deployment with `admin.html` organiser access.

## Static verification

- All root JavaScript modules: PASS (`node --check`).
- Google Apps Script source: PASS after syntax conversion for the Node parser.
- Relative module imports: PASS.
- Local HTML/runtime asset references: PASS.
- Service-worker shell: PASS, all listed root files exist.
- PWA manifest: PASS, valid JSON.
- Participant dark-mode rules: PASS, none present.
- Looping/pulse animation declarations in participant CSS: PASS, none present.
- Organiser password in package: PASS, not present.
- Runtime layout: PASS, flat repository root.
- Final package extraction/integrity: PASS.

## Camera path

- Live `getUserMedia` camera path is present.
- Camera stream prefers a 4:3 source for portrait field of view and uses a matching crop for saved photos.
- Tap shutter -> photo and press/hold shutter -> video paths are present.
- MediaRecorder type selection uses `isTypeSupported` with browser-specific fallbacks.
- Pinch/slider zoom and device zoom capability handling are present.
- Torch and front/rear switching are shown only when supported.
- Native camera/file fallback exists for browsers without a usable live capture path.
- Camera stops its stream when the view is left so it does not hold the camera open in the background.

## Map and challenge path

- Google Sheet `Map Settings` and `Locations` are the public map source.
- Cached pins can appear before the online Sheet refresh finishes.
- The in-app map supports pan, pinch/wheel zoom and bounded fling/inertia.
- A parent tile can be drawn while a higher-resolution tile is loading.
- Location list view remains available without a working map tile connection.
- Challenge numbers on map locations can resolve to the matching challenge actions.
- My posts includes geotagged memories and a usable empty state.

## Backup path

Normal path:

`Phone -> Supabase Storage -> Apps Script -> Google Drive`

Capacity fallback:

`Phone -> Apps Script -> Google Drive`

The app keeps the local media until the required backup state is confirmed.

`Code.gs` validates fallback submission IDs, registered size/type and the base64 payload before writing to Drive.

## Live test limitation

The supplied environment prevented a completed Playwright/local-browser smoke test, and it cannot exercise real phone camera hardware. Before the event, run the physical test sequence in `SETUP.md` on the actual iPhone/iPad/Android devices that will be used.

## Version 1.5.0 final cleanup

This pass removed participant footers and redundant tab Back buttons, moved camera flip into the top control rail, simplified the camera control row for narrow phones, forced light colour-scheme behaviour, removed backdrop blur from the application surfaces, fixed the list and chevron icons used by the map and My posts views, and kept destructive media actions behind confirmation dialogs.
