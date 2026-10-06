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

The organiser password is intentionally **not** inside this ZIP. Run `setup()` in the bound Google Apps Script project and enter the password when prompted. Apps Script stores it in Script Properties.

The browser contains only the Supabase publishable key and the non-secret backup client key. The organiser password is never shipped to the browser. Never put a Supabase service-role key in this project or GitHub.

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

`https://script.google.com/macros/s/AKfycbwKMnfKDyF-Bh1U_SOI021lIOeNMa_yg-P1nzf_Wi3qGx2MNHLS-xq5N-K1HVEfp-dg/exec`
