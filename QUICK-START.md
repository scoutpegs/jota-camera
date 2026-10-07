# JOTA-JOTI Camera quick start

Use this checklist after uploading the package.

## Supabase

1. Turn on Anonymous sign-ins.
2. Create the organiser Auth user using the organiser email.
3. Run the complete `supabase-setup.sql` once.
4. Make sure the `admins` row exists for the organiser account.

## Google Sheet + Apps Script

1. Open the event Google Sheet.
2. Open **Extensions -> Apps Script**.
3. Replace the script with `Code.gs`.
4. In **Project Settings -> Script Properties**, add `SUPABASE_PASSWORD` with the private organiser password.
5. Run `setup()` and approve Google permissions.
6. Check `Backup Health` and make sure the setup row is `OK`.
7. Deploy **Web app** from Apps Script and allow the participant site to call the `/exec` URL.
8. Put the deployment `/exec` URL into `backend.js` if it differs from the one already supplied.

## Map

In the Google Sheet:

- `Map Settings` controls the Google Maps link, tile template, centre and zoom.
- `Locations` controls the public location pins.
- Keep the `Locations` column order unchanged.
- Put challenge numbers such as `1, 4, 12` into `ChallengeNumbers`.

## GitHub Pages

1. Upload the **contents** of the ZIP to the repository root.
2. Keep `index.html`, `app.css`, JavaScript modules, images, `Code.gs`, SQL, manifest and service worker at the root.
3. Enable GitHub Pages from `main` and `/(root)`.
4. Open the public Pages URL.
5. Open `/admin.html` for organiser management.

## First phone check

1. Open the HTTPS Pages site.
2. Enter a participant name.
3. Allow camera and microphone when prompted.
4. Take one photo and one short video.
5. Open Map and verify Sheet locations.
6. Open My posts and check the saved media.
7. Turn on flight mode, capture a small photo and verify it stays queued locally.
8. Restore the network and verify the queue uploads.
9. Check Google Drive and the `Backups` sheet for the copied file.

For the complete explanation and troubleshooting, use `SETUP.md`.
