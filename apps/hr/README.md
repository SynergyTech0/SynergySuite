# Synergy HR

People records, org chart, time off, onboarding checklists and US payroll, on the suite sign-in. It is the suite's Dynamics 365 Human Resources equivalent and replaces the former People add-on: it uses the same `people` database and extends its tables in place, so existing employees and time-off requests carry over.

Runs on port 3145 (`npm run dev -w apps/hr`). Needs `DATABASE_URL`; tables are created on first request.

## Who sees what

| Role | Set by | Can |
|---|---|---|
| Everyone | signed in | See the directory and org chart, edit their own contact details, ask for time off, see their own balances, tasks and pay stubs |
| Manager | being someone's `manager` | Also see their team's (all levels below) records, approve their time off and tick their checklist tasks |
| HR admin | `HR_ADMIN_EMAILS` (else `ADMIN_EMAILS`; the deploy also reads `PEOPLE_ADMIN_EMAILS`) | Add and edit everyone, HR notes, holidays, checklist templates, all time off |
| Payroll admin | `PAYROLL_ADMIN_EMAILS` (else the HR admins) | Pay profiles, deductions, pay runs, pay stubs and tax summaries for everyone |

Every change to a record, pay profile or pay run goes in the audit log (`GET /api/audit`, HR admins). Pay audit entries name the fields changed, never the amounts.

## Payroll

Pay runs go draft, approved, paid. A draft fills itself in from each person's pay profile, their approved time off and the company holidays in the period; payroll admins can change hours, add a bonus, or drop someone before approving. Off-cycle runs (bonuses) start empty.

What it calculates: salary (prorated for people who start or leave mid-period) and hourly pay with overtime, holiday, vacation and sick hours; federal income tax withholding by the IRS Publication 15-T percentage method for 2026 W-4s; Social Security up to the wage base, Medicare with the additional 0.9%, employer FUTA, an employer state unemployment rate on its own wage base, and state income tax withholding for all 50 states and DC (below). Pre-tax 401(k) and Section 125 benefits, Roth and after-tax deductions, yearly limits and an employer match.

State withholding uses each state's own annualized formula from its 2026 publication (2025 for Alabama and Kansas, whose tables carry over): standard deduction, personal exemption and allowances, flat rate or brackets by filing status, per-allowance credits, and federal tax subtracted where the state does that. Enter what the employee put on the state's form (DE 4, IT-2104, G-4 and so on) on their Pay tab, or pick "a flat percent" to keep a rate you set yourself. The figures and the publication each comes from live in `lib/payroll/state-tables.ts`, so a new year is a data change. Known gaps, noted in that file: phase-outs and low-income credits some states add (ME, WI, CT, OR, UT, SC, AR, CA, MA), the NY flat rate on very high wages, and local taxes (cities, counties, school districts). Figures for AL, CT, DC, DE, NJ, PA and WI came from secondary summaries; check those against the state's guide before relying on them.

Direct deposit: each person's Pay tab has their legal name, address, Social Security number and bank account. The two numbers are encrypted with `HR_DATA_KEY` and only their last four digits are shown again or written to the audit log. Under Payroll, **Company and bank** holds the EIN, address, state account numbers and your bank's ACH details. An approved or paid run then has a **Deposit file**: a NACHA PPD file of every direct-deposit paycheck to upload to your bank. Savings accounts get savings credits, and a balancing debit from the company account is added if your bank wants balanced files. The download is refused while anyone paid by deposit has no bank account on file, so nobody is left out without notice.

What it does not do yet: local taxes, tax filings and tax deposits, W-2s.

**Check before paying real people.** The tax figures are written from the published 2026 IRS tables and tested against hand-worked examples, but nobody has certified them. Compare a run against a payroll provider or Publication 15-T before relying on it.

### Posting to Books

When `BOOKS_SVC_TOKEN` is set (the same token Books has), paying a run posts one journal entry to Books (`BOOKS_INTERNAL_URL`, default `http://books:3055`): wages, employer taxes and employer benefit costs as expenses against taxes, benefits and net pay owed. Accounts are created in Books if they are missing; their numbers can be changed under Payroll settings. Posting is safe to retry: Books keeps one entry per pay run. If Books has more than one company, set its id under Payroll settings or `BOOKS_SVC_ORGANIZATION_ID` on Books.

## Settings

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres; the deploy uses the `people` database |
| `HR_ADMIN_EMAILS`, `PAYROLL_ADMIN_EMAILS` | Comma-separated admins (see above) |
| `HR_DATA_KEY` | 32 bytes, as 64 hex characters or base64 (`openssl rand -hex 32`). Encrypts Social Security and bank account numbers; without it they can't be saved. Back it up: the numbers can't be read without it |
| `BOOKS_SVC_TOKEN`, `BOOKS_INTERNAL_URL` | Post paid pay runs to Books |
| `COMPLIANCE_TOKEN` | Lets the Admin center search and export employees, time off and paychecks |

## Tests

`TEST_DATABASE_URL=postgres://... npm test -w apps/hr` from the repository root. The payroll tests need no database; the integration tests create and drop their own `<database>_hr`.
