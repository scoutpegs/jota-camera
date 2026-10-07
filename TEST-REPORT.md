# JOTA-JOTI Camera static production check

Build: light-only participant UI, full-screen camera, Sheet-driven map, Supabase storage and Google Drive backup/fallback.

## Passed static checks

- JavaScript syntax checked for every root `.js` file.
- `Code.gs` syntax checked after temporary `.js` conversion for the Node parser.
- `manifest.webmanifest` parses as valid JSON.
- Every local JavaScript/CSS/image reference used by `index.html` and `admin.html` exists at the repository root.
- Every relative ES module import points to a file in the package.
- Every service-worker shell entry exists.
- Participant stylesheet contains no `prefers-color-scheme: dark` rules.
- Participant stylesheet contains no looping pulse animation.
- No organiser password literal is present in the package source.
- Runtime files are flat at the repository root. No `setup/`, `js/`, `css/`, `icons/` or other runtime subfolders are required.
- Supabase, Apps Script and 30 MB media-limit wiring is present.
- Google Drive fallback payload uses the `base64` field expected by `Code.gs`.
- Supabase upload refresh path uses the active session variable correctly.
- Map data can load from local cache before waiting for the online Google Sheet refresh.
- Map touch handling includes bounded fling/inertia and a parent-tile visual fallback while new tiles load.
- Camera photo framing uses the same viewfinder crop calculation for the saved image.
- PWA manifest is configured for standalone display.

## Live-device limitation

A real phone/tablet acceptance test is still required for camera permission, microphone permission, GPS, torch, hardware lens switching, MediaRecorder formats and physical network conditions. The build environment used for this package blocked the local-browser smoke test, so those hardware behaviours are not claimed as environment-tested.
