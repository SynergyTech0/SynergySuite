# Synergy Suite

![Moving between Calendar, Mail, Chat, Planner and Notes through the suite's app launcher](docs/images/hero.gif)

Synergy Suite is an open source, self-hosted productivity suite modeled on Microsoft 365: mail, calendar, chat, meetings, documents, spreadsheets, slides, forms, planner, sites and notes, all behind one sign-in that you run yourself. It is licensed under the AGPL-3.0, uses Postgres for storage, and starts on one machine with Docker and one command. The apps were built separately and are being moved onto shared packages so they work as one suite, so maturity varies from app to app; the table below says where each one stands.

## Status

Maturity: **usable** means the main workflows work day to day; **early** means the basics work and obvious features are missing; **prototype** means a demo or reference that is not ready to rely on; **standalone** means it works on its own but is not yet on the suite sign-in or in the Docker deploy.

| App | Microsoft 365 equivalent | In the Docker deploy | Maturity | What works today |
|---|---|---|---|---|
| Account (`apps/auth`) | Entra ID | yes | usable | OIDC and SAML identity provider, MFA (TOTP, passkeys), admin console, SCIM, app passwords for phone and desktop sync; signs in every app |
| Admin (`apps/admin`) | Microsoft 365 admin center, Purview eDiscovery, sensitivity labels and DLP | yes | early | People and sign-in blocking over SCIM, app health, suite-wide sensitivity labels (Mail, Drive, Docs, Sheets, Slides), data loss prevention rules with alerts for Mail, Drive and Chat, matters, legal holds, retention rules, keyword search and zip export across Mail, Drive, Chat, Calendar, Notes, Forms, Contacts, To Do, Bookings, CRM, Desk, Phone, Diagrams, Projects, Field Service, Groups, Devices, Ops, HR, Whiteboard, Loop, Campaigns and Sign, audit log; Move from Microsoft 365 (early): connects a tenant through an Entra app (read-only Graph), maps people to suite accounts (creating missing ones), and copies mail with its folders and flags, OneDrive, SharePoint libraries, calendar, contacts and To Do as resumable background jobs with per-person reports and delta re-runs for cutover, plus IMAP-to-IMAP mail import; no Teams chats, OneNote or Planner yet, and recurring meetings arrive as single occurrences |
| Search (`apps/search`) | Microsoft Search, Microsoft 365 Copilot chat | yes | early | One search box (also in every app's header) across Mail, Drive, Chat, Calendar, Notes, Forms, Contacts, To Do, Bookings, CRM, Desk, Ops, Office, Planner, Sites, Base, Builder, Insights, Phone, Diagrams, Projects, Field Service, Devices, HR, Whiteboard, Loop, Flow, Campaigns and Law, showing only what the signed-in person can open, with filters by app; an Ask tab that answers questions from those results with numbered citations, on your own AI model; Copilot in every app's header (a side panel) that answers, summarizes the open email, chat channel or Notes page, and proposes a To Do task, Calendar event, Mail draft, Chat post or Planner card that runs only after you press Confirm. Early: proposals use only the open item and the conversation, not a fresh search; Mail drafts open in compose rather than being saved to Drafts |
| Mail (`apps/mail`) | Outlook | yes | usable | Folders, search, reading pane, rich-text compose, reply and forward, recipient suggestions from Contacts, outside IMAP accounts, Draft with Copilot in compose (write, rewrite or shorten a reply, on your own AI model); Stalwart mail server included |
| Contacts (`apps/contacts`) | Outlook People | yes | early | Address book (emails, phones, addresses, birthdays, photos, notes), favorites, groups, A to Z index, search, vCard and Google/Outlook CSV import and export, organization directory with self-edited profiles, two-way sync with phone and desktop address books over CardDAV |
| CRM (`apps/crm`) | Dynamics 365 Sales | yes | early | Accounts, contacts, leads with conversion, opportunity pipeline board with weighted forecast, activities and My Day, referral partners with rewards owed and paid per referred lead or deal (and partner codes on web leads), owner-based roles, AI lead scoring on your own model, web-to-lead, CSV export; reps see their own records and ones shared with them, admins see everything |
| Desk (`apps/desk`) | Dynamics 365 Customer Service | yes | early | Ticket queues, email intake and threaded replies over IMAP/SMTP, internal notes, canned replies, public knowledge base, intake API, ticket feed for Portal; agents have full or assigned-only access, everyone else sees only their own requests |
| Ops (`apps/ops`) | Dynamics 365 Supply Chain Management (manufacturing, asset management) | yes | early | Items (stock mirrored from Commerce), work centers, versioned bills of materials with routings and cost roll-up, work orders (release, issue, operations, complete at actual cost), MRP planning with lead times, lot sizes, safety stock and reorder points, purchase requests; asset register with meters, straight-line book value, preventive plans by date or meter, maintenance orders with parts and labor; stock kept in Commerce, fixed assets sent to Books |
| To Do (`apps/todo`) | Microsoft To Do | yes | early | My Day with suggestions, Important, Planned, lists, steps, notes, due dates, reminders with browser notifications, repeating tasks, shared lists with assignments |
| Engage (`apps/engage`) | Viva Engage, Viva Connections | yes | early | Company home page with news, quick links, company sites and apps; feed with discussions, questions with best answers, praise badges, polls and articles; public and private communities with admins, pinned posts and announcements; storylines, follows, mentions, #topics, reactions and threaded replies; share to Chat; AI summaries and catch-up on your own model |
| Calendar (`apps/calendar`) | Outlook Calendar | yes | early | Day, week, month and agenda views with a mini month, personal and company calendars, attendees, repeating events (daily to yearly, exceptions, change this, this and following, or all), free/busy API, Draft with Copilot for event notes (on your own AI model), two-way sync with phone and desktop calendars over CalDAV |
| Bookings (`apps/bookings`) | Microsoft Bookings | yes | early | Public booking pages with services, staff and opening hours, free times from each person's suite calendar, buffers, notice and booking windows, custom questions, a Meet link per online appointment, confirmation, change and cancellation emails with calendar invites, reminders, customer links to reschedule or cancel, staff booking on a customer's behalf, customer list, embedding in Sites |
| Chat (`apps/chat`) | Teams chat | yes | usable | Channels, direct messages, threads, reactions, mentions, unread counts, search, real-time updates |
| Meet (`apps/meet`) | Teams meetings | yes | early | Video rooms on LiveKit, scheduling, guest links; the LiveKit media server runs in the compose file and the local quickstart (TCP and UDP media, no built-in TURN relay); recording needs LiveKit Egress, deployed separately |
| Phone (`apps/phone`) | Teams Phone | yes | early | Calls between colleagues in the browser, real phone numbers through any SIP provider or office PBX, voicemail with greetings and transcripts, forwarding, do not disturb, ring your mobile too, add people and transfer, move a call into Meet, call a phone into a meeting; uses Meet's LiveKit media server plus LiveKit SIP (an optional `sip` compose profile) |
| Office (`apps/office`) | Word, Excel, PowerPoint | yes | usable | Documents, spreadsheets and slides with live co-editing, comments and sharing; opens and saves .docx, .xlsx and .pptx (with round-trip fidelity scripts over public test files); formulas, pivots, charts and conditional formatting in sheets; themes, transitions, animations and presenter view in slides |
| Drive (`apps/drive`) | OneDrive | yes | usable | Folders, drag-and-drop and folder uploads, previews (images, PDF, video, audio, text), version history, sharing with people, view links, shared libraries, recycle bin, search inside text files, zip downloads, storage quotas, AI summaries |
| Whiteboard (`apps/whiteboard`) | Microsoft Whiteboard | yes | early | Infinite canvas (Excalidraw) that everyone on a board draws on at once with live cursors, sticky notes, seven templates, sharing with editors and viewers or by link, copies saved to Drive (.excalidraw, .png, .svg) and .excalidraw files opened from Drive, a board for each meeting and chat, AI sticky-note ideas on your own model |
| Forms (`apps/forms`) | Forms | yes | early | Form builder, public form links, responses, CSV export; each form has an owner who shares it with people or the whole organization as editors or viewers, and search only shows forms you can open |
| Planner (`apps/planner`) | Planner | yes | usable | Boards, lists, cards, checklists, comments, labels; board, table, calendar and timeline views; Trello and Jira import |
| Diagrams (`apps/diagrams`) | Visio | yes | early | Flowcharts, org charts, network, UML, ER, BPMN and floor plans in the draw.io editor with its full shape libraries; template gallery, Visio (.vsdx) import, multi-page diagrams, autosave with conflict warnings, version history, sharing with editors and viewers, PNG, SVG and PDF export, AI drafting on your own model |
| Commerce (`apps/commerce`) | Dynamics 365 Commerce, Supply Chain | yes | early | Products with barcodes, stock by location at moving-average cost, purchase orders and receiving, a point-of-sale register with shifts and refunds, an online store with pickup or delivery, every sale and stock change posted to Books; card payments through a pluggable payment provider |
| Groups (`apps/groups`) | Microsoft 365 Groups, Teams teams, shared mailboxes, distribution lists | yes | early | Teams that give their people a Chat workspace with channels, a Drive library, a group calendar and a shared mailbox, with a team page for posts, files and meetings; distribution lists (outside addresses allowed) and shared mailboxes on the suite mail server; security groups other apps grant access to; nested groups, owners, public teams to join and private ones to ask, restore for 30 days; search and eDiscovery |
| Contracts (`apps/contracts`) | Dynamics 365 and Syntex contract management | yes | early | Contract lifecycle: templates with fields and a clause library with required clauses, guidance and fallbacks; drafting with every version kept and a redline between versions; ordered approvals; signatures through Sign (by API, or printed and uploaded back); renewal and notice deadlines with contracts that renew or expire by themselves; obligations with due dates; AI review on your own model against the clause library; per-person access with a legal team that sees everything; suite search and eDiscovery |
| Learn (`apps/learn`) | Viva Learning | yes | early | Training: a course catalog; reading and video lessons with multiple-choice quizzes graded on the server (answers never reach the browser); My learning with progress; authors assign courses with due dates and follow each person's progress; printable certificates; suite search |
| Hire (`apps/hire`) | Dynamics 365 Human Resources recruiting | yes | early | Recruiting: jobs with a hiring manager and an AI first draft of the description on your own model; a public careers page that takes applications without an account (bot trap and a rate limit); a drag-and-drop pipeline from Applied to Hired with ratings, notes and a timeline; hired candidates added to HR in one step through HR's own API and rules; suite search |
| Projects (`apps/projects`) | Project, Dynamics 365 Project Operations | yes | early | Plans with outline numbering, summary tasks, milestones, finish-to-start links and a Gantt chart; AI plan drafts on your own model; Planner board import; team with bill and cost rates and weekly capacity; weekly timesheets and a running timer; expenses with receipts; approvals; billing of approved time, expenses and fixed fees into Books as draft invoices; budget, utilization and profit reports |
| Field Service (`apps/field`) | Dynamics 365 Field Service | yes | early | Work orders with checklists, photos and notes; a dispatch board with drag-and-drop booking, clash checks and suggested slots by skill; a phone view for technicians to travel, arrive, log parts and get the customer's signature; parts taken from Commerce stock; billing of time, parts and trip fees into Books as draft invoices; customer equipment imported from Ops; Desk cases turned into work orders with progress noted back |
| Flow (`apps/flow`) | Power Automate | yes | early | Flows between suite apps and hundreds of outside services, designed in the Activepieces flow designer (MIT) and run by its engine; Synergy steps for Mail, Calendar, To Do, Planner, Chat, Forms, Contacts, Drive, Desk and CRM that act as the flow's owner; starter recipes, on/off switches and run history in the suite; suite sign-in carried into the designer |
| Photo (`apps/photo`) | Designer / Photos | yes | early | The PhotoCraft image editor (layers, masks, PSD files) with a per-user image library |
| Base (`apps/base`) | Access, Lists | yes | usable | Databases of real Postgres tables: Access data types, datasheet editing, design view, sort, filter, search, lookups (single and multi-value) with enforced relationships, subdatasheets, a relationships diagram, a query designer with totals and criteria, SQL view with AI help (bring your own model), CSV import and export, Access (.accdb/.mdb) import of tables, records and relationships, forms with subforms that can be published as Synergy Forms online forms, reports with groups and totals that print or save as PDF, Lists-style gallery, board and calendar views, comments on records, data links that Sheets refreshes from, and sharing with owners, editors and viewers |
| Insights (`apps/insights`) | Power BI | yes | early | Dashboards and reports over Books, CRM, Desk, Base, Planner, Forms and Trust as read-only sources (no password, token or key columns), built in the Metabase report designer with your suite sign-in; dashboards shown inside Insights to the people who can open them; analysts and viewers |
| Builder (`apps/builder`) | Power Apps | yes | early | Low-code apps on Base tables: start from a table for a browse, view and edit app in one step, or lay out screens of labels, buttons, inputs, galleries and forms in the studio, wired with Power Fx formulas (112 functions). Reads and writes as the person using the app, so Base sharing applies; drafts, publishing, versions, sharing, RunFlow for Synergy Flow. |
| Stream (`apps/stream`) | Stream, Clipchamp | yes | early | Video library (upload, screen and camera recording, captions and transcripts, chapters, timed comments, sharing with people, the organization or a link, embeds) and a video editor on the FilmCraft engine; AI captions, summaries and chapters through your own model |
| Sites (`apps/sites`) | SharePoint | yes | early | Page builder with private team sites (owners, members and visitors, by person or group) and communication sites that can be published to the web; group sites that follow a Groups team; a Drive document library per site; search and eDiscovery only show what each person can open |
| Books (`apps/books`) | Dynamics 365 Business Central | yes | early | Double-entry ledger, invoices, estimates, bills, bank reconciliation, payroll, inventory, sales tax, financial reports, customer payments through Stripe or Square; budgets vs actuals and rolling forecasts; multiple companies with intercompany entries and consolidated reports |
| CAD (`apps/cad`) | AutoCAD-style drafting, 3D modeling | yes | early | 2D drafting with DWG and DXF (CADCraft), 3D modeling with STEP, IGES and STL (Chili3D), drawings made from 3D models, review links, version history, folders; CADCraft is pre-alpha upstream and drops entities it doesn't model yet when saving |
| Notes (`apps/notes`) | OneNote | yes | usable | Wiki spaces, page tree, live co-editing, version history, comments, attachments, PDF and Word export |
| Devices (`apps/devices`) | Intune, Defender for Endpoint | yes | early | Windows, macOS and Linux computers enrolled with the open source osquery agent: hardware, OS, software and sign-in inventory; compliance policies (disk encryption, firewall, antivirus, screen lock, updates, OS version, admins, vulnerabilities, open threats); threat detections and known-bad file hashes with alert triage; OSV vulnerability scanning of Linux packages; live queries; evidence for Trust; iPhone, iPad and Mac management (NanoMDM) and Android management (work profile or fully managed) with remote lock, erase, configuration profiles and app installs |
| Loop (`apps/loop`) | Loop | yes | early | Shared workspaces with a page tree and live co-editing; live components (task list, checklist, table, voting table, progress tracker, Q&A, lists, text) that stay in sync on every page and Chat message they're pasted into; Copilot drafting, summaries and task extraction on your own AI model |
| Trust (`apps/trust`) | Purview Compliance Manager | yes | early | SOC 2, ISO 27001, HIPAA and GDPR readiness: control library mapped across frameworks, automated evidence collectors and a collector agent, append-only evidence and audit log, opt-in public trust centre |
| Home, Groups (`prototype/workspace`) | Microsoft 365 home, Groups | no | prototype | Zero-dependency Node prototype kept as a reference; its Admin, Purview, People, To Do and Groups parts now live in `apps/admin`, `apps/contacts`, `apps/todo` and `apps/groups` |
| HR (`apps/hr`) | Dynamics 365 Human Resources, payroll | yes | early | Employee records with HR-only and self-service fields, org chart, time off with balances, approvals and company holidays, onboarding and leaver checklists, US payroll (salary and hourly, 2026 federal withholding, Social Security, Medicare, FUTA, state income tax for all 50 states and DC, pre-tax and Roth deductions with employer match), pay runs with approval, printable pay stubs, direct deposit (NACHA) files with SSNs and bank accounts encrypted, W-2s and the SSA W-2 file, Forms 941 and 940, state quarterly figures, paid runs posted to Books as a journal entry; no local taxes yet |
| Portal add-on (`addons/portal`) | (customer portal) | yes | early | Client records with private share links |
| Sign add-on (`addons/sign`) | (DocuSign-style) | yes | early | E-signatures: upload a PDF, place fields, send to several signers in parallel or in order, templates, audit trail and a signed PDF with a certificate page; suite sign-in for senders, while signers outside the organization sign from their emailed link with no account; requests sent from the suite mailbox; suite search and eDiscovery with legal hold; optional AI field detection (bring your own model). Still on Next.js 14 with its own lockfile; billing, affiliate and enterprise-account pages from the hosted product are hidden or unused |
| Campaigns add-on (`addons/campaigns`) | Dynamics 365 Marketing, Mailchimp | yes | early | Audiences from CRM contacts and leads, Contacts groups, spreadsheets and a double opt-in signup form, kept in sync before each send; tags, custom fields and segments; a block email builder with merge tags, live preview and AI subject lines on your own model; campaigns sent now or on a schedule through the suite's mail server or any SMTP relay, throttled, with pause and cancel; welcome and tag automations; open and click tracking, a browser copy, one-click unsubscribe, bounce and spam-report handling over IMAP and a suite-wide do-not-email list; reports per link and per recipient; templates; roles; eDiscovery and suite search |
| Law add-on (`addons/law`) | (law practice management, Clio-style) | yes | early | Clients and matters with fee terms, team and parties; a conflict check on every new matter (names normalized, fuzzy and doing-business-as matches across all clients and parties, decided and recorded before the matter opens); court deadline calculator (FRCP/FRAP presets, federal holidays, mail days, court days); time and expenses at each person's rate, bills that go to Books as draft invoices; client trust accounts that never let a client go below zero, voids instead of edits, earned-fee transfers against bills, three-way reconciliation and Books journal entries; state rule guide for all 50 states and DC; case documents with text read from PDF and Word and an AI summary and matter overview on the suite's model |
| Desktop and mobile app (`clients/app`) | Microsoft 365 desktop and mobile apps | installers from CI | early | Windows, macOS, Linux, Android and iOS app that opens your suite's apps in a native window: launcher, outside links in the browser; on desktop an app menu with shortcuts and downloads to the Downloads folder. unsigned test builds from CI on every push; an `app-v*` tag builds signed Windows and notarized macOS installers and sends Android to Google Play internal testing and iOS to TestFlight |
| Android UI (`mobile/synergy-ui`) | | no | prototype | Kotlin UI component library; no app yet |

## Screenshots

From a local instance in demo mode, signed in as the demo user.

| | |
|---|---|
| ![Mail: inbox and reading pane](docs/images/mail.png) Mail | ![Calendar: week view](docs/images/calendar.png) Calendar |
| ![Chat: a channel](docs/images/chat.png) Chat | ![Notes: a wiki page](docs/images/notes.png) Notes |
| ![Planner: a board](docs/images/planner.png) Planner | ![Office: a document](docs/images/office.png) Office |

Every app shares the same header, whose app launcher links to the rest of the suite:

![The app launcher open over Calendar](docs/images/launcher.png)

## Try it

With Docker running:

```
git clone https://github.com/SynergyTech0/SynergySuite.git
cd SynergySuite
deploy/quickstart.sh
```

It generates `deploy/.env` with random secrets and an admin account, builds and starts the suite, and prints where to sign in (`https://calendar.suite.lvh.me`, as `admin@suite.lvh.me`). Certificates come from a local CA, so trust `deploy/local-ca.crt` or accept the browser warning. Details and trade-offs are in [deploy/README.md](deploy/README.md#try-it-on-your-machine).

To start with sample content instead of an empty suite, run `DEMO_MODE=1 deploy/quickstart.sh` the first time. It seeds a made-up company in calendar, chat, notes, planner and mail, and the sign-in page offers a shared demo login; see [Demo mode](deploy/README.md#demo-mode).

## Repository layout

| Path | M365 equivalent | Stack today |
|---|---|---|
| `apps/auth` | Entra ID (SSO, MFA, SCIM, OIDC/SAML) | Next.js 15 |
| `apps/admin` | Microsoft 365 admin center, Purview eDiscovery, Microsoft 365 migration | Next.js 16 + Postgres |
| `apps/search` | Microsoft Search, Microsoft 365 Copilot chat | Next.js 16, no database |
| `apps/mail` | Outlook mail | Next.js 15 + Stalwart mail server |
| `apps/calendar` | Outlook calendar | Express + React/Vite |
| `apps/bookings` | Microsoft Bookings | Next.js 16 + Postgres |
| `apps/chat` | Teams chat | Express + ws + React/Vite |
| `apps/meet` | Teams meetings | Next.js 15 + LiveKit |
| `apps/phone` | Teams Phone | Next.js 16 + Postgres + LiveKit SIP |
| `apps/office` | Word, Excel, PowerPoint | Next.js 15 + Tiptap/Hocuspocus + Univer |
| `apps/drive` | OneDrive | Next.js 16 + Postgres, file contents on disk |
| `apps/contacts` | Outlook People | Next.js 16 + Postgres |
| `apps/todo` | Microsoft To Do | Next.js 16 + Postgres |
| `apps/engage` | Viva Engage, Viva Connections | Next.js 16 + Postgres |
| `apps/crm` | Dynamics 365 Sales | Next.js 16 + Postgres |
| `apps/desk` | Dynamics 365 Customer Service | Next.js 16 + Postgres |
| `apps/diagrams` | Visio | Next.js 16 + Postgres + draw.io (Apache-2.0) |
| `apps/ops` | Dynamics 365 Supply Chain Management (manufacturing, assets) | Next.js 16 + Postgres |
| `apps/hr` | Dynamics 365 Human Resources, payroll | Next.js 16 + Postgres |
| `apps/whiteboard` | Microsoft Whiteboard | Next.js 16 + Excalidraw + Hocuspocus/Yjs |
| `apps/flow` | Power Automate | Next.js 16, no database; runs on Activepieces Community Edition (its own Postgres and Redis) |
| `apps/forms` | Forms | Express + React/Vite |
| `apps/planner` | Planner | Next.js 16 + Drizzle |
| `apps/commerce` | Dynamics 365 Commerce, Supply Chain | Next.js 16 + Postgres |
| `apps/groups` | Microsoft 365 Groups, Teams teams | Next.js 16 + Postgres |
| `apps/contracts` | Dynamics 365 and Syntex contract management | Next.js 16 + Postgres |
| `apps/learn` | Viva Learning | Next.js 16 + Postgres |
| `apps/hire` | Dynamics 365 Human Resources recruiting | Next.js 16 + Postgres |
| `apps/projects` | Project, Dynamics 365 Project Operations | Next.js 16 + Postgres |
| `apps/field` | Dynamics 365 Field Service | Next.js 16 + Postgres |
| `apps/photo` | Photo (image editing) | Next.js 16 + PhotoCraft (Rust, WebAssembly) |
| `apps/stream` | Stream (video library and editor) | Next.js 16 + ffmpeg + FilmCraft (Rust, WebAssembly) |
| `apps/cad` | CAD (2D drafting with DWG/DXF, 3D modeling, drawings from models, review links, version history, folders) | Next.js 16 + CADCraft (Rust, WebAssembly) + Chili3D (Open CASCADE, WebAssembly) |
| `apps/base` | Access, Lists | Next.js 16 + Postgres (one schema per database) |
| `apps/insights` | Power BI | Next.js 16 + Metabase (open source edition, AGPL) |
| `apps/builder` | Power Apps | Next.js 16 + Postgres, its own Power Fx interpreter, data in Base |
| `apps/sites` | SharePoint | Express + React/Vite |
| `apps/books` | Dynamics 365 Business Central (accounting) | NestJS + Prisma + React/Vite |
| `apps/notes` | OneNote | Express + React/Vite |
| `apps/devices` | Intune, Defender for Endpoint | Next.js 16 + Postgres, osquery agents |
| `apps/loop` | Loop | Next.js 16 + Tiptap/Hocuspocus (Yjs) + Postgres |
| `apps/trust` | Purview Compliance Manager | Next.js 16 + postgres.js (raw SQL migrations, row-level security) |
| `prototype/workspace` | 365 home, Groups | zero-dependency Node prototype, kept as a reference; Admin, Purview, People and To Do were ported into `apps/` |
| `addons/sign` | (DocuSign-style) | Next.js 14 + Prisma |
| `addons/campaigns` | Dynamics 365 Marketing, Mailchimp | Next.js 16 + Postgres, Nodemailer, ImapFlow |
| `addons/law` | law practice management | Next.js 16 + Postgres, unpdf, mammoth |
| `addons/portal` | customer portal | Express + React/Vite |
| `clients/app` | Microsoft 365 desktop and mobile apps | Tauri 2 (Rust) + TypeScript launcher page |
| `mobile/synergy-ui` | Android UI library | Kotlin |

## Shared packages

| Package | What it gives every app |
|---|---|
| `@synergy/identity` | Who is signed in (SynergyAuth via the gateway's headers), dev-user overrides, signed guest links |
| `@synergy/compliance` | The compliance protocol between the Admin center and each app: eDiscovery search and export routes, the shared keyword language, legal-hold and retention checks that fail closed, sensitivity labels, and the data loss prevention engine (sensitive information types, rules, incident reports) |
| `@synergy/search` | Suite-wide search for the signed-in person: the `POST /api/search` protocol each content app answers for the Search app, with query, snippet and text helpers |
| `@synergy/groups` | Who is in which group, from the Groups app: `groupsOf`, `groupMembers`, `principalsFor` for access lists that grant `group:<id>` |
| `@synergy/dav` | CalDAV and CardDAV for phone and desktop sync: discovery, PROPFIND, REPORT and sync-collection, used by Calendar and Contacts with Account app passwords |
| `@synergy/db` | Postgres pool, query helper, boot-time migrations under an advisory lock |
| `@synergy/server` | Express basics: sign-in and bearer-token middleware, JSON errors, health check, SPA serving |
| `@synergy/config` | The suite's app registry (`packages/config/apps.json`): names, M365 equivalents, unique ports, URLs |
| `@synergy/shell` | `<synergy-app-bar>`, the shared header with the app launcher, the suite search box and the Copilot panel |
| `@synergy/ai` | Bring your own AI model: one setting for the whole suite, any OpenAI-compatible server (OpenAI, Ollama, vLLM, LM Studio, OpenRouter, Azure, Groq) or Anthropic |

Every app and add-on uses them (sign through `file:` links, since it keeps its own lockfile). Auth is the identity provider the others sign in through, so it stays standalone.

## Running locally

```
npm install
npm run build:packages
npm run ports                      # each app's default port
DATABASE_URL=postgres://... DEV_USER_EMAIL=you@example.com node apps/calendar/server/index.js
```

`DEV_USER_EMAIL` signs every request in as that user when there is no gateway. It is ignored when `NODE_ENV=production`.

## AI: bring your own model

The suite doesn't depend on any AI vendor. AI features stay off until you choose a model, and every app uses the same settings: `AI_PROVIDER`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` and `AI_EMBEDDING_MODEL` (see `deploy/.env.example`). Run a local model with Ollama or vLLM to keep documents on your own hardware, or use a hosted API. An app can use a different model from the rest with prefixed settings such as `SIGN_AI_MODEL`.

Twenty-one apps and add-ons use it, including Copilot and the Ask tab in Search, Draft with Copilot in Mail and Calendar, Drive's file summaries, Meet's meeting notes, CRM lead scoring, Campaigns subject lines, Projects plan drafts, Devices alert explanations, CAD's assistant and Sign's field placement. New AI features go through `@synergy/ai` so they get the same choice.

## Self-hosting

See `deploy/README.md` for the one-command Docker setup on a server.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Please report security problems privately as [SECURITY.md](SECURITY.md) describes.

## License

Synergy Suite is licensed under the [GNU Affero General Public License v3.0](LICENSE). If you run a modified version as a network service, you must offer its source to your users.
