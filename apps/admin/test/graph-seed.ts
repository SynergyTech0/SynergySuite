import type { Tenant } from "./fake-graph";

/** A small Microsoft 365 tenant for the migration tests: three people, their mail, files, calendar, contacts and To Do, and a site. */
const mime = (id: string, subject: string, extra = "") =>
  Buffer.from([`From: Someone <someone@contoso.test>`, `To: alice@contoso.test`, `Subject: ${subject}`, `Message-ID: <${id}@contoso.test>`,
    "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "", `Body of ${subject}${extra}`, ""].join("\r\n"));

export function msg(t: Tenant, user: string, folder: string, id: string, subject: string, o: { read?: boolean; flagged?: boolean; at?: string; big?: boolean } = {}) {
  t.raw.set(id, o.big ? mime(id, subject, "x".repeat(1_200_000)) : mime(id, subject));
  t.put(`mail/${user}/${folder}`, {
    id, subject, isRead: o.read ?? false, flag: { flagStatus: o.flagged ? "flagged" : "notFlagged" }, receivedDateTime: o.at ?? "2024-02-03T04:05:06Z",
  });
}

export function seed(t: Tenant) {
  t.users = [
    { id: "u-alice", displayName: "Alice Adams", userPrincipalName: "alice@contoso.test", mail: "alice@contoso.test", accountEnabled: true, userType: "Member" },
    { id: "u-bob", displayName: "Bob Brown", userPrincipalName: "bob@contoso.test", mail: "bob@contoso.test", accountEnabled: true, userType: "Member" },
    { id: "u-dave", displayName: "Dave Doe", userPrincipalName: "dave@contoso.test", mail: "dave@contoso.test", accountEnabled: true, userType: "Member" },
    { id: "u-guest", displayName: "Guest", userPrincipalName: "g_outside.test#EXT#@contoso.test", accountEnabled: true, userType: "Guest" },
  ];
  t.reportCsv = '﻿Report Refresh Date,User Principal Name,Display Name,Item Count,Storage Used (Byte)\r\n2026-10-15,alice@contoso.test,"Adams, Alice",9,123456\r\n2026-10-15,bob@contoso.test,Bob Brown,1,2048\r\n';

  // Alice's mailbox: Inbox > Projects > 2024, Sent Items, Archive, a folder of her own, Conversation History (skipped).
  t.folders.set("u-alice", [
    { id: "f-inbox", displayName: "Inbox", childFolderCount: 1, totalItemCount: 4 },
    { id: "f-sent", displayName: "Sent Items", childFolderCount: 0, totalItemCount: 1 },
    { id: "f-archive", displayName: "Archive", childFolderCount: 0, totalItemCount: 0 },
    { id: "f-receipts", displayName: "Receipts", childFolderCount: 0, totalItemCount: 1 },
    { id: "f-conv", displayName: "Conversation History", childFolderCount: 0, totalItemCount: 3 },
  ]);
  t.folders.set("u-alice/f-inbox", [{ id: "f-projects", displayName: "Projects", childFolderCount: 1, totalItemCount: 1 }]);
  t.folders.set("u-alice/f-projects", [{ id: "f-2024", displayName: "2024", childFolderCount: 0, totalItemCount: 1 }]);
  for (const [wk, id] of [["inbox", "f-inbox"], ["sentitems", "f-sent"], ["archive", "f-archive"]]) t.wellKnown.set(`u-alice/${wk}`, id);
  msg(t, "u-alice", "f-inbox", "m1", "Welcome", { read: true, at: "2023-01-02T03:04:05Z" });
  msg(t, "u-alice", "f-inbox", "m2", "Flagged one", { flagged: true });
  msg(t, "u-alice", "f-inbox", "m3", "Unread");
  msg(t, "u-alice", "f-inbox", "m-big", "Huge attachment", { big: true });
  msg(t, "u-alice", "f-projects", "m4", "Project kickoff", { read: true });
  msg(t, "u-alice", "f-2024", "m5", "Budget 2024", { read: true });
  msg(t, "u-alice", "f-sent", "m6", "Re: Welcome", { read: true });
  msg(t, "u-alice", "f-receipts", "m7", "Receipt", { read: true });
  msg(t, "u-alice", "f-conv", "m-conv", "Teams chat log");

  // Alice's OneDrive: a child listed before its folder, a OneNote notebook.
  t.drives.set("u-alice", "d-alice");
  const file = (id: string, name: string, parent: string, body: string, ctag = "c1") => {
    t.content.set(id, Buffer.from(body));
    return t.put("drive/d-alice", { id, name, size: body.length, file: { mimeType: "text/plain" }, parentReference: { id: parent }, cTag: ctag, lastModifiedDateTime: "2022-06-07T08:09:10Z" });
  };
  t.put("drive/d-alice", { id: "root-a", name: "root", root: {}, folder: { childCount: 2 } });
  file("i-c", "c.txt", "i-sub", "deep file");
  t.put("drive/d-alice", { id: "i-docs", name: "Docs", folder: { childCount: 2 }, parentReference: { id: "root-a" } });
  t.put("drive/d-alice", { id: "i-sub", name: "Sub", folder: { childCount: 1 }, parentReference: { id: "i-docs" } });
  file("i-a", "a.txt", "root-a", "alpha");
  file("i-b", "b.txt", "i-docs", "bravo");
  t.put("drive/d-alice", { id: "i-note", name: "Notebook", package: { type: "oneNote" }, parentReference: { id: "root-a" } });

  // Alice's calendar: a meeting, two occurrences of a weekly series, a cancelled one, one Bob organizes.
  const ev = (id: string, subject: string, start: string, end: string, more: Record<string, unknown> = {}) =>
    t.put("cal/u-alice", { id, subject, start: { dateTime: start, timeZone: "UTC" }, end: { dateTime: end, timeZone: "UTC" }, isAllDay: false, isOrganizer: true,
      body: { contentType: "html", content: `<p>About <b>${subject}</b></p>` }, location: { displayName: "Room 1" }, changeKey: "k1",
      attendees: [{ emailAddress: { address: "bob@contoso.test" } }, { emailAddress: { address: "partner@outside.test" } }], organizer: { emailAddress: { address: "alice@contoso.test" } }, ...more });
  ev("e1", "Planning", "2026-11-02T09:00:00.0000000", "2026-11-02T10:00:00.0000000");
  ev("e2", "Standup", "2026-11-03T09:00:00.0000000", "2026-11-03T09:15:00.0000000", { seriesMasterId: "s1", type: "occurrence" });
  ev("e3", "Standup", "2026-11-10T09:00:00.0000000", "2026-11-10T09:15:00.0000000", { seriesMasterId: "s1", type: "occurrence" });
  ev("e4", "Called off", "2026-11-04T09:00:00.0000000", "2026-11-04T10:00:00.0000000", { isCancelled: true });
  ev("e5", "Bob's review", "2026-11-05T09:00:00.0000000", "2026-11-05T10:00:00.0000000", { isOrganizer: false, organizer: { emailAddress: { address: "bob@contoso.test", name: "Bob" } } });
  t.events.set("s1", { id: "s1", subject: "Standup", recurrence: { pattern: { type: "weekly", interval: 1, daysOfWeek: ["tuesday"] }, range: { type: "noEnd", startDate: "2026-11-03" } } });

  // Contacts: two in the default folder, one in "Suppliers".
  t.put("contacts/u-alice/default", { id: "c1", givenName: "Carol", surname: "Chen", companyName: "Fabrikam", emailAddresses: [{ address: "carol@fabrikam.test" }], mobilePhone: "+1 555 0100", businessAddress: { city: "Seattle" }, birthday: "1990-04-05T00:00:00Z", changeKey: "1" });
  t.put("contacts/u-alice/default", { id: "c2", displayName: "Front desk", businessPhones: ["+1 555 0199"], changeKey: "1" });
  t.contactFolders.set("u-alice", [{ id: "cf-sup", displayName: "Suppliers" }]);
  t.put("contacts/u-alice/cf-sup", { id: "c3", givenName: "Sam", surname: "Supply", emailAddresses: [{ address: "sam@supply.test" }], changeKey: "1" });

  // To Do: the default list and one of her own.
  t.todoLists.set("u-alice", [{ id: "l-def", displayName: "Tasks", wellknownListName: "defaultList" }, { id: "l-gro", displayName: "Groceries", wellknownListName: "none" }]);
  t.put("todo/u-alice/l-def", { id: "t1", title: "File taxes", importance: "high", status: "notStarted", dueDateTime: { dateTime: "2027-04-15T00:00:00.0000000", timeZone: "UTC" }, body: { content: "Use the new form", contentType: "text" }, lastModifiedDateTime: "2026-01-01T00:00:00Z", recurrence: { pattern: { type: "weekly", interval: 1, daysOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"] } } });
  t.checklist.set("t1", [{ id: "ck1", displayName: "Find receipts", isChecked: true }, { id: "ck2", displayName: "Sign", isChecked: false }]);
  t.put("todo/u-alice/l-gro", { id: "t2", title: "Milk", status: "completed", importance: "normal", lastModifiedDateTime: "2026-01-01T00:00:00Z" });
  t.put("todo/u-alice/l-gro", { id: "t3", title: "Bread", status: "notStarted", importance: "normal", lastModifiedDateTime: "2026-01-01T00:00:00Z" });

  // Bob: one message, no OneDrive, nothing else.
  t.folders.set("u-bob", [{ id: "fb-inbox", displayName: "Inbox", childFolderCount: 0, totalItemCount: 1 }]);
  t.wellKnown.set("u-bob/inbox", "fb-inbox");
  msg(t, "u-bob", "fb-inbox", "mb1", "Hi Bob");

  // Dave: twelve messages, for the crash test.
  t.folders.set("u-dave", [{ id: "fd-inbox", displayName: "Inbox", childFolderCount: 0, totalItemCount: 12 }]);
  t.wellKnown.set("u-dave/inbox", "fd-inbox");
  for (let i = 1; i <= 12; i++) msg(t, "u-dave", "fd-inbox", `md${i}`, `Dave ${i}`);

  // A SharePoint site of a Microsoft 365 group, and a personal site that must not be listed.
  t.sites = [
    { id: "site-mkt", displayName: "Marketing", webUrl: "https://contoso.sharepoint.test/sites/marketing" },
    { id: "site-personal", displayName: "Alice", webUrl: "https://contoso-my.sharepoint.test/personal/alice" },
  ];
  t.siteDrives.set("site-mkt", [{ id: "d-mkt", name: "Documents", driveType: "documentLibrary", quota: { used: 4 } }]);
  t.groups = [{ id: "g-mkt", siteId: "site-mkt", owners: ["alice@contoso.test"], members: ["alice@contoso.test", "bob@contoso.test", "nobody@contoso.test"] }];
  t.put("drive/d-mkt", { id: "root-m", name: "root", root: {}, folder: {} });
  t.content.set("i-plan", Buffer.from("plan"));
  t.put("drive/d-mkt", { id: "i-plan", name: "Plan.docx", size: 4, file: {}, parentReference: { id: "root-m" }, cTag: "p1", lastModifiedDateTime: "2021-01-01T00:00:00Z" });
}

