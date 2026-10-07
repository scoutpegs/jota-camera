# GitHub Pages setup

This package is already laid out for a root-level GitHub Pages deployment.

## 1. Create the repository

Create a GitHub repository under the account or organisation that should publish the site.

A repository name such as `jota-joti-camera` is fine. The code uses relative paths, so the repository name does not need to be written into every JavaScript file.

## 2. Upload the package

Upload the **contents** of this package, not the ZIP file.

`index.html` must be directly in the repository root.

The important root files are:

```text
index.html
admin.html
404.html
app.css
admin.css
main.js
camera-ui.js
camera.js
map-view.js
tilemap.js
supa.js
backend.js
Code.gs
supabase-setup.sql
manifest.webmanifest
sw.js
```

The PNG files must also stay in the root.

Do not create `css/`, `js/`, `icons/`, `setup/` or `google-apps-script/` folders for this build.

## 3. Commit to main

Commit all files to the `main` branch.

## 4. Enable GitHub Pages

Open repository **Settings -> Pages**.

Set:

```text
Source: Deploy from a branch
Branch: main
Folder: / (root)
```

Save.

GitHub's current guide is: https://docs.github.com/en/pages/quickstart

## 5. Public and organiser pages

Public:

`https://<account-or-org>.github.io/<repository>/`

Organiser:

`https://<account-or-org>.github.io/<repository>/admin.html`

The included `404.html` keeps `/admin` and `/admin/` usable on GitHub Pages.

## 6. Backend before event use

Finish `SETUP.md` before giving participants the public link. The site requires Supabase Auth/SQL and the Apps Script Drive backup deployment to be configured.

## 7. Service worker cache

This build uses:

`v22-light-ui-final-camera-map`

After publishing an update, close old tabs and reopen the GitHub Pages address so the new service-worker shell can take over.

### Current UI build
The participant app is light-only. Main screens use the white bottom navigation; there is no site footer and no redundant Back button on tabs that have bottom navigation. The camera is full-screen with white controls and no backdrop blur over the viewfinder.
