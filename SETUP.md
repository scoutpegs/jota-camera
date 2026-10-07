# JOTA-JOTI Camera setup

This package is a flat GitHub Pages site for Kalgoorlie Scout Group. The participant app is light-only. The camera is full-screen with dark camera controls because the controls sit over a live viewfinder.

The normal storage path is:

`Phone -> Supabase Storage -> Google Drive backup`

If Supabase reports a storage or capacity failure while the original file is still on the phone, the app switches to:

`Phone -> Google Apps Script -> Google Drive`

The app keeps the local copy until the backup is confirmed. The browser only contains the Supabase publishable key and the backup client key. The organiser password is not included in this package.

## 1. Supabase

Open the Supabase project used by this package.

### Turn on anonymous sign-in

Open **Authentication** and the provider/settings area for anonymous sign-ins. Turn **Anonymous sign-ins** on.

This app uses a Supabase anonymous user for each participant. Anonymous users still use the `authenticated` database role, so the SQL policies in this package are written for that role. See the official Supabase guide for the current dashboard wording: https://supabase.com/docs/guides/auth/auth-anonymous

### Create the organiser account

Open **Authentication -> Users** and create the organiser user using:

`jota.joti.boulder@gmail.com`

Use the organiser password you keep private. Do not put the password into SQL, `Code.gs`, `backend.js`, GitHub, or the ZIP.

### Run the SQL

Open **SQL Editor -> New query**. Open `supabase-setup.sql` from this package, copy the entire file, paste it into the query editor and run it.

The file is designed to be safe to run again. It creates or updates the tables, Row Level Security policies, private storage buckets, functions and default event settings.

The database limits each media submission to 30 MB. The same limit is used by the Drive fallback path so the two systems have the same operating boundary.

After the SQL finishes, check the results for an error. If the query fails, do not continue to publishing until the SQL error is fixed.

## 2. Google Sheet

Create or open the Google Sheet that will be used for the event. The Apps Script in this package is designed to create the working tabs automatically.

Open **Extensions -> Apps Script**.

Delete the sample code and paste the complete contents of `Code.gs` from this package into the script project. Save it.

## 3. Apps Script secret and setup

Open **Project Settings** in Apps Script and find **Script Properties**.

Add this property:

`SUPABASE_PASSWORD` = your private Supabase organiser password

Script Properties are intended for app-wide configuration and can be stored separately from the source code. See Google's current Properties service documentation: https://developers.google.com/apps-script/guides/properties

Back in the editor, select the `setup` function and click **Run**.

The first run asks Google for permissions. Accept the requested permissions using the Google account that should own the event Sheet and Drive backup folder.

`setup()` creates or prepares:

`Backups`

`Backup Errors`

`Backup Health`

`Map Settings`

`Locations`

It also creates the Drive folder **JOTA-JOTI Camera Backup** and installs the background triggers used for backup and map synchronisation.

The script runs a Supabase login check and a Drive write test during setup. Open `Backup Health` afterwards and make sure the latest setup/test row is `OK`.

## 4. Deploy Apps Script as the public web app

In Apps Script choose **Deploy -> New deployment**. Choose **Web app**.

Set the web app to execute as the account that owns the Sheet and Drive backup. Set access so the participant website can reach the web app without requiring every participant to sign into Google.

Google's current web app documentation explains the deployment flow and the `execute as`/access choices: https://developers.google.com/apps-script/guides/web

Deploy it and copy the `/exec` URL.

The supplied package already points to the configured deployment in `backend.js`. When you create a new deployment URL, replace only `GOOGLE_BACKUP_URL` in `backend.js` with the new `/exec` URL and keep the backup client key unchanged unless you also change it in Apps Script.

When `Code.gs` changes later, update the existing deployment to a new version rather than creating a different deployment URL every time.

## 5. Map data in Google Sheets

The public Map tab reads these values through Apps Script and caches them on the phone. That makes the last known location list available even when the network disappears.

### Map Settings

The columns are:

`Key | Value | Description`

The important rows are:

`mapUrl`

The Google Maps link opened by the Map tab.

`mapTileUrl`

The tile template used by the lightweight in-app map. The default is the OpenStreetMap tile template already in the package.

`mapCenterLat`

Starting latitude.

`mapCenterLon`

Starting longitude.

`mapZoom`

Starting zoom level.

### Locations

The columns must stay in this order:

`ID | Name | Description | Instructions | Latitude | Longitude | Category | Icon | Points | PhotoRequired | VideoAllowed | Active | ChallengeNumbers`

For a new location, leave `ID` blank. Apps Script generates the ID.

Latitude and longitude are decimal degrees.

Use `true` or `false` for `PhotoRequired`, `VideoAllowed` and `Active`.

Put challenge numbers in `ChallengeNumbers`, for example:

`1, 4, 12`

The participant Map tab groups challenges at their location and opens the relevant photo/video actions when a challenge marker is tapped.

## 6. GitHub Pages

Upload the contents of this package into the root of the GitHub repository. Do not upload the ZIP itself.

`index.html` must be directly in the repository root.

Keep all JavaScript, CSS, images, `Code.gs`, `supabase-setup.sql`, `manifest.webmanifest` and `sw.js` at the root. This build deliberately does not depend on `js/`, `css/`, `icons/`, `setup/` or `google-apps-script/` folders.

In GitHub open **Settings -> Pages**.

Choose:

`Deploy from a branch`

`main`

`/(root)`

Save.

GitHub's current Pages quickstart is here: https://docs.github.com/en/pages/quickstart

The public app is the repository Pages URL. The organiser app is `admin.html`. The included `404.html` keeps `/admin` and `/admin/` working on GitHub Pages.

## 7. First organiser login

Open `admin.html` or `/admin/` from the published site.

Log in with the organiser Auth account.

Use the admin pages to set the competition settings, map locations, challenges and sounds.

The participant app never receives the organiser password.

## 8. Install recommendation

The public app is a PWA. On supported browsers it will show:

**Recommended: add JOTA-JOTI to your home screen for the best full-screen camera experience.**

On iPhone/iPad the install sheet gives the Safari Add to Home Screen steps. On supported Chromium browsers it uses the install prompt when the browser offers one.

There is no dark mode in the participant app. The normal pages always use the light colour system. The camera/review surfaces use a dark viewfinder/control layer so white camera controls stay readable over photos.

## 9. Camera behaviour

After a participant enters their name, the app asks for camera and microphone access. Camera access is required for the live camera. Microphone access is optional for opening the camera, and a blocked microphone is explained when video recording is attempted.

The camera is full-bleed and uses the same crop for the saved photo that the participant saw in the viewfinder. The app prefers a 4:3 camera stream and crops it to the live viewfinder rather than saving a different framing.

The shutter works in both ways:

Tap for a photo.

Hold for a video. Releasing stops the recording.

The app also uses hardware zoom controls when the browser exposes them, supports pinch/slider zoom, uses the torch when the phone exposes it, and can switch between the front and rear cameras.

## 10. Upload and backup behaviour

A submitted post is first saved locally in IndexedDB so the participant does not lose it when the connection is slow or disappears.

When the connection is available, the uploader sends the file to Supabase in chunks and waits for Supabase to confirm the final upload.

After Supabase accepts the file, Apps Script copies the uploaded object into the Google Drive backup folder.

If Supabase storage is full or reports a capacity error while the original file is still on the phone, the uploader uses the direct Drive fallback through Apps Script.

The participant's local large file is only removed after the app sees a confirmed Drive backup state. If the confirmation does not arrive, the local file is kept and the uploader retries later.

## 11. Offline mode

The app uses a service worker for the application shell and a local cache for the last known map data. Photos and videos are kept in IndexedDB rather than in the service worker cache.

To test this, open the app once while online, then enable flight mode. Capture and submit a small photo. The app should say it is saved on the phone. Turn the network back on and leave the app open until the upload completes.

## 12. Pre-event check

Do these tests on a real phone using the HTTPS GitHub Pages site.

Capture and submit one photo.

Record and submit one short video.

Open Map and confirm that your Sheet locations appear.

Tap a location and confirm that the challenge/location actions open.

Open My posts and confirm the saved media appears.

Enable flight mode and submit a small photo, then restore the network and confirm the queue drains.

Open organiser -> Google backup and confirm successful Drive copies are recorded.

## 13. Troubleshooting

**The app stays on Loading.**

Open the browser console and look for the first JavaScript error. The package has local syntax checks for all JavaScript files, so a live startup error is usually a configuration, browser or deployment issue rather than a missing script path.

**Camera does not open.**

Make sure the site is running on HTTPS and the browser has camera permission for the site. Close other apps using the camera and reload.

**The map is blank.**

The app first shows the saved map and pins it already knows. When online it refreshes from the Sheet. Check `Map Settings`, the `Locations` sheet and the Apps Script web-app URL in `backend.js`.

**Admin login works but the user is not an organiser.**

The email of the Auth user must match the organiser email listed in the SQL/admin configuration. Run the SQL again if the `admins` row has not been created.

**Backups are stuck.**

Check `Backup Health`, the Apps Script execution history and the `Backups`/`Backup Errors` sheets. Confirm `setup()` ran successfully and that the current web-app deployment points to the latest code.

**The site still looks like an older version.**

The service worker has a versioned shell cache. Close old tabs, open the current Pages address again and reload once.

## 14. Security rules

Do not put the organiser password into GitHub.

Do not put the password into `supabase-setup.sql`.

Do not put the password into `backend.js`.

Do not put a Supabase service-role key into the public site.

The browser-safe Supabase key is a publishable key. Access is enforced by Supabase Auth and Row Level Security.

## Official references

Supabase anonymous sign-ins: https://supabase.com/docs/guides/auth/auth-anonymous

Supabase users: https://supabase.com/docs/guides/auth/users

Google Apps Script web apps: https://developers.google.com/apps-script/guides/web

Google Apps Script Properties: https://developers.google.com/apps-script/guides/properties

GitHub Pages quickstart: https://docs.github.com/en/pages/quickstart
