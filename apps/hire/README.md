# Synergy Hire

Job openings, a public careers page, applications and a hiring pipeline. Port 3940.

- **Jobs:** title, department, location, type, pay, description (with an optional AI first draft on the suite's model) and a hiring manager. A job is a draft, open (listed on the careers page) or closed.
- **Careers page:** `/careers` lists open jobs by department and `/careers/<job>` takes applications without signing in. A hidden field catches form-filling bots and each address is limited to 10 applications an hour. Applying twice to one job keeps the first application.
- **Pipeline:** Applied, Screening, Interview, Offer, Hired and Rejected, as a board you can drag candidates across. Each candidate has a 0 to 5 star rating, notes and a timeline of every stage change.
- **HR:** a hired candidate can be added to HR from their card. Hire calls HR as the person pressing the button, so HR's own rule (only HR admins add people) decides, and the candidate links to their HR record afterwards.
- **Search:** suite search finds jobs and candidates the searcher can see.

## Who sees what

- Recruiters (`HIRE_ADMIN_EMAILS`, default `ADMIN_EMAILS`) see and run every job, edit the careers page and delete candidates.
- A job's hiring manager sees that job's pipeline and can add candidates, move them, rate them and write notes.
- Everyone else sees nothing but the public careers page.

## Settings

| Variable | Meaning |
| --- | --- |
| `HIRE_ADMIN_EMAILS` | Recruiters, comma-separated (default `ADMIN_EMAILS`). |
| `HIRE_COMPANY_NAME` | Name on the careers page until a recruiter sets one in Careers page settings. |
| `HIRE_AI_*` | Give Hire its own model for job description drafts (default: the suite's `AI_*` settings). |
| `HIRE_APP_URLS` | JSON map of app id to internal URL, to reach HR somewhere other than `http://hr:<port>`. |

Résumés are links (to Drive or anywhere else); the careers page doesn't take file uploads.
