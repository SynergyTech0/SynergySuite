# Synergy Analytics

Privacy-friendly website analytics, the suite's answer to the web analytics in Dynamics 365 Customer Insights and to Clarity or Google Analytics. Rebuilt from the earlier standalone Insights tool on the suite's shared packages.

- **Sites.** Anyone signed in can add a website and gets its snippet:
  `<script defer src="https://analytics.<SUITE_DOMAIN>/script.js" data-site="sy_..."></script>`.
  With a domain set, only pages on that domain (with or without `www.`, and its subdomains) are counted. The site's owner and Analytics admins (`ANALYTICS_ADMIN_EMAILS`, default `ADMIN_EMAILS`) can rename or delete it; everyone signed in can see every site's numbers.
- **The script** sets no cookies and stores nothing in the browser. It sends a page view on load and on single-page navigation, and `window.synergy("signup")` sends a custom event. It sends nothing from localhost or when the browser asks not to be tracked. `/sy.js` is the same script at the earlier tool's address.
- **No personal data.** The collector keeps the page's path (no query string or fragment), the referring host, a device type from the screen width, and a visitor hash of the site, address and browser with a salt that changes every UTC day. Yesterday's salt is deleted, so a visitor is counted once a day and can't be followed from one day to the next. Addresses are never stored. Bots and empty browsers are dropped, and each address is limited to 120 beacons a minute.
- **Dashboard** per site over 24 hours, 7, 30 or 90 days: visitors, page views, views per visitor, custom events, a chart by hour or day, top pages, sources, events and devices, and how many people are on the site now.
- `POST /api/collect` always answers 204, whatever it is sent, so a site never shows an error. Events are kept unless `ANALYTICS_RETENTION_DAYS` is set.

The `sites` and `events` tables keep the earlier tool's columns, so its data (and its site keys, so existing snippets keep counting once they point here) loads straight in with `pg_dump --data-only -t sites -t events`.

Port 3890, database `analytics`. Tests run against Postgres when `TEST_DATABASE_URL` is set: `npm test --workspace apps/analytics`.
