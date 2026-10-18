# Synergy LiveChat

A chat bubble for your websites and an inbox for answering visitors, the suite's answer to live chat in Dynamics 365 Contact Center. Rebuilt from the earlier standalone LiveChat tool on the suite's shared packages.

- **Widgets.** LiveChat admins (`LIVECHAT_ADMIN_EMAILS`, default `ADMIN_EMAILS`) add a widget per website with a name, greeting, colour, the site's domain and whether to ask for the visitor's name and email. The snippet is
  `<script defer src="https://livechat.<SUITE_DOMAIN>/widget.js" data-widget="wc_..."></script>`;
  in Sites, paste the widget key into a site's live chat setting.
- **The widget** draws inside a shadow root, so it neither takes nor leaks styles, and shows every message as plain text. It keeps only the chat's token in the browser, so a reload continues the same chat. It checks for replies every 3 seconds while open and every 20 seconds while closed (with a dot for a new reply).
- **Locked to the site.** The widget's API (`/api/wc/*`) answers only pages on the widget's domain and its subdomains, and only to that origin. Visitor tokens are random and only their hash is stored. Each address is rate limited, and so is each chat.
- **Inbox.** Anyone signed in can answer: open chats, chats assigned to you, and closed ones, with unread counts. Replying to an unassigned chat assigns it to you. Close a chat when it's done; the visitor writing again reopens it.
- **Send to Desk** opens a Desk ticket from the chat through Desk's intake API (`DESK_SVC_URL`, default `http://desk:3105`, with `DESK_SVC_TOKEN`, default `DESK_API_TOKEN`), with the whole transcript, the visitor as requester and the page it started on. The ticket number is noted on the chat and the visitor is told. It needs the visitor's email.

Port 3900, database `livechat`. Tests run against Postgres when `TEST_DATABASE_URL` is set: `npm test --workspace apps/livechat`.
