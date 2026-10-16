# Synergy Base (Access and Lists equivalent)

Databases in the suite: tables of records you can sort, filter, search, import and export, built
on Postgres. It covers what Microsoft Access and Microsoft Lists are used for, and grows in
milestones (see "Coming next").

- **App:** Next.js 16 + React 19 (port 3680)
- **Data:** Postgres, through `@synergy/db`
- **Auth:** the suite gateway signs people in; `@synergy/identity` reads who they are.

## What works

- **Databases.** The start page makes a blank database and lists the ones you can open. Each
  database is a Postgres schema of its own (`db_<id>`), so its tables are ordinary Postgres tables
  that reporting tools and SQL clients can read directly.
- **Tables.** A new table gets an AutoNumber **ID** primary key (as in Access) and a **Title**
  field (as in Lists). Tables open as tabs; the navigation pane lists them and can rename or
  delete them.
- **Data types.** Short Text (with a field size), Long Text, Number, Currency, Date, Date/Time,
  Yes/No, Choice, Multiple choice, Email, Hyperlink, Phone, Lookup and Lookup (multiple values). Each is a real Postgres column type
  (numeric, date, timestamptz, boolean, text[] ...). Fields can be required, indexed with no
  duplicates (a unique index), and given a default value.
- **Datasheet view.** Click a cell to select it; type, press Enter or double-click to edit; Enter
  or Tab saves, Esc cancels; arrow keys move. The row marked `*` adds a record. Headers sort;
  **Filter** builds conditions matched all or any; **Search** looks in every field. Check records
  to delete them. "Click to Add" adds a field of any type. **Export CSV** downloads what the view
  shows (formula-looking cells are defused so a spreadsheet won't run them).
- **Design view.** Every field with its data type and description, and the selected field's
  properties underneath. Changing a data type converts the stored values in place; if any can't be
  converted (say "lots" in a field becoming Number), nothing changes and the reason is shown.
  Making a field required is refused while records have it empty.
- **Relationships.** A **Lookup** field points each record at a record in another table of the
  same database (or the same table, say an employee's manager). It is a real foreign key on the
  target's ID, with the delete rule Access calls referential integrity: refuse while records point
  at it, delete them too (cascade), or leave the lookup blank. The datasheet shows the related
  record's display field (the first field after the ID unless you pick another), and the cell
  editor searches the related table. Sort, filter and search work on that text. A Number field
  holding record IDs can be turned into a lookup; one with IDs that don't exist is refused. A table
  that others look up can't be deleted until those fields are.
- **Multi-value lookups.** A **Lookup (multiple values)** field (or "Allow multiple values" in the
  new lookup dialog) holds several related records, as Access's multivalued lookups and Lists'
  "allow multiple selections" do. It is a `bigint[]` column kept honest by triggers, since
  Postgres has no foreign keys on arrays: IDs that don't exist are refused, and deleting a related
  record takes it off every list. Cells show the records as chips in the order they were picked;
  the editor searches the related table, Enter or a click adds or removes one, and Done saves.
  Filters match a related record or its text, the related table's subdatasheets and subforms list
  the records that include it, the query designer joins through it, SQL can use
  `= ANY(field)`, and reports and CSV show the names joined by "; ". A single lookup can be turned
  into a multi-value one, keeping its values.
- **Subdatasheets.** A table that others look up shows `+` beside each record, which opens the
  related records underneath (picking the table when several look it up). Records added there are
  linked to the record above.
- **Relationships diagram.** Under Tools, every table as a box and every lookup as a line from
  the many side (∞) to the one side (1), with the delete rules listed below. Drag boxes to arrange
  them; double-click one to open the table.
- **Queries.** **New query** opens the query designer, as in Access: add tables (they join along
  their Lookup fields, with Access's three join kinds), click fields into the grid, and set Sort,
  Show and Criteria for each. Criteria use Access's syntax (`>100`, `"Leeds"`, `Like "S*"`,
  `Between #1/1/2026# And #3/31/2026#`, `Is Null`, `In ("a", "b")`, `<Date()`); each "or" row is
  an alternative. **Totals** groups the results (Group By, Sum, Avg, Min, Max, Count, StDev, Var,
  Where), and there are Unique values, Top values and calculated columns
  (`[Price] * [Quantity]`). **SQL view** shows the query as SQL and lets you write one by hand;
  **Datasheet view** runs it. Saved queries can be read by other queries by name, and **Export
  CSV** downloads a saved query's results. A design query follows
  tables and fields that are renamed after it was saved.
- **AI help writing queries.** With an AI model set up for the suite (`AI_*` settings, or
  `BASE_AI_*` to give Base its own; see `@synergy/ai`), SQL view has an **Ask AI** box: describe
  the query and the model writes it. The model sees the database's tables and fields, never its
  records, and what it writes is checked like any other query before anything runs.
- **Forms.** **New form** picks a table and lays out its fields, as Access's Form button does:
  Form view shows one record at a time with a box for each field, moves first, previous, next and
  last (moving on saves the record, as in Access), adds and deletes records, and finds records by
  search. Each table that looks this one up becomes a **subform** listing the related records,
  where new ones are linked to the record shown. **Design view** picks the fields, their order and
  labels, which ones span the form, one or two columns, the title, the subforms, and whether the
  form allows edits, additions and deletions.
- **Online forms (Synergy Forms).** **Publish online** in a form's Design view makes a public
  form in Synergy Forms asking the form's fields (text, numbers, dates, email, a choice, Yes/No;
  related records and several-choice fields can't be asked online yet, and the notes say so).
  Anyone with the link can fill it in without access to the database. **Get responses** in Form
  view brings the responses that came in since last time into the table as new records, each
  checked like a typed record; one that doesn't fit is skipped and its reason shown. **Update
  online form** asks the current fields (responses already in are brought in first), **Stop taking
  responses** closes it, and deleting the form closes it too. Base calls Synergy Forms' API as the
  signed-in person; `FORMS_INTERNAL_URL` says where it is (default `http://forms:3110` in
  production, `http://127.0.0.1:3110` locally) and links point at `forms.<SUITE_DOMAIN>`.
- **Reports.** **New report** lays out the records of a table or saved query for reading and
  printing, as Access reports do. Design view picks the fields, their labels and formats
  (currency, whole number, two decimals, percent, date), up to four **group levels** (by each
  value, or dates by year, quarter or month, or text by first letter), the sort within groups,
  and **totals** (Sum, Average, Count, Min, Max) under each group and for the whole report, with a
  live preview. A table's lookups show the related record's name, not its ID. **Totals only**
  leaves the records out. **Print or save as PDF** opens the report on a page of its own; the
  browser's print dialog prints it or saves it as a PDF, portrait or landscape as designed.
  Reports read up to 20,000 records; filter larger sources with a query.
- **Access import.** **Import an Access database** on the start page makes a new database from an
  .accdb or .mdb file (Access 97 to 365; it asks for the password of a protected one); **Import Access** in a
  database adds the file's tables to it. Each table comes over with its records and the nearest
  data types. AutoNumber values are kept as the record IDs, so relationships from a number field
  to an AutoNumber become Lookup fields with the same delete rule (refuse, cascade, or blank).
  What can't come over is listed when the import finishes: OLE objects and attachments,
  relationships on other keys (their values stay), and saved queries, forms and reports, which
  aren't read yet (make them again with **New query**, **New form** and **New report**). Files are read with [mdb-reader](https://github.com/andipaetzold/mdb-reader)
  (MIT), up to 100 MB and 200,000 records a table; if anything fails, nothing is left behind.
- **CSV import.** **Import CSV** makes a new table from a file. The first row names the fields and
  each column's type is worked out from its values (numbers, currency, dates, yes/no, email, links;
  codes with leading zeros such as ZIP codes stay text). Up to 50 MB and 200,000 records.
- **Lists views.** Besides Datasheet and Design, a table opens as a **Gallery** (a card per
  record, with search), a **Board** (a column per choice of a Choice field plus "(Blank)";
  dragging a card to another column changes the record) and a **Calendar** (records on a month
  grid by a Date or Date/Time field; double-click a day to add a record on it). Clicking a card
  opens the record in a form, with its related records. **Customize** picks each view's title,
  fields, board column field and calendar date field, saved per table; until then the first text,
  choice and date fields are used.
- **Sharing.** **Share** next to the database name lists who can open it and, for owners, adds
  people by email as owners, editors (data and design) or viewers (read only), changes their role
  or removes them. Anyone can leave a database; it always keeps at least one owner. Roles are
  enforced by the API.
- **Comments.** A record opened in a form, or from a gallery, board or calendar card, shows its
  comments under it. Editors and owners add them; people delete their own and owners anyone's.
  Deleting a record deletes its comments.
- **Link to Sheets.** **Link to Sheets** on a table or saved query makes a data link: a private
  address that reads it as CSV without signing in, for Sheets' **Data > Get data… > From web**
  (Refresh brings in later changes). Anyone with the address can read the data, so only editors
  make links, a link reads as the person who made it and stops when they lose access, and
  **Turn off link** ends it at once. The gateway lets `base.<domain>/api/feed/*` through without
  sign-in. Sheets refuses private addresses, so on a server without a public address add the
  Base host to Office's `IMPORT_ALLOW_HOSTS`.

Names people type are stored in the catalog (`base_databases`, `base_tables`, `base_fields`,
`base_queries`, `base_forms`, `base_reports`, `base_list_views`, `base_comments`, `base_links`); SQL identifiers are always generated, and every value goes to Postgres as a
parameter.

### How queries stay safe

Each table also has a **readable view** in its database's schema, named as the table and its
fields are (`db_<id>."Customers"` with columns `"ID"`, `"Name"` ...). Queries are written against
those views, so SQL reads the way the database looks, and SQL clients see the same names. Design
changes drop a table's view and make it again in the same transaction.

A query is parsed ([pgsql-ast-parser](https://github.com/oguimbal/pgsql-ast-parser), MIT) and only
runs if it is one SELECT (WITH, UNION and VALUES included), every table it reads is one of its own
database's views, CTEs or saved queries, and every function it calls is on a list of ordinary ones
(aggregates, text, maths, dates, window functions). What runs is SQL regenerated from that parse,
in a READ ONLY transaction with a 15-second limit and the database's schema as the only search
path. Results stop at 1,000 rows on screen and 200,000 in an export.

## Run it locally

You need Node 22 and a Postgres database.

```
npm install && npm run build:packages            # from the repository root
cd apps/base
export DATABASE_URL=postgres://postgres:dev@127.0.0.1:5432/base
export DEV_USER_EMAIL=you@example.com
npm run dev                                      # http://localhost:3680
```

The catalog tables are created on first use. `npm run typecheck` typechecks the app.

## Tests

`npm test` runs the field, filter, CSV, SQL-checking, query designer, form layout, report layout, Lists view and multi-value lookup rules. With `TEST_DATABASE_URL` set to a scratch
Postgres database it also runs the database, relationship, multi-value lookup, query, form, report, Lists, sharing, comment, data link and Access import tests (with the small Access
files in `tests/fixtures`, and a stand-in for Synergy Forms' API), which make and drop their own schemas.

## Coming next

The planned milestones are done. Not covered yet: Attachment fields (files on a record).
