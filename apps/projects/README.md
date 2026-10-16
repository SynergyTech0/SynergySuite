# Synergy Projects

Project plans, timesheets and billing: the suite's answer to Microsoft Project and
Dynamics 365 Project Operations. A plan says what has to happen and when, the team logs
time and expenses against it, managers approve them, and approved work is billed to the
client through Synergy Books.

## What it does

- **Plans**: tasks with outline numbers (1, 1.1, 1.2), summary tasks that roll up dates,
  estimates and progress from their subtasks, milestones, finish-to-start links that push
  later work out when earlier work slips, working-day durations (Monday to Friday),
  percent complete, assignees, and a Gantt chart beside the grid.
- **Drafts**: describe the project and get a phased plan with durations and estimates,
  on the suite's AI setting (`AI_*`, or `PROJECTS_AI_*` for its own model). Without a
  model the button is hidden and everything else works.
- **Planner**: link a Planner board and import it. Each list becomes a summary task and
  each card a task with its dates, estimate and completion; importing again updates the
  same tasks.
- **Team**: managers and members, each with a bill rate, a cost rate and weekly capacity.
  Only managers see rates and money.
- **Time**: a weekly timesheet per person across all their projects, a running timer that
  adds into today's cell, submit and take back by week.
- **Expenses**: amount, category, billable flag and a receipt (picture or PDF, up to
  10 MB), submitted for approval.
- **Approvals**: managers approve or send back time and expenses with a reason. Approving
  time fixes its bill and cost rate.
- **Billing**: time and materials (approved, billable time at each person's rate, grouped
  by task, person or entry), fixed fee (bill the fee in parts) or not billed. Billable
  expenses go on either kind. Billing creates a draft invoice in Books for the project's
  client; without Books it is recorded here with a CSV of the lines. Undo puts the time and
  expenses back to unbilled.
- **Reports**: percent complete, hours against budget, the last 12 weeks of hours, each
  person's hours, load this week and work left, and for managers billed, unbilled, cost and
  budget.

## How it fits the suite

- Sign-in is the suite's gateway; people see only projects they are on.
- Books: set the same `BOOKS_SVC_TOKEN` on Projects and Books. Projects calls
  `POST /api/svc/invoices` on `BOOKS_INTERNAL_URL` (default `http://books:3055` in the
  Docker deploy). Draft invoices are reviewed and sent from Books, which is when they post
  to the ledger.
- Planner: read as the signed-in person over `PLANNER_INTERNAL_URL` (default
  `http://planner:3600`), so only boards they can open are offered.
- Search finds projects and tasks; the Admin center's eDiscovery and legal hold cover
  projects, tasks, time entries and expenses (receipts are exported as attachments).

## Run it locally

```sh
createdb projects
npm run dev --workspace apps/projects   # http://localhost:3820
```

`DATABASE_URL` defaults to `postgres://postgres@127.0.0.1:5499/projects`. Tests need a
scratch database in `TEST_DATABASE_URL`:

```sh
TEST_DATABASE_URL=postgres://postgres@localhost:5432/projects_test npm test --workspace apps/projects
```

## Credits

Projects is an original part of Synergy Suite. It uses Next.js, React, Postgres and the
Lucide icons, all under their own open source licences.
