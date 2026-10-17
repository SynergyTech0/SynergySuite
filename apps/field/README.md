# Synergy Field Service

Work orders, scheduling and dispatch, and a phone view for technicians: the suite's answer
to Dynamics 365 Field Service. A job comes in (by hand or from a Desk case), a dispatcher
books it onto a technician's day, the technician travels, works through the steps, logs
parts and gets the customer's signature, and the finished job is billed through Synergy
Books.

## What it does

- **Work orders**: numbered jobs (WO-00001) for a customer and optionally one of their
  assets, with kind (repair, install, maintenance, inspection), priority, the skill it
  needs, due date, estimate, contact and address. Each kind starts with a checklist; a
  checklist can also be drafted from the description on the suite's AI setting (`AI_*`,
  or `FIELD_AI_*` for its own model). Notes, photos (camera capture on phones) and files
  sit on a timeline with every status change.
- **Dispatch board**: one lane per technician for the day, the waiting list beside it.
  Drag a job onto a lane to book it, drag a booking to move it (15-minute steps). Double
  bookings ask before going ahead. **Suggest** offers the next open slots on weekdays,
  preferring technicians with the right skill, then the earliest time, then the lightest
  day.
- **Technician view**: phones open on today's visits in order. Each job has map and call
  buttons, *On my way*, *Arrived* and *Leave, not done*, the checklist, parts and
  timeline, and *Complete job* with a resolution and the customer's signature on screen.
  Time on site becomes labor at the technician's bill rate.
- **Parts**: with Commerce linked, parts are picked from the catalog at their price and
  taken out of stock (a `service_issue` stock move costed to `FIELD_PARTS_ACCOUNT`,
  default 5000). Moves that fail are retried every five minutes and from the Team screen.
  Without Commerce, parts are typed in.
- **Billing**: a completed, billable job bills its labor, parts and a trip fee per visit.
  With Books linked it becomes a draft invoice for the customer; otherwise it is recorded
  here with its lines.
- **Customers and assets**: customers with their equipment (make, model, serial, location,
  install date, warranty). Equipment can be imported from the Ops asset register.
- **Team**: dispatchers and technicians with skills and bill rates, plus the currency,
  default labor rate, trip fee and time zone. The first person to open the app becomes
  its dispatcher.

## How it fits the suite

Each link turns on when its token is set, and is off otherwise:

- Books (`BOOKS_SVC_TOKEN`, same as on Books): `POST /api/svc/invoices` on
  `BOOKS_INTERNAL_URL` (default `http://books:3055`).
- Commerce (`COMMERCE_SVC_TOKEN`): `GET /api/svc/items` and `POST /api/svc/stock-moves` on
  `http://commerce:3730` (`FIELD_COMMERCE_URL` to override).
- Desk (`DESK_API_TOKEN`): `GET /api/svc/tickets/{number}` to start a job from a case and
  `POST /api/svc/tickets/{number}/notes` to add internal notes when it is booked,
  cancelled or completed, on `http://desk:3105` (`FIELD_DESK_URL`).
- Ops (`OPS_API_TOKEN`): `GET /api/svc/assets` on `http://ops:3760` (`FIELD_OPS_URL`).

Technicians see only jobs they are booked on, in the app and in Search. The Admin
center's eDiscovery and legal hold cover work orders, notes, files, customers and assets
(exports include visits, labor, parts, the timeline and the signature).

## Run it locally

```sh
createdb field
npm run dev --workspace apps/field   # http://localhost:3850
```

`DATABASE_URL` defaults to `postgres://postgres@127.0.0.1:5499/field`. Tests need a
scratch database in `TEST_DATABASE_URL`:

```sh
TEST_DATABASE_URL=postgres://postgres@localhost:5432/field_test npm test --workspace apps/field
```
