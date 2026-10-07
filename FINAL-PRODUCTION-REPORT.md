# JOTA-JOTI Camera - production hardening report

This iteration focuses on reliable map editing, camera lens handling, framing, stabilization and responsive layout. Runtime files remain flat at the GitHub repository root.

## Configuration
- Supabase: `https://fyplxwxwrkilzdhaaftr.supabase.co`
- Apps Script: `https://script.google.com/macros/s/AKfycbxvOz7yfWfznj3E0q5ZuFL3tJRyBP2Z5C-1Ia-2Mla1EdOoKQxjOeIgULX89ciF7NR8/exec`
- Default map: Kalgoorlie, Western Australia (`-30.7489, 121.4658`)

## Automated checks
- 29 JavaScript files: syntax PASS
- ES module relative imports: PASS
- HTML local asset references: PASS
- Runtime subdirectories: 0
- Dark-mode media queries: 0
- Pulse-animation references: 0
- Supabase/Apps Script configuration wiring: PASS
- Admin map loads Supabase first and Sheet second: PASS
- Admin click-to-place pin: PASS
- Admin draggable pin: PASS
- Admin save → Supabase → Google Sheet mirror: PASS (static code-path check)
- Admin Pull from Sheet: PASS (static code-path check)
- Admin Push pins to Sheet: PASS (static code-path check)
- `ChallengeNumbers` retained through the map-pin editor: PASS
- Review X discard action: PASS
- Camera stabilization capability detection: PASS
- `imageStabilizationMode` constraint path: PASS
- `contentHint` motion fallback: PASS
- Device camera enumeration/lens detection: PASS
- 0.5x only shown when the camera exposes an ultra-wide/0.5 capability: PASS
- 1x/2x switch back to main camera when a separate ultra-wide was active: PASS
- Camera source aspect preference 4:3 for wider portrait field of view: PASS
- Exact viewfinder crop path: PASS
- Safe-area/dynamic viewport handling: PASS
- ZIP extraction/integrity: PASS

## Real-device caveat
The browser APIs intentionally expose camera capabilities only to the degree supported by the browser and hardware. Lens labels/capabilities can be unavailable or incomplete, especially before permission. The app therefore detects what the browser reports and only presents 0.5x when it has a usable basis for it. It requests hardware/browser stabilization where exposed and avoids a heavy software stabilizer that could add latency or power use.

A physical acceptance test is still required on the actual iPhone/iPad/Android devices used at the event for camera, microphone, GPS and lens switching.
