# JOTA-JOTI button/path audit

This is a static event-hook audit of the production build. It checks that key interactive controls have an implementation hook; it is not a replacement for physical-device interaction testing.

## Camera
- Shutter → `onShutter`
- Photo/video mode buttons → `setMode`
- Challenge chip → `chooseChallenge`
- Clear challenge X → clears `app.ctx.challenge`
- Sound button → `chooseSound`
- Flip → `cam.flip()`
- Torch → `cam.setTorch()`
- Zoom 0.5/1/2 → `setPresetZoom()`
- Zoom slider → `cam.setZoom()`
- My posts/gallery button → `app.go('posts')`

## Review
- Discard X → `discard(sub.id)` + camera route
- Retake → `leave()`
- Next → submit route
- Location retry → `patchSub()`
- Challenge chip → `patchSub()`

## Admin map
- Add map pin → opens pin editor
- Click map → writes latitude/longitude
- Drag map pin → writes latitude/longitude
- Use my location → writes current coordinates
- Save pin → Supabase write + Apps Script mirror
- Clear → resets editor
- Pull from Google Sheet → Apps Script `syncSheet`
- Push pins to Sheet → Apps Script `syncPinsToSheet`
- Edit pin → opens editor
- Delete pin → Supabase delete + Sheet mirror

## Admin bulk media/audio
- Select page / all results → updates selection sets
- Approve / Reject → bulk review actions
- Download selected / all → archive paths
- Delete selected / all → protected delete paths
- Add audio → audio editor/upload flow
- Download all audio → archive path
- Delete all audio → protected bulk delete path

No runtime folders are required for these handlers; all referenced modules are in the GitHub repository root.

## Version 1.5.0 final cleanup

This pass removed participant footers and redundant tab Back buttons, moved camera flip into the top control rail, simplified the camera control row for narrow phones, forced light colour-scheme behaviour, removed backdrop blur from the application surfaces, fixed the list and chevron icons used by the map and My posts views, and kept destructive media actions behind confirmation dialogs.


## 1.5.0 visual/navigation rebuild
- Participant footer chrome removed.
- Camera keeps the install recommendation in normal page flow, so it never sits over the Dynamic Island/camera controls.
- JOTA-JOTI identity and participant name are top-left, with the challenge directly underneath.
- Camera flip, torch, zoom and sound are grouped in a compact vertical rail on the right.
- Shutter, last-capture thumbnail and mode/zoom controls are centered inside a safe-width lower control deck.
- The Map/List switch is now a dedicated control; the old list icon button was removed.
- Direct paths such as `/map` are converted to the app hash route by `404.html`/`main.js`.
- All dynamically created buttons default to `type=button` unless a form explicitly requests `submit`.
