# JOTA-JOTI Camera 1.4.1 publish audit

## Build checks
- All JavaScript modules pass `node --check`.
- Apps Script source passes a JavaScript syntax check when copied to a `.js` temporary file.
- Local module imports were checked against files in the repository.
- `index.html` asset references were checked and all local assets exist.
- ZIP integrity check passes.
- Service worker cache version is `v25-clean-camera-map-location`.

## Camera layout checks
- Full-screen viewfinder.
- JOTA-JOTI logo and Recording as line at upper left.
- No challenge is directly below the identity.
- Flip, torch, zoom and sound use a fixed vertical right-side rail.
- Zoom presets are placed directly above the shutter controls.
- Shutter row is width-constrained and centred for narrow phones.
- No install banner is displayed over the camera/Dynamic Island area.
- Participant bottom navigation is a five-column white grid that never wraps.

## Map checks
- Map view is created before remote event data is required.
- The map has a Kalgoorlie fallback centre when no location fix is available.
- A first GPS fix recentres the map to the phone location and shows the blue user marker.
- Event pins are optional and are layered on top when returned by the organiser sources.
- Map/List controls remain usable even when there are zero event locations.
- OpenStreetMap tile loading can retry a/b/c subdomains when the configured template uses `{s}`.
- Direct `/map` navigation is converted to the app hash route through GitHub Pages fallback handling.

## Important real-device acceptance test
A physical iPhone/Android test is still required before the public event launch for camera, microphone, GPS permission, PWA installation, Dynamic Island/notch behaviour and real map tile access. The development environment cannot honestly certify those hardware-specific behaviours.
