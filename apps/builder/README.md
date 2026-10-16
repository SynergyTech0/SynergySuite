# Synergy Builder (Power Apps equivalent)

Make apps for your team without code: screens of labels, buttons, inputs, galleries and forms,
wired together with formulas like a spreadsheet's, over your Synergy Base tables. It covers what
Power Apps canvas apps are used for, and grows in milestones (see "Coming next").

- **App:** Next.js 16 + React 19 (port 3745)
- **Data:** its own Postgres database (`builder`) for apps, sharing and versions, through
  `@synergy/db`. The records an app shows and changes live in Base.
- **Auth:** the suite gateway signs people in; `@synergy/identity` reads who they are.

## What works

- **Start from a Base table.** Pick a table and a phone or tablet layout, and Builder makes a
  three-screen app in one step, the way Power Apps does from data: a browse screen with a search
  box and a gallery of records, a detail screen, and an edit screen whose form saves back to Base.
  Or start from a blank app.
- **Studio.** A canvas you drag, resize and nudge with the arrow keys; a tree view of screens and
  controls; an Insert menu; a properties pane; and a formula bar for the selected property, which
  shows syntax errors as you type and runtime errors from the live canvas. Undo and redo, Delete,
  Ctrl+D to duplicate, F5 to preview. Renaming a control, screen or data source updates every
  formula that names it. The draft saves itself as you work.
- **Controls.** Text label, button, text input, drop down, check box, toggle, date picker, image,
  rectangle, gallery (vertical, with a template you design once and `ThisItem` in its formulas;
  long lists render only the rows in view) and form (edit or view, with a card per field, and
  `SubmitForm`, `ResetForm`, `NewForm`, `EditForm`, `ViewForm`, `OnSuccess`, `OnFailure`,
  `LastSubmit`, `Valid`, `Unsaved`).
- **Formulas.** A Power Fx interpreter written for Builder: numbers, text, booleans, dates,
  records and tables, `&`, `in`/`exactin`, `;` chaining, `Self`, `Parent`, `ThisItem`,
  `ThisRecord`, and 112 functions, including `If`, `Switch`, `With`, `Filter`, `Search`,
  `LookUp`, `Sort`, `SortByColumns`, `AddColumns`, `ForAll`, `CountRows`, `Sum`, `Text` with
  number and date formats, `DateAdd`, `DateDiff`, `IsMatch`, `Split`, `Concat`, `Coalesce`,
  `IfError` and the enums (`Color`, `ScreenTransition`, `DisplayMode`, `FormMode`, `SortOrder`,
  `TimeUnit` ...). Behavior formulas (`OnSelect`, `OnStart`, `OnVisible`, `OnChange` ...) add
  `Navigate` with transitions, `Back`, `Set`, `UpdateContext`, `Collect`, `ClearCollect`,
  `Clear`, `Patch`, `Remove`, `RemoveIf`, `Refresh`, `Reset`, `Notify`, `Launch` and `RunFlow`.
- **Data.** Add any Base table you can open as a data source; the app reads and writes it as the
  person using the app, so Base's own sharing decides what they can see and change. Like Power
  Apps, an app works with the first 2,000 records of a table, and says so when there are more.
  `Patch(Orders, Defaults(Orders), {...})` adds a record, `Patch(Orders, ThisItem, {...})` changes
  one, and lookups to other tables read and write the related record's ID.
- **Flows.** Buttons can run a Synergy Flow flow with `RunFlow("Flow name", {inputs})`, as the
  person using the app; the Data pane lists the flows that can be run this way.
- **Publishing and versions.** People run the published version while you keep changing the
  draft. Every publish is a version you can restore to the draft. Preview the draft in the studio
  or at `/play/<id>?draft=1`.
- **Sharing.** Owners share an app with people as co-owners, editors or users, or with everyone in
  the organization as users. Users see the app on Builder's start page once it's published.
- **Suite.** Apps show up in suite search, and the Admin center's eDiscovery finds the apps
  someone made, with their formulas. Deleting an app made by someone on legal hold hides it and
  keeps it.

## Coming next

- Describe an app in words and have your own AI model (`@synergy/ai`) lay it out.
- Lookup pickers in forms, more controls (charts, timers, pen input, rich text, HTML text,
  attachments), horizontal galleries and nested galleries.
- Components you make once and reuse across screens and apps, and themes.
- More data sources: Forms responses, Planner, CRM and Books, and offline use on phones.

## Running it

```bash
npm install                 # from the repository root
cd apps/builder
DEV_USER_EMAIL=you@example.com npm run dev
```

It needs Postgres (`DATABASE_URL`, default `postgres://postgres:postgres@127.0.0.1:5432/builder`)
and Base running on port 3680 (`BASE_INTERNAL_URL` to point elsewhere). `RunFlow` uses Synergy
Flow at `FLOW_INTERNAL_URL` when it's set, or the `flow` app in `packages/config/apps.json`.

```bash
npm test                    # formula and runtime tests
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/builder_test npm test   # and the database tests
```

## About

Builder is Synergy's own code (AGPL-3.0); it doesn't wrap another app builder. Its formula
language follows Microsoft's Power Fx, which Microsoft publishes as an open language
specification, so the formulas people already know from Power Apps read and behave the same way
here. Power Apps and Power Fx are Microsoft trademarks; Builder is not affiliated with Microsoft.
