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
admin/
css/
js/
icons/
setup/
google-apps-script/
sw.js
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

`https://<github-account-or-org>.github.io/<repository-name>/admin/`

The app uses relative URLs, so changing the repository name does not require code changes.

## 6. Required backend setup

Before real use, finish `SETUP.md` so Supabase, the organiser account, Apps Script and Google Drive backup are configured.
