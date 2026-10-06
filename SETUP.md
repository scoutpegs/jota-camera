# JOTA-JOTI Camera setup guide

This guide is written for the current package. It avoids putting the organiser password into GitHub.

## 1. Supabase

Open your Supabase project.

### Authentication

Go to Authentication -> Providers and turn **Anonymous sign-ins** on.

Go to Authentication -> Users and make sure the organiser account exists with:

- Email: `jota.joti.boulder@gmail.com`
- Password: keep this private and do not paste it into the project files

For the easiest event setup, confirm the organiser account so email confirmation does not block the organiser login.

### SQL

Open SQL Editor -> New query. Open `setup/supabase-setup.sql`, paste the whole file, and Run.

The SQL is safe to re-run. It creates the tables, policies, private storage buckets, backup columns, functions and default settings. It also limits a media file to 30 MB so the same file can safely fit through the Apps Script Drive fallback path.

After the query succeeds, do not paste the organiser password into SQL.

## 2. Google Sheet and Apps Script

Use the Google Sheet you want to keep for JOTA-JOTI. Open the sheet and choose Extensions -> Apps Script.

Open the packaged `google-apps-script/Code.gs` and replace the contents of `Code.gs` with it. Save.

### First run

Before running setup, open Apps Script -> Project Settings -> Script Properties and add:

`SUPABASE_PASSWORD` = your private Supabase organiser password

Then choose the function `setup` and click Run. The current script is deliberately non-interactive, so it will not sit waiting for a password prompt. The password stays in Script Properties and is never written to `Code.gs`.

Approve the requested Google permissions. The script creates:

- a Drive folder named `JOTA-JOTI Camera Backup`
- a `Backups` sheet for successful Drive copies
- a `Backup Errors` sheet for failures
- a `Backup Health` sheet for setup and test results
- a 5-minute trigger running `syncPendingBackups`

The setup function also tests the Supabase organiser login and Drive access.

### Web app deployment

In Apps Script choose Deploy -> New deployment, select **Web app**, set **Execute as** your account, and set access so event participants can reach the web app. Deploy.

The published site is already configured to use this Apps Script deployment:

`https://script.google.com/macros/s/AKfycbwKMnfKDyF-Bh1U_SOI021lIOeNMa_yg-P1nzf_Wi3qGx2MNHLS-xq5N-K1HVEfp-dg/exec`

If you later create a different deployment, replace `GOOGLE_BACKUP_URL` in `js/backend.js` with the new `/exec` URL before publishing that version.

When you change `Code.gs` later, deploy a new version of the existing deployment. Do not create a different URL unless you also update `js/backend.js`.

Keep the Apps Script project owned by the same Google account that should own the Drive backup folder.

## 3. GitHub Pages

Upload the **contents** of this package so `index.html` is at the top level of the repository. Keep `admin/`, `js/`, `css/`, `icons/`, `setup/`, `google-apps-script/`, `manifest.webmanifest`, `sw.js` and `.nojekyll`.

In GitHub go to Settings -> Pages. Choose Deploy from a branch, branch `main`, folder `/ (root)`, then Save.

The participant address is the repository Pages URL. The organiser page is the same URL with `/admin/` at the end.

## 4. First organiser login

Open `/admin/` and log in using the organiser email and password.

Go to Settings and save your competition name, video length and other settings.

Then add your map pins, sounds and challenges.

## 5. Real test

Do this on an actual phone before the event.

### Photo

Open the public site over HTTPS. Enter a participant name. Allow camera and microphone. Take a photo and submit it.

Check Organiser -> Media. The item should say `SUPABASE` and `Backup: DONE` shortly after. The Google backup should also appear in Organiser -> Google backup.

### Video

Record a video shorter than the configured maximum. Submit it and check the same two places.

### Offline

Turn on flight mode. Take and submit a photo. My posts should say it is saved on the phone. Turn flight mode off and leave the app open until the upload finishes.

### Storage-full fallback

You do not need to fill the Supabase bucket to test the fallback. On the phone, open Settings and tap the version text seven times to open Test mode. Turn on **Pretend Supabase storage is full**. Take a small photo and submit it.

The app should send the saved file to Apps Script, Apps Script should put it into Google Drive, and the app should only remove the large local copy after Supabase reports `Backup: DONE` with `DRIVE`.

After the test, turn the simulator back off using Reset all.

### Admin download

Open the media item. A normal item downloads from Supabase. A Drive-only fallback item opens its Drive backup link.

## 6. Backup behaviour

A normal successful upload follows this path:

`Phone -> Supabase Storage`

Then the Apps Script worker copies the same file to:

`Google Drive / JOTA-JOTI Camera Backup`

The submission records the provider as `DUAL` after the backup is confirmed.

If Supabase reports a storage/capacity problem while the original file is still on the phone, the app uses:

`Phone -> Apps Script -> Google Drive`

The app polls Supabase for the backup confirmation before deleting the local file. If confirmation does not arrive, the local file remains and the app retries the Drive-only path later.

## 7. Common fixes

**Admin says the account is not an organiser:** run the SQL again and make sure the Auth user's email exactly matches `jota.joti.boulder@gmail.com`.

**Backup page says waiting:** check that Apps Script is deployed as a Web app, the URL in `js/backend.js` is the `/exec` URL, and `setup()` completed successfully. Then open Organiser -> Google backup -> Run backup now.

**Camera does not work:** use the HTTPS GitHub Pages address and allow camera/microphone permissions.

**The app looks old after a deployment:** close all tabs of the site, open the site again, and reload once. The service worker cache version has been bumped for this build.

**Supabase rejects a file as too large:** the site now enforces a 30 MB media cap. Shorten the recording or lower the configured video quality.

## 8. Files you should keep

`setup/supabase-setup.sql` is the database setup.

`google-apps-script/Code.gs` is the Drive backup worker.

`js/backend.js` contains the browser-safe project configuration.

Do not add the organiser password to any of these files.

## 9. Official setup references

Supabase anonymous sign-in: https://supabase.com/docs/guides/auth/auth-anonymous

Supabase database quickstart: https://supabase.com/docs/guides/database/

Supabase Storage: https://supabase.com/docs/guides/storage

Google Apps Script web apps: https://developers.google.com/apps-script/guides/web

Google Apps Script deployment: https://developers.google.com/apps-script/concepts/deployments

GitHub Pages: https://docs.github.com/en/pages


## Google Sheet map source

`setup()` creates two sheets named **Map Settings** and **Locations**. The public app reads the map configuration through the Apps Script web app and caches the data so the locations remain available without internet. Apps Script also mirrors the current location rows into Supabase every five minutes.

### Map Settings sheet

Columns: `Key | Value | Description`

Use these rows:

| Key | What to enter |
| --- | --- |
| `mapUrl` | A Google Maps URL for the event/map |
| `mapTileUrl` | Tile URL used by the lightweight in-app map |
| `mapCenterLat` | Starting latitude |
| `mapCenterLon` | Starting longitude |
| `mapZoom` | Starting zoom |

Google Maps URLs support `api=1` and can be used as a direct cross-platform map link.

### Locations sheet

Columns, in this exact order:

`ID | Name | Description | Instructions | Latitude | Longitude | Category | Icon | Points | PhotoRequired | VideoAllowed | Active | ChallengeNumbers`

Leave **ID** blank when you add a new location. The Apps Script creates a UUID automatically. Enter latitude/longitude as decimal degrees. Use `true` or `false` in the Yes/No fields. Put challenge numbers in `ChallengeNumbers`, for example `1, 4, 12`.

The **Map pins** page in Admin no longer edits Supabase locations directly. It shows what is currently in the Sheet and provides links to open the Sheet, open the Google map URL, and manually sync Sheet → Supabase.
