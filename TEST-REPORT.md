# Test report

Build checked: JOTA-JOTI Camera backup-ready package

## Checks completed here

- All application JS files passed `node --check` in three consecutive runs.
- Apps Script `Code.gs` was syntax-checked as JavaScript in three consecutive runs.
- All local JavaScript imports were checked against their target files and named exports.
- Local HTML asset references were checked.
- Named import/export references were checked and no mismatches were found.
- Service worker shell assets were checked against the package.
- The organiser password was scanned for and is not present in the package.
- Old setup placeholders and the previous untested warning were removed from the shipped README and setup guide.
- The old `_old-cloudflare` implementation is excluded from the final package.
- IndexedDB schema upgrade was hardened so existing object stores are not recreated during an upgrade.
- The service worker cache version was bumped so the new backup module is loaded after deployment.
- The media limit is consistent across client, Supabase SQL and backup logic at 30 MB.
- Drive fallback is idempotent by submission/file name.
- A 30 MiB Drive-fallback payload was generated in a unit test and measured at about 40.00 MiB after base64 encoding, below the current 50 MiB Apps Script URL Fetch POST limit.
- Local media is not deleted after a Drive fallback until the app sees a confirmed `DONE` backup state in Supabase.

## What could not be live-tested from this build environment

The container used to build the ZIP cannot reach the project's Supabase or Google Apps Script internet endpoints, and Chromium navigation to the local test server is blocked by the container sandbox. Because of that, I did **not** claim a live upload or live Drive backup test that I could not actually perform.

The package therefore needs one real account-side test after you deploy it: submit one photo, submit one video, test one offline queue item, and run the storage-full simulator.

## Expected live result

Normal path: `SUPABASE` upload followed by `DUAL` backup confirmation.

Storage-full path: `DRIVE` provider, with the Drive file visible from Organiser -> Google backup.

## Build contents

Public app: `index.html`

Organiser app: `admin/index.html`

Supabase SQL: `setup/supabase-setup.sql`

Google Apps Script: `google-apps-script/Code.gs`


## Updated deployment check

The browser backup endpoint in `js/backend.js` was updated to the current Apps Script deployment supplied for this build:
`https://script.google.com/macros/s/AKfycbwKMnfKDyF-Bh1U_SOI021lIOeNMa_yg-P1nzf_Wi3qGx2MNHLS-xq5N-K1HVEfp-dg/exec`

The Apps Script `setup()` function no longer waits on a password prompt; it requires `SUPABASE_PASSWORD` to already exist in Script Properties, which prevents the five-minute hang seen during setup.
