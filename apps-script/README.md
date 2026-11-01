# Wedding photo and video service

`Code.gs` is the Google Apps Script web app used by the static GitHub Pages site.

- It lists the newest public videos from the configured Drive folder.
- It accepts up to four JPG, PNG, or WebP files per request, with an 8 MB per-file and 16 MB total limit.
- Uploaded photos are stored in a dedicated `Sofia & Raj Wedding Memories` folder. The folder and files are viewable by anyone with the link so they can appear in the public wedding gallery.
- A daily upload cap limits accidental or abusive storage use.

Deploy as a web app that executes as the wedding account and is accessible to anyone. Add the deployment URL as `VITE_GALLERY_API_URL` when building the Pages site. Do not deploy this service from a different Google account: that account will own and store the uploaded images.
