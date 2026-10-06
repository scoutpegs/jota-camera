# GitHub repository setup

This package is ready to be copied into a new GitHub repository. It uses relative paths, so the repository name can change without changing the camera, admin, CSS, icons or service-worker paths.

## 1. Create the repository

Open https://github.com/new

Create the repository under the GitHub account/organisation you want to use. A repository name such as `jota-joti-camera` is fine.

Do not add a second README, `.gitignore` or licence if you are going to upload this package as-is.

## 2. Upload the package

Upload the contents of this folder, not the ZIP file itself. `index.html` must be in the repository root.

You should see roughly:

```text
index.html
admin.html
admin.css
admin.js
app.css
main.js
backend.js
sw.js
manifest.webmanifest
manifest.webmanifest
.nojekyll
```

## 3. Commit to main

Commit all files to the `main` branch.

## 4. Turn on GitHub Pages

Open repository Settings -> Pages.

Choose:

```text
Source: Deploy from a branch
Branch: main
Folder: / (root)
```

Save.

Official instructions: https://docs.github.com/en/pages/quickstart

## 5. Site addresses

Your participant site will be:

`https://<github-account-or-org>.github.io/<repository-name>/`

The organiser page will be:

`https://<github-account-or-org>.github.io/<repository-name>/admin.html`

The app uses relative URLs, so changing the repository name does not require code changes.

## 6. Required backend setup

Before real use, finish `SETUP.md` so Supabase, the organiser account, Apps Script and Google Drive backup are configured.


## GitHub root upload
This build is intentionally flat. Upload the files directly into the repository root. Do not create css/, js/, icons/, or admin/ folders. Runtime files are intentionally at the repository root. The site uses root-relative files such as app.css, main.js, logo.png, and admin.html.


## Map setup

The built-in map opens centred on Boulder in the Kalgoorlie-Boulder area. Australia Post lists Boulder, WA as postcode 6432; postcode 6430 is used for Kalgoorlie and surrounding localities. The app uses the Boulder map centre and the organiser Google Sheet remains the source of truth for locations.

In the Google Sheet `Locations` sheet, use the `ChallengeNumbers` column to attach challenge numbers to a location. Those challenges then appear on the map and can launch the camera directly.


## Upload layout
Upload the contents of this package directly into the GitHub repository root. The runtime does not depend on css/js/icons subfolders.
