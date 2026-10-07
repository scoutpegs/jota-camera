# JOTA-JOTI Camera 1.4.1 visual and map cleanup

This build keeps the JOTA-JOTI purple and yellow colours and the supplied logo while simplifying the participant interface.

## Camera
- Full bleed viewfinder.
- JOTA-JOTI logo and Recording as line in the upper left.
- No challenge directly beneath it.
- Flip, torch, zoom and sound controls sit in a fixed vertical rail at the right.
- Zoom controls sit directly above the capture controls.
- Capture row stays centred and width constrained on narrow phones.
- No install banner over the camera or Dynamic Island area.

## Navigation
- Five-column white bottom bar.
- Buttons stay on one row using CSS Grid.
- Purple marks the selected tab and yellow is the selection indicator.
- No participant footer.
- No redundant Back button where bottom navigation is present.

## Map
- Map is created immediately and never depends on pins being returned.
- A live location fix recentres the map to the phone on first fix.
- Without a location fix, the organiser Kalgoorlie centre is shown.
- Event pins are layered on top when available.
- The list remains available separately.
- OpenStreetMap tile loading retries across a/b/c tile hosts when the configured URL supports `{s}`.
- `#/map` and direct `/map` navigation are supported through the app router and GitHub Pages fallback.

## Reliability
- Dynamically-created buttons default to `type="button"` unless another type is explicitly provided.
- Service worker cache was bumped to prevent older CSS/JS remaining on phones after deployment.
