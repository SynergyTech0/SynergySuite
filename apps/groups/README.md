# Synergy Groups

Teams, distribution lists, shared mailboxes and security groups: the suite's answer to
Microsoft 365 Groups and the teams in Microsoft Teams. Groups decides who is in what; Chat,
Drive, Calendar and Mail each get their share of a group and keep it in step.

## What it does

- **Teams**: a team gives its people a workspace in Chat with a channel per team channel
  (General to start, members can add more), a library in Drive (owners own it, members edit),
  a group calendar in Calendar that shows in everyone's own calendar, and with an address a
  shared mailbox in Mail. The team page has Posts (the latest conversations across its
  channels, and a box to start one), Files (recently changed files in the library), Calendar
  (the next four weeks and a New meeting button), Members and Settings.
- **Distribution lists**: one address that sends to every member, outside addresses allowed.
  On the suite mail server this is a Stalwart mailing list.
- **Shared mailboxes**: one inbox several people read and send from. Each member sees it in
  Mail's account list.
- **Security groups**: a set of people with no mail or space of its own, for other apps to
  grant access to.
- **Membership**: owners and members. A group can hold other groups (a distribution list can
  include a team), flattened everywhere and refused when it would make a loop. Public groups
  can be joined by anyone; for private ones people ask and an owner lets them in. A group always
  keeps at least one owner.
- **Delete and restore**: deleting a group takes it out of Chat, Drive, Calendar and Mail
  without erasing anything there, and an owner can restore it for 30 days.
- **History**: every change is logged with who made it, shown to owners and searchable by the
  Admin center.
- **Search and eDiscovery**: suite search finds groups the person is in and public ones; the
  Admin center searches and exports groups (members, channels, linked resources) and their
  change history.

## How it fits the suite

Groups is the source of truth. After every change it sends each app the whole membership in an
idempotent PUT, and repeats this for every group every 15 minutes so an app that was down
catches up. What each app answered is kept per group and shown on the Settings tab.

| App | Route on that app | What it holds |
|---|---|---|
| Chat | `PUT/DELETE /api/svc/teams/groups:<id>`, `GET …/activity`, `POST …/messages` | a workspace, its members and one channel per team channel |
| Drive | `PUT/DELETE /api/svc/libraries/groups:<id>`, `GET …/recent` | a library; owners as owners, members as editors |
| Calendar | `PUT/DELETE /api/svc/group-calendars/groups:<id>`, `GET …/events`, `POST /api/svc/events` | a group calendar and its members (Bearer `CAL_SVC_TOKEN`) |
| Mail | `PUT/DELETE /api/svc/groups/<address>` | a Stalwart mailing list or group account |

Chat, Drive and Mail are called with `x-proxy-auth-secret: $PROXY_SHARED_SECRET` on the internal
network; the gateway never forwards `/api/svc/` for them.

Other apps ask Groups who is in what through `@synergy/groups` (`groupsOf`, `groupMembers`,
`isGroupMember`, `principalsFor`). It calls these routes, which also need `PROXY_SHARED_SECRET`:

- `GET /api/svc/memberships?email=` every group a person is in, nested groups included
- `GET /api/svc/groups/<id>` a group's owners and flattened members
- `POST /api/svc/groups/<id>/resources` `{ app, ref, name, url }` links something another app
  made for the group (a Sites team site), shown as a button on the group's page; `DELETE ?app=`
  removes the link

Access lists that grant a group store `group:<id>` next to plain emails, so a check is one
overlap with `principalsFor(email)`.

## Run it locally

```
npm install && npm run build:packages     # from the repository root
docker run -d --name groups-pg -e POSTGRES_PASSWORD=dev -p 5499:5432 postgres:16-alpine
cd apps/groups
DATABASE_URL=postgres://postgres:dev@127.0.0.1:5499/postgres DEV_USER_EMAIL=you@example.com npm run dev   # http://localhost:3830
```

Chat (3080), Drive (3180), Calendar (3130) and Mail (3200) are found on localhost at their
usual ports; set `CHAT_INTERNAL_URL`, `DRIVE_INTERNAL_URL`, `CALENDAR_INTERNAL_URL` or
`MAIL_INTERNAL_URL` to point elsewhere. Without them the team still works and its Settings tab
says which app it couldn't reach.

`npm test` runs the tests against `TEST_DATABASE_URL` (skipped without it), with the other apps
replaced by a stand-in.

## Settings

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string. Required in production. |
| `GROUPS_MAIL_DOMAIN` | Domain of group addresses (default `MAIL_DOMAIN`, then `SUITE_DOMAIN`). |
| `GROUPS_ADMIN_EMAILS` | Comma-separated people who may manage, join and restore every group. |
| `GROUPS_CREATE` | `admins` lets only them create groups; empty lets everyone. |
| `CAL_SVC_TOKEN` | Calendar's service token; without it teams have no calendar. |
| `PROXY_SHARED_SECRET` | Proves calls came through the gateway or from another suite server. |
| `CHAT_INTERNAL_URL`, `DRIVE_INTERNAL_URL`, `CALENDAR_INTERNAL_URL`, `MAIL_INTERNAL_URL` | Where the other apps are (default `http://<app>:<port>` in production). |
