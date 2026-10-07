# JOTA-JOTI Camera 1.5.0

This release brings the standalone demo visual language into the real application.

## Camera
- Fixed right-side camera rail with Flip, Torch, Zoom and Music.
- Selected music is shown as active and is mixed into live MediaRecorder video when the browser supports Web Audio + MediaRecorder.
- Improved custom SVG symbols and stable light controls.
- Bottom capture controls remain centred inside the viewport.

## Map
- Uses the canonical OpenStreetMap tile endpoint by default.
- Map is created immediately and resized again after navigation so hidden-view sizing cannot leave a blank canvas.
- The map always has a Kalgoorlie base view even when there are zero organiser pins.
- The user's location is overlaid when the browser grants location permission.
- Clicking a challenge/location marker opens a compact in-map popup with the description, instructions and capture actions.
- The list remains available when tile loading is slow/offline.

## Challenges
- Description and instructions are shown wherever challenge details are available.
- Map challenge popups reuse the same data.

## Music
- Music is visible on the right-side camera rail in both Photo and Video mode.
- Selecting a sound before recording loads the sound locally and passes it into the live recording mixer.
