# JOTA-JOTI Camera

JOTA-JOTI Camera is a phone-first photo and video app for Kalgoorlie Scout Group.

**Maker credit:** Made by Hunter Miller from Boulder Scout Hall

The public site is a flat-root GitHub Pages PWA. The organiser page is `admin.html`.

## Included

The package includes the participant camera, photo/video review, challenge flow, map, My posts, settings, install guidance and organiser dashboard.

The backend package includes the Supabase SQL setup, Google Apps Script backup worker, Google Sheet map source, Drive fallback and offline upload queue.

## Storage path

Normal:

`Phone -> Supabase -> Google Drive backup`

Storage-full fallback:

`Phone -> Google Apps Script -> Google Drive`

The phone keeps the original file until the backup state is confirmed.

## Important

The organiser password is not included in this package. Put it in Apps Script Script Properties under `SUPABASE_PASSWORD` before you run `setup()`.

Never publish the organiser password or a Supabase service-role key.

## Publish order

1. Run `supabase-setup.sql` in Supabase SQL Editor.
2. Turn on anonymous sign-ins in Supabase.
3. Create the organiser Auth user.
4. Put the complete `Code.gs` into Apps Script.
5. Add `SUPABASE_PASSWORD` to Apps Script Script Properties.
6. Run `setup()` and check `Backup Health`.
7. Deploy Apps Script as a web app and make sure the participant site can call its `/exec` URL.
8. Upload the package contents to the GitHub repository root.
9. Enable GitHub Pages from `main` and `/ (root)`.
10. Test photo, video, map, offline queue and Drive backup on a real phone.

For the full click-by-click setup, use `SETUP.md`.

## Flat GitHub layout

All runtime files are deliberately at the repository root. Do not move them into `js/`, `css/`, `icons/`, `setup/` or `google-apps-script/` folders.

The package includes:

`index.html`

`admin.html`

`main.js`

`camera-ui.js`

`camera.js`

`map-view.js`

`tilemap.js`

`posts.js`

`challenges.js`

`supa.js`

`backend.js`

`Code.gs`

`supabase-setup.sql`

`manifest.webmanifest`

`sw.js`

and the supporting CSS, image and data files.

## Current build

Service worker version: `v25-clean-camera-map-location`

Participant UI: light-only pages with a full-screen camera surface.

Camera: tap for photo, hold for video, pinch/slider zoom, device torch when available, camera flip, sound and challenge selection.

Map: Sheet-driven locations, challenge markers, last-known cache, touch pan, pinch zoom, wheel/keyboard zoom, current-location marker and a text list view.

Offline: application shell and map data cache plus an IndexedDB media queue.

Backup: Supabase first, Google Drive mirror, Drive-only fallback when Supabase reports a storage/capacity failure.

## Maker credit

Every participant/admin page includes:

**Made by Hunter Miller from Boulder Scout Hall**

### Current UI build
The participant app is light-only. Main screens use the white bottom navigation; there is no site footer and no redundant Back button on tabs that have bottom navigation. The camera is full-screen with white controls and no backdrop blur over the viewfinder.

## Final release cleanup

Version 1.5.0 is the final light-only UI pass. Participant footers are removed, tab Back buttons are removed, camera controls are white and sized for narrow phones, camera flip is in the top action rail, the map has a Sheet-first list fallback, and My posts uses confirmed deletion with local hiding.

## 1.5.0 final audit
See `PUBLISH-AUDIT-1.5.0.md` for the current release checks.
