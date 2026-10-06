# JOTA-JOTI Camera validation report

Build checked: 6 October 2026

## Automated checks

The package was checked repeatedly for:

- JavaScript syntax in every `js/*.js` file
- Admin JavaScript syntax
- Google Apps Script syntax
- relative import paths
- required PWA/service-worker files
- embedded configuration consistency
- password leakage into the package
- Google Sheet map field names
- Apps Script Sheet parsing, UUID generation, boolean parsing, map configuration output, Sheet -> Supabase sync calls, and Google Drive fallback validation
- ZIP archive integrity after packaging

The Google Apps Script unit harness also verifies that blank latitude/longitude rows are ignored, which prevents empty Sheet rows from becoming false coordinates at `0,0`.

## Important live-service limitation

A live browser session against GitHub Pages, Supabase and the Apps Script deployment could not be completed from the build environment because external browser/network access is blocked here. The code was therefore tested statically and with local/unit simulations, but the final account-side smoke test must be done from the published site.

## Required live smoke test

1. Open the published GitHub Pages URL over HTTPS.
2. Enter a participant name.
3. Allow camera and microphone when requested.
4. Allow location if desired.
5. Take a photo and submit it.
6. Record a short video and submit it.
7. Confirm the participant can see both in My posts.
8. Confirm the organiser can see both in `/admin/`.
9. Confirm the original media can be downloaded.
10. Confirm a normal upload is backed up to Google Drive.
11. Turn on Test mode -> `Pretend Supabase storage is full` and submit a small photo.
12. Confirm the fallback reaches Google Drive and the local file is not removed before the backup is confirmed.
13. Edit `Map Settings` and `Locations` in Google Sheets and confirm the participant Map tab updates.
14. Turn off internet, capture and submit, close/reopen the app, reconnect, and confirm the queue uploads without creating a duplicate.

## Google Sheet map source

The participant Map tab reads the current `Map Settings` and `Locations` data through Apps Script and caches it for offline use. The Supabase copy is a mirror for challenge relationships and fallback operation. `Active=false` rows are kept in the Sheet/admin view but hidden from participants.
