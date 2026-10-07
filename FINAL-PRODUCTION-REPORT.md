# JOTA-JOTI Camera production hardening report

This build is a cleaned, flat-root production package for the Kalgoorlie Scout Group JOTA-JOTI camera app.

## Final design

- Light-only participant application.
- Purple action colour with amber for active/selected states.
- Full-screen camera with a Snapchat-style control arrangement: top utility controls, challenge chip, lens/mode controls, large shutter and a white bottom navigation bar.
- Stable button sizing and pressed states with no jump/scale interaction.
- Safe-area and dynamic viewport handling for installed phone apps.
- Install recommendation for the home screen/PWA experience.

## Camera

The camera prefers a portrait-friendly 4:3 source, uses the same crop in the viewfinder and saved photo, supports tap-photo and hold-video, detects supported zoom/torch/lenses, and cleans up the camera stream when the view is left.

## Map

The organiser Google Sheet is the map source for the public app. `Map Settings` supplies the map URL and initial centre/zoom. `Locations` supplies the location list, coordinates, categories, points, active state and challenge-number links.

The public map first uses cached locations where available, then refreshes from Apps Script. The in-app map has touch pan, pinch/wheel zoom, locate, a list view and a visual parent-tile fallback while fresh tiles load.

Default event centre: Kalgoorlie, Western Australia (`-30.7489, 121.4658`).

## Backup

Normal storage:

`Phone -> Supabase Storage -> Google Drive`

Capacity fallback:

`Phone -> Apps Script -> Google Drive`

The phone keeps the original media until the required backup confirmation is seen. The Apps Script fallback validates the submission ID, size, MIME type, file count and decoded base64 size before writing to Drive.

## Security configuration

The package contains only the browser-safe Supabase publishable key and the non-secret Apps Script client key. The organiser password is intentionally excluded and must be stored in Apps Script Script Properties as `SUPABASE_PASSWORD`.

## Static checks

- JavaScript syntax: PASS.
- Apps Script syntax check: PASS through a temporary Node-compatible copy.
- Relative imports and local assets: PASS.
- Service-worker shell: PASS.
- PWA manifest JSON: PASS.
- No participant dark-mode CSS rules: PASS.
- No looping/pulse animations in participant CSS: PASS.
- No organiser password literal: PASS.
- Flat root deployment layout: PASS.
- Final ZIP extraction/integrity: PASS.

## Physical-device note

Real iPhone/iPad/Android camera, microphone, GPS, torch and hardware-lens behaviour must still be checked on the actual event devices. The build environment blocked the final local-browser smoke test, so this report does not claim a successful hardware run.

## Version 1.3.1 final cleanup

This pass removed participant footers and redundant tab Back buttons, moved camera flip into the top control rail, simplified the camera control row for narrow phones, forced light colour-scheme behaviour, removed backdrop blur from the application surfaces, fixed the list and chevron icons used by the map and My posts views, and kept destructive media actions behind confirmation dialogs.
