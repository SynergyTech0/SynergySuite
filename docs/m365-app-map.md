# Microsoft 365 apps vs what Synergy already has (2026-10-15)

| M365 app | What it does | Synergy today | Status |
|---|---|---|---|
| Outlook Mail | Mailbox, inbox, send/receive | `apps/mail` with Stalwart | Have |
| Outlook Calendar | Calendars, invites, free/busy | synergycal | Have |
| People (Contacts) | Address book, org directory | `apps/contacts` | Have |
| Teams chat | Channels, DMs, threads | synergychat | Have |
| Teams meetings | Video calls, guests, recording | synergymeet (LiveKit) | Have |
| Word | Documents, co-editing | synergydocs (Tiptap + Hocuspocus) | Have |
| Excel | Spreadsheets | synergydocs (Univer) + workspace `sheets` | Have |
| PowerPoint | Slides | synergydocs slides + workspace `slides` | Have |
| OneDrive | Personal file storage, sharing | `apps/drive` (TypeScript) | Have |
| SharePoint | Team sites, intranet, doc libraries | synergysites (page builder) + Drive shared libraries | Partial |
| OneNote | Notebooks | synergynotes (wiki) + workspace `keep` | Partial |
| Forms | Surveys, quizzes | synergyforms + workspace `forms` | Have |
| Planner | Team task boards | synergyboards | Have |
| To Do | Personal tasks | `apps/todo` | Have |
| Lists | Structured lists/trackers | none | **Gap** |
| Loop | Shared live components | none | **Gap** |
| Bookings | Public appointment booking | synergymeet `schedule` (partial) | Partial |
| Viva Engage / M365 Groups | Communities, group mailboxes | workspace `groups` | Prototype |
| Stream / Clipchamp | Video library, recordings | none (meet recordings only) | **Gap** |
| Power Automate | Workflows between apps | `apps/flow` (Synergy Flow) on the Activepieces engine, with Synergy steps for the suite apps | Have |
| Power BI | Dashboards, reports | none in suite (opendash exists separately) | **Gap** |
| Microsoft Search | One search across mail, files, chats, sites | `apps/search` (fans out to each app's `/api/search` as the signed-in person) + search box in the suite header | Have |
| Copilot | AI assistant across apps | `apps/search` Ask tab: answers from the person's own search results with citations, on your own model; no in-app drafting or actions | Partial |
| Dynamics 365 Sales | Accounts, leads, opportunity pipeline | `apps/crm` | Have |
| Dynamics 365 Customer Service | Help desk tickets, knowledge base | `apps/desk` | Have |
| Dynamics 365 Business Central | Accounting, quotes, invoices | `apps/books` | Have |
| Entra ID | Sign-in, SSO, MFA, directory | synergyauth | Have, strongest piece |
| Admin center | Users, licences, settings | `apps/admin` + synergyauth admin console | Have |
| Purview / eDiscovery | Retention, legal hold, search | `apps/admin` Compliance, `@synergy/compliance` in each app | Have |
| Microsoft 365 home / app launcher | Portal and waffle | workspace home + Hub `sa_apps` waffle | Partial |

## Synergy apps that are not part of M365

synergysign (DocuSign-style), synergymail (Mailchimp-style), synergyportal (customer portal), synergypeople (HR / PTO), synergy-ui (Android UI library). These can stay as optional add-ons rather than core suite apps.
