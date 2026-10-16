# Microsoft 365 apps vs what Synergy already has (2026-10-15)

| M365 app | What it does | Synergy today | Status |
|---|---|---|---|
| Outlook Mail | Mailbox, inbox, send/receive | `apps/mail` with Stalwart | Have |
| Outlook Calendar | Calendars, invites, free/busy | synergycal | Have |
| People (Contacts) | Address book, org directory | `apps/contacts` | Have |
| Teams chat | Channels, DMs, threads | synergychat | Have |
| Teams meetings | Video calls, guests, recording | synergymeet (LiveKit) | Have |
| Teams Phone | Calling, phone numbers, voicemail | `apps/phone` (LiveKit + LiveKit SIP, any SIP trunk or PBX) | Have |
| Word | Documents, co-editing | synergydocs (Tiptap + Hocuspocus) | Have |
| Excel | Spreadsheets | synergydocs (Univer) + workspace `sheets` | Have |
| PowerPoint | Slides | synergydocs slides + workspace `slides` | Have |
| OneDrive | Personal file storage, sharing | `apps/drive` (TypeScript) | Have |
| SharePoint | Team sites, intranet, doc libraries | synergysites (page builder) + Drive shared libraries | Partial |
| OneNote | Notebooks | synergynotes (wiki) + workspace `keep` | Partial |
| Forms | Surveys, quizzes | synergyforms + workspace `forms` | Have |
| Planner | Team task boards | synergyboards | Have |
| To Do | Personal tasks | `apps/todo` | Have |
| Whiteboard | Infinite collaborative canvas | `apps/whiteboard` (Excalidraw, live with Yjs) | Have |
| Lists | Structured lists/trackers | none | **Gap** |
| Loop | Shared live components | none | **Gap** |
| Bookings | Public appointment booking | synergymeet `schedule` (partial) | Partial |
| Viva Engage / M365 Groups | Communities, group mailboxes | workspace `groups` | Prototype |
| Visio | Flowcharts, org charts, network and floor plans | `apps/diagrams` (draw.io editor, .vsdx import; no .vsdx export) | Have |
| Stream / Clipchamp | Video library, recordings | none (meet recordings only) | **Gap** |
| Power Automate | Workflows between apps | none (n8n runs separately on your PC) | **Gap** |
| Power Apps | Low-code business apps | `apps/builder` (Synergy Builder, on Base data) | Have |
| Power BI | Dashboards, reports | `apps/insights` (Synergy Insights, on Metabase) | Have |
| Microsoft Search | One search across mail, files, chats, sites | `apps/search` (fans out to each app's `/api/search` as the signed-in person) + search box in the suite header | Have |
| Copilot | AI assistant across apps | `apps/search` Ask tab: answers from the person's own search results with citations, on your own model; no in-app drafting or actions | Partial |
| Dynamics 365 Sales | Accounts, leads, opportunity pipeline | `apps/crm` | Have |
| Dynamics 365 Customer Service | Help desk tickets, knowledge base | `apps/desk` | Have |
| Dynamics 365 Business Central | Accounting, quotes, invoices | `apps/books` | Have |
| Dynamics 365 Supply Chain Management | Manufacturing (BOMs, routings, work orders, MRP), asset management and maintenance | `apps/ops` | Have |
| Entra ID | Sign-in, SSO, MFA, directory | synergyauth | Have, strongest piece |
| Admin center | Users, licences, settings | `apps/admin` + synergyauth admin console | Have |
| Intune | Device inventory, compliance policies, enrollment | `apps/devices` (osquery agents); no lock, wipe, settings or app push yet | Partial |
| Defender for Endpoint | Threat detection, vulnerabilities, hunting | `apps/devices` detections, indicators, OSV vulnerabilities, live queries; detects and alerts, doesn't block | Partial |
| Purview / eDiscovery | Retention, legal hold, search | `apps/admin` Compliance, `@synergy/compliance` in each app | Have |
| Microsoft 365 home / app launcher | Portal and waffle | workspace home + Hub `sa_apps` waffle | Partial |

## Synergy apps that are not part of M365

synergysign (DocuSign-style), synergymail (Mailchimp-style), synergyportal (customer portal), synergypeople (HR / PTO), synergy-ui (Android UI library). These can stay as optional add-ons rather than core suite apps.
