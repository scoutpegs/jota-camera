# JOTA-JOTI Camera Button Audit

Generated as part of the final flat-root production review.

## Participant UI

All buttons created through the shared `el('button', ...)` helper include a direct click handler, with the onboarding name-step Continue button intentionally wired through a normal `addEventListener('click', ...)` after creation. Navigation buttons are wired in `main.js`.

- `main.js`: 2 created, 2 direct click handlers, 2 additional property/listener assignments
- `camera-ui.js`: 14 created, 14 direct click handlers
- `map-view.js`: 15 created, 15 direct click handlers
- `challenges.js`: 5 created, 5 direct click handlers
- `posts.js`: 10 created, 10 direct click handlers
- `settings.js`: 7 created, 8 handler declarations (includes the hidden test-mode/version interactions)
- `sounds.js`: 12 created, 12 direct click handlers
- `review.js`: 8 created, 8 direct click handlers
- `onboard.js`: 2 created, 1 direct handler + 1 click listener
- `install.js`: 2 created, 2 direct click handlers
- `admin.js`: runtime HTML buttons are wired through explicit `.onclick` assignments and event handlers

Total dynamically created participant buttons audited: **77**. No dynamically created participant button was found without a click handler or an intentional later listener assignment.

## Static HTML

- `index.html`: 1 button, settings handler supplied by `main.js`
- `admin.html`: 1 button, logout handler supplied by `admin.js`

## Admin actions audited

Media: filter, select page, select all, approve, reject, download selected, download all, delete selected, delete all, CSV export, detail actions.

Sounds: add audio, preview, edit, delete, download all audio, delete all audio.

Challenges: create, edit, start photo, start video, view on map.

Map: open sheet, open Google Maps, sync Sheet to Supabase, map controls.

Settings / backup / health: navigation and action controls are explicitly wired.
