# Synergy Contracts

Contract lifecycle management, the suite's answer to Dynamics 365 and SharePoint Syntex contract management. Grown from SynergyCLM (a contract register with renewals and alerts) into a full CLM on the suite's shared packages.

- **Library.** Templates written with `{{Field name}}` placeholders and `{{clause: Title}}` to pull in approved wording. Clauses carry the legal team's position (guidance), fallback wording, and whether every contract must cover them.
- **Drafting.** A contract starts blank or from a template. Its text is plain text with light Markdown; every save while it is a draft is kept as a version, and any version can be compared with the latest as a redline.
- **Approvals.** The owner sends a draft to approvers, who decide one after another. A rejection needs a reason and sends the contract back to draft; the text is locked until then.
- **Signatures.** An approved contract goes out for signature. With a signing service set (`CONTRACTS_SIGN_URL` + `CONTRACTS_SIGN_TOKEN`) Contracts sends it by API and follows Sign's `contract.event` messages at `POST /api/svc/sign-events` (dealRef `contract:<id>`). Without one, people print it to PDF, send it from Sign, and upload the signed copy, which marks it signed.
- **In force.** Renewal terms and notice periods. Contracts past their end date renew by themselves when they auto-renew and expire otherwise. The overview lists notice deadlines within two weeks and obligations due within 30 days.
- **AI review** on the suite's own model (`@synergy/ai`; `CONTRACTS_AI_*` to give Contracts its own): summary, key terms, risks against the clause guidance, missing required clauses, and obligations found. It is a first pass for a person and changes nothing.
- **Access.** A contract is visible to its owner, the people it is shared with (view or edit), its approvers, and the legal team (`CONTRACTS_ADMIN_EMAILS`, default `ADMIN_EMAILS`), who see everything and keep the library. With no legal team set, everyone can keep the library.
- **Suite search** (`POST /api/search`, per person) and **eDiscovery** (`/api/compliance/search|export`) for contracts, obligations, files and approvals. Deletes under a legal hold are kept, hidden.

Port 3830, database `contracts`. Tests run against Postgres when `TEST_DATABASE_URL` is set: `npm test --workspace apps/contracts`.
