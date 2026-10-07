# JOTA-JOTI Camera final UX / reliability pass

## Participant interface

- Participant pages are light-only. There is no user-facing dark-mode switch or dark-mode stylesheet.
- The camera is full-bleed and uses dark viewfinder controls so the live image remains easy to see.
- Buttons have fixed dimensions and stable pressed states. They do not jump, scale or glow when tapped.
- The bottom navigation sits at the device bottom edge and respects safe-area insets when the PWA is installed.
- The camera is the centre tab: Map, Challenges, Camera, My posts, Settings.
- A small install recommendation says that adding JOTA-JOTI to the home screen is recommended for the best full-screen camera experience.
- The camera has a challenge chip, camera tools, mode selector, shutter, sound/flip controls and recent-capture thumbnail.
- The camera viewfinder uses the full available frame rather than a boxed or letterboxed desktop preview.
- Tap shutter captures a photo; press and hold captures video. The recording state uses a visible timer and stable controls.
- The map has a map/list switch, zoom controls, locate control and Google Maps launch action.
- Map locations are readable as cards with category, points and distance when available.
- My posts is map-first and keeps a usable list/detail experience when there are no geotagged posts.

## Reliability improvements

- Remote configuration requests are non-blocking during startup.
- Cached map data is drawn before the online map refresh.
- Service worker cache version is `v21-full-ui-light-map-backup`.
- Map tiles can use the last visible parent tile while a child tile loads.
- Optional thumbnails/audio no longer make a main submission fail when local storage is tight.
- Upload fetch requests have bounded timeouts so a poor connection can fall back to the local queue instead of hanging the interface indefinitely.
- Drive fallback checks registered submission metadata before accepting a direct upload.

## Device-specific acceptance

Physical testing is still required for actual camera, microphone, GPS, lens and torch hardware. The build environment could not complete the browser smoke test because local browser navigation was blocked.
