# JOTA-JOTI Camera / Media Platform

Final product-hardening build. The participant site is flat-root GitHub Pages ready, with `/admin/` compatibility and light-only mobile-first camera UI.

Service worker version: `v14-platform-hardening`.

# JOTA-JOTI Camera

A phone-first JOTA-JOTI photo and video app for Kalgoorlie Scout Group. Participants can capture photos or videos, complete challenges, work offline, and upload when a connection returns. Organisers use the `/admin/` page to review media, manage challenges and map pins, and monitor the Google Drive backup.

**Maker credit:** Made by Hunter Miller from Boulder Scout Hall

## What is included

- GitHub Pages ready PWA
- Supabase database, private media storage and organiser login
- Anonymous participant sign-in so participants do not need email accounts
- Offline IndexedDB queue for photos and videos
- Automatic retry when the connection returns
- Google Apps Script backup worker
- Google Drive copy of every successful Supabase upload
- Direct Google Drive fallback when Supabase reports storage or capacity problems
- Backup status shown in Organiser -> Google backup and Health & log
- SQL setup file at `setup/supabase-setup.sql`
- Apps Script at `google-apps-script/Code.gs`

## Important security rule

The organiser password is intentionally **not** inside this ZIP. Before running `setup()`, add `SUPABASE_PASSWORD` in Apps Script Project Settings -> Script Properties. Apps Script reads it there and never writes it into the code.

The browser contains only the Supabase publishable key and the non-secret backup client key. The map configuration is read publicly from the Apps Script `publicConfig` endpoint and contains no organiser secret. The organiser password is never shipped to the browser. Never put a Supabase service-role key in this project or GitHub.

## Publish order

1. Run `setup/supabase-setup.sql` in the Supabase SQL editor.
2. Turn on Anonymous sign-ins in Supabase Authentication.
3. Make sure the organiser Auth user uses `jota.joti.boulder@gmail.com`.
4. Open the JOTA-JOTI Google Sheet, then Extensions -> Apps Script. Replace the script with `google-apps-script/Code.gs`.
5. Run `setup()` once and approve the Google permissions. The script creates the Drive backup folder, backup sheets and a 5-minute worker trigger.
6. Deploy the Apps Script as a Web app, Execute as you, with public access for event participants. The current build is configured for the supplied `/exec` endpoint in `js/backend.js`. If you create another deployment URL, update that one line before publishing.
7. Upload this package to the GitHub repository and enable GitHub Pages from the root of the `main` branch.
8. Test one photo, one video, one offline post, and the storage-full simulator before the event.

Read `SETUP.md` for the exact click-by-click setup. Read `TEST-REPORT.md` for what was checked in this build.


## Current Apps Script endpoint

`https://script.google.com/macros/s/AKfycbxvOz7yfWfznj3E0q5ZuFL3tJRyBP2Z5C-1Ia-2Mla1EdOoKQxjOeIgULX89ciF7NR8/exec`


Map URL and location pins are maintained in Google Sheets through the Apps Script web app. The public camera app reads and caches that data, while Apps Script maintains the Supabase mirror used by challenges.


## Google Sheet map source

The map URL and the complete public location list come from the organiser Google Sheet. The Apps Script creates `Map Settings` and `Locations` automatically. The public app reads the Sheet through the Apps Script web app and caches it for offline use.

`Map Settings` columns: `Key | Value | Description`

Use `mapUrl`, `mapTileUrl`, `mapCenterLat`, `mapCenterLon`, and `mapZoom`. `mapUrl` is the Google Maps link opened by the Map tab.

`Locations` columns: `ID | Name | Description | Instructions | Latitude | Longitude | Category | Icon | Points | PhotoRequired | VideoAllowed | Active | ChallengeNumbers`

Leave `ID` blank for a new row. The Apps Script will assign a UUID. `Active=false` hides the pin from participants without deleting the row. `ChallengeNumbers` accepts values such as `1, 4, 12`.


## GitHub root upload
This build is intentionally flat. Upload the files directly into the repository root. Do not create css/, js/, icons/, or admin/ folders. Runtime files are intentionally at the repository root. The site uses root-relative files such as app.css, main.js, logo.png, and admin.html.


## Map memories and challenges
The My posts screen is map-first. Geotagged captures are shown as thumbnail markers at their capture coordinates, while captures without location remain in the lower archive. Challenge markers are placed from challenge location IDs or the Google Sheet Locations `ChallengeNumbers` column. Tapping a challenge marker opens the challenge actions directly; tapping a memory opens its details and recent media.


## Map setup

The built-in map opens centred on Boulder in the Kalgoorlie-Boulder area. Australia Post lists Boulder, WA as postcode 6432; postcode 6430 is used for Kalgoorlie and surrounding localities. The app uses the Boulder map centre and the organiser Google Sheet remains the source of truth for locations.

In the Google Sheet `Locations` sheet, use the `ChallengeNumbers` column to attach challenge numbers to a location. Those challenges then appear on the map and can launch the camera directly.


### GitHub Pages layout
This release is intentionally flat. Upload the package contents directly to the repository root. Use the normal site URL for participants and `/admin` or `/admin/` for organiser tools; GitHub Pages will route that path to `admin.html` through the included 404 handler.

## Final release notes

This release is a flat GitHub Pages package. Upload every file directly to the repository root. The included `404.html` routes `/admin` and `/admin/` to `admin.html`. See `FINAL-TEST-REPORT.md` and `BUTTON-AUDIT.md` for the final build and interaction review.
