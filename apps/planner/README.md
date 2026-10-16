# SynergyBoards

**An AI-native Trello alternative on the Synergy stack** — the team's dev cockpit *and* a product in the suite. Built (not forked) so we own the model, integrate deeply, and let the mind help run the board.

## Why own it (vs forking Planka)
Same effort to stand it up on *our* stack, and ownership pays back forever: deep wiring into the mind, SynergyAuth, SynergyDrive, and SynergyDB; no upstream tech debt; a real SKU we control. Planka would've been a shortcut to a shallow integration — wrong trade for a tool we'll build Synergy *inside* for years.

## Stack (matches SynergyRoutes)
- **Next.js 16 / React 19** (app router), TypeScript
- **Drizzle ORM + Postgres** (`db/schema.ts` is the keystone — Trello parity + AI-native columns)
- **Auth.js (next-auth v5)** → **SynergyAuth** OIDC (users provisioned from the OIDC `sub`)
- **WebSocket** realtime (live board collaboration — everyone sees moves instantly)
- **dnd-kit** for drag-and-drop lists/cards
- Attachments link to **SynergyDrive** by `driveFileId`; login shared with the portal via SynergyAuth

## The AI-native wedge (what no incumbent has)
- Cards & comments carry `origin` (human | mind) + `mindRef` → the mind's **proposals, goals, and code-review findings become first-class cards** it can file, move, comment on, and complete — all under the existing governance (money/PHI/irreversible stay human, staged).
- `automations` = Butler-style rules the **mind proposes and (governed) executes**.
- The exec-portal board we already shipped is the v0 of this — SynergyBoards is the full product it grows into.

## Data model (`db/schema.ts`)
`users` (mind is a first-class member) · `workspaces` + members · `boards` + members · `lists` · `cards`
(fractional `position` for O(1) reorder, `origin`/`mindRef` for AI cards) · `labels` + `card_labels` ·
`card_members` · `checklists` + `checklist_items` · `comments` (mind-authored) · `attachments`
(→ SynergyDrive) · `activities` (feed) · `automations` (Butler + mind).

## Build phases
1. **MVP** — boards / lists / cards, drag-and-drop, persistence, auth. *(days)*
2. **Collaboration** — WebSocket realtime, comments, members, labels, due dates, checklists, activity feed. *(≈2 wk)*
3. **AI-native layer** — mind files/moves/comments cards from `ready_queue` + goals + code-review; automations. *(the wedge)*
4. **Polish / product** — mobile, notifications, board templates, SynergyDrive attach, SSO hardening. *(product-ready)*

## Getting started
```bash
npm install
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/synergyboards
npm run db:push      # create tables from schema
npm run dev          # http://localhost:3600
```
Runs on port **3600** (SynergyAuth 3500, SynergyRoutes 3100, portal exec — no collision).
