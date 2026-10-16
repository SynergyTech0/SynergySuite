# Synergy Drive

OneDrive for the Synergy suite: everyone's files, plus shared libraries for teams.

- Folders, uploads of files and whole folders (button or drag and drop), downloads, folders as zip
- Previews for images, PDF, video, audio and text, with arrows between files
- Version history: saving a file with the same name keeps the old one; any version can be downloaded or restored
- Share with people (can view / can edit, inherited by everything inside a folder), and view links that need no account, optionally expiring
- Shared libraries (SharePoint document libraries) with owners, members and visitors. Each site in Sites has one too, whose people Sites keeps in step with the site's (`/api/svc/managed-libraries`, Bearer `DRIVE_SVC_TOKEN`); change those in Sites
- Recent, Starred, Shared with me / by me, search by name and by words inside text files
- Recycle bin, emptied after `DRIVE_TRASH_DAYS`
- Storage quota per person, AI summaries of text files through `@synergy/ai`
- Sensitivity labels from the Admin center on files and folders: shown on the file, set by anyone who can edit, kept across versions. New uploads get the default label, and Word, Excel and PowerPoint files labeled elsewhere (Microsoft Purview `MSIP_Label_*` properties) keep theirs
- A label that keeps content inside the organization refuses view links and sharing with outside people, for the file itself and for any folder holding such a file
- Data loss prevention: view links and sharing with people are checked against the Admin center's DLP rules, reading text files and the text of Word, Excel and PowerPoint files (the first 2 MB; Office files up to 25 MB). A block is refused, a warning needs a reason to go ahead, and every match is reported to the Admin center

## How it stores things

Postgres holds the folder tree, versions, sharing and activity (`lib/db.ts`). File contents live on disk under `DRIVE_DIR`, named by their SHA-256 (`lib/blobs.ts`), so identical files, copies and restored versions are stored once. Back up the database and `DRIVE_DIR` together.

Downloads and previews are served with `nosniff` and a sandbox CSP, and HTML, SVG, XML and scripts go out as plain text or images, so an uploaded file can never run as a page on the Drive origin.

## Settings

| Setting | Meaning |
|---|---|
| `DATABASE_URL` | Postgres database |
| `DRIVE_DIR` | Where file contents are kept (default `.data`) |
| `DRIVE_QUOTA_MB` | Storage per person, every version counted. Empty = no limit. Shared libraries are not limited |
| `DRIVE_MAX_FILE_MB` | Largest single upload. Empty = no limit |
| `DRIVE_TRASH_DAYS` | Days in the recycle bin before deletion for good (default 93) |
| `DRIVE_SVC_TOKEN` | Lets Sites make its sites' document libraries and set their people. Empty = off |
| `DRIVE_VERSIONS` | Versions kept per file (default 100) |
| `DRIVE_ZIP_MAX_MB` | Largest folder download as one zip (default and maximum 4000) |
| `AI_*` / `DRIVE_AI_*` | The suite's AI model, for summaries (see `packages/ai`) |

## Develop

```
npm install && npm run build:packages
DEV_USER_EMAIL=you@example.com npm run dev --workspace apps/drive   # http://localhost:3180
TEST_DATABASE_URL=postgres://... npm test --workspace apps/drive
```

With no `DATABASE_URL` it uses `postgres://postgres@127.0.0.1:5499/drive`. Send an `x-dev-user` header to act as someone else while developing.
