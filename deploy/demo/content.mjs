/*
 * Sample content for demo mode: a small fictional company, Juniper Bay Studio, and what its
 * people have been working on. Every name here is made up. Dates are relative to the current
 * week so the calendar, planner and mail always look current after a reset.
 */

export const COMPANY = 'Juniper Bay Studio';

/** The shared demo login comes first; the rest are colleagues nobody signs in as. */
export function people(domain, demoEmail) {
  return [
    { key: 'demo', email: demoEmail, name: 'Sam Rivera', title: 'Operations Manager' },
    { key: 'priya', email: `priya.natarajan@${domain}`, name: 'Priya Natarajan', title: 'Founder and Creative Director' },
    { key: 'marcus', email: `marcus.bell@${domain}`, name: 'Marcus Bell', title: 'Design Lead' },
    { key: 'elena', email: `elena.kovacs@${domain}`, name: 'Elena Kovacs', title: 'Marketing Manager' },
    { key: 'jordan', email: `jordan.okafor@${domain}`, name: 'Jordan Okafor', title: 'Client Services' },
  ];
}

const DAY = 86_400_000;

/** Monday 00:00 UTC of the current week, and a helper for "day d of the week at hh:mm UTC". */
export function week(now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const monday = today - ((now.getUTCDay() + 6) % 7) * DAY;
  const at = (day, hour = 0, minute = 0) => new Date(monday + day * DAY + (hour * 60 + minute) * 60_000);
  return { monday, at };
}

/** Calendar events. Times are UTC, roughly a US-east morning and a European afternoon. */
export function calendarEvents(p, at) {
  const all = (...keys) => keys.map((k) => p[k].email);
  const ev = (owner, title, start, end, extra = {}) => ({
    owner: p[owner].email, calendar: 'personal', title, start, end,
    description: '', location: '', allDay: false, attendees: [], ...extra,
  });
  return [
    ev('priya', 'Weekly team sync', at(0, 14), at(0, 14, 45), {
      calendar: 'company', location: 'Studio meeting room',
      description: 'Status round, blockers, and what ships this week. Notes go in the Notes app under Meeting notes.',
    }),
    ev('priya', 'Weekly team sync', at(7, 14), at(7, 14, 45), { calendar: 'company', location: 'Studio meeting room' }),
    ev('marcus', 'Spring catalog design review', at(1, 15), at(1, 16), {
      attendees: all('demo', 'elena', 'priya'), location: 'Design corner',
      description: 'Walk through the cover options and the first 12 product spreads.',
    }),
    ev('demo', 'Print vendor call: paper stock and timeline', at(1, 18), at(1, 18, 30), {
      attendees: all('marcus'), description: 'Confirm the uncoated stock, quantities and the proof date.',
    }),
    ev('elena', 'Lunch and learn: writing better product copy', at(2, 16), at(2, 17), {
      calendar: 'company', location: 'Kitchen', description: 'Bring lunch. Elena shares the copy checklist from the Notes app.',
    }),
    ev('demo', '1:1 with Priya', at(3, 15), at(3, 15, 30), { attendees: all('priya') }),
    ev('jordan', 'Client check-in: Harborview Bakery rebrand', at(3, 17), at(3, 18), {
      attendees: all('demo', 'marcus'), location: 'Video call',
      description: 'Second round of logo feedback. Jordan to send the summary afterwards.',
    }),
    ev('priya', 'Friday demo and drinks', at(4, 20), at(4, 21), {
      calendar: 'company', location: 'Studio', description: 'Show something you made this week, however small.',
    }),
    ev('demo', 'Quarterly budget review', at(8, 15), at(8, 16, 30), {
      attendees: all('priya', 'jordan'), description: 'Draft numbers are in the planner card OPS-4.',
    }),
    ev('marcus', 'Spring catalog print deadline', at(10, 0), at(11, 0), {
      calendar: 'company', allDay: true, description: 'Final files to the printer by end of day.',
    }),
    ev('elena', 'Newsletter send', at(11, 14), at(11, 14, 30), { attendees: all('demo') }),
  ];
}

/** Notes pages (markdown-lite). Children reference their parent by title. */
export function notesPages(p, at) {
  const d = (day) => at(day).toISOString().slice(0, 10);
  return [
    {
      title: `Welcome to ${COMPANY}`, by: 'priya',
      body: [
        `# Welcome to ${COMPANY}`,
        '',
        'We are a small design studio. This wiki holds how we work, what we are building and our meeting notes.',
        '',
        ':::tip',
        'This is a demo instance. Edit anything you like: the whole workspace resets to this sample content every hour.',
        ':::',
        '',
        '## Start here',
        '- **Team handbook**: how we plan, review and ship work',
        '- **Spring catalog launch**: the big project this quarter',
        '- **Meeting notes**: one page per weekly sync',
      ].join('\n'),
    },
    {
      title: 'Team handbook', by: 'priya',
      body: [
        '# Team handbook',
        '',
        '## How we plan',
        'Work lives on the planner boards. Every card has one owner and a due date; if it has neither, it is not real yet.',
        '',
        '## Reviews',
        '- Design reviews happen on Tuesdays',
        '- Copy goes through Elena before anything is published',
        '- Client work gets a second pair of eyes before it is sent',
        '',
        '## Working hours',
        'Core hours are 10:00 to 15:00. Outside those, use chat and expect a slower answer.',
      ].join('\n'),
    },
    {
      title: 'Onboarding checklist', parent: 'Team handbook', by: 'demo',
      body: [
        '# Onboarding checklist',
        '',
        '- [x] Laptop and accounts set up',
        '- [x] Read the team handbook',
        '- [ ] Shadow a client call with Jordan',
        '- [ ] Pair with Marcus on a design review',
        '- [ ] Ship one small thing in the first week',
      ].join('\n'),
    },
    {
      title: 'Expense policy', parent: 'Team handbook', by: 'jordan',
      body: [
        '# Expense policy',
        '',
        '| Item | Limit | Approval |',
        '|---|---|---|',
        '| Books and courses | 400 per year | None |',
        '| Client travel | Actual cost | Priya |',
        '| Equipment | 1,500 | Sam |',
        '',
        'Submit receipts by the 5th of the following month.',
      ].join('\n'),
    },
    {
      title: 'Spring catalog launch', by: 'elena',
      body: [
        '# Spring catalog launch',
        '',
        '**Goal:** a 48-page printed catalog and a matching web lookbook, live before the end of next week.',
        '',
        '## Milestones',
        `- ${d(1)}: design review of cover and spreads`,
        `- ${d(10)}: final files to the printer`,
        `- ${d(11)}: newsletter announcement`,
        '',
        ':::warning',
        'The paper stock is still not confirmed. Sam is following up with the print vendor.',
        ':::',
        '',
        '## Owners',
        '- Design: Marcus',
        '- Copy and launch: Elena',
        '- Print and budget: Sam',
      ].join('\n'),
    },
    {
      title: 'Meeting notes', by: 'demo',
      body: '# Meeting notes\n\nOne page per weekly sync, newest first.',
    },
    {
      title: `Weekly sync ${d(0)}`, parent: 'Meeting notes', by: 'demo',
      body: [
        `# Weekly sync ${d(0)}`,
        '',
        '**Present:** Priya, Marcus, Elena, Jordan, Sam',
        '',
        '## Updates',
        '- Catalog spreads are 80% done; cover still has two options',
        '- Harborview Bakery liked the second logo round',
        '- Budget draft is ready for review next week',
        '',
        '## Actions',
        '- [ ] Sam: confirm paper stock with the printer',
        '- [ ] Marcus: pick a cover by Wednesday',
        '- [ ] Elena: draft the newsletter',
      ].join('\n'),
    },
  ];
}

/** Chat channels and messages. `ago` is minutes before the reset. */
export function chat() {
  return {
    channels: [
      { name: 'general', topic: 'Company-wide announcements and chatter', members: 'all' },
      { name: 'spring-catalog', topic: 'Everything about the spring catalog launch', members: ['demo', 'priya', 'marcus', 'elena'] },
      { name: 'random', topic: 'Lunch plans, links and pets', members: 'all' },
    ],
    messages: [
      { channel: 'general', from: 'priya', ago: 1500, body: 'Morning all! Reminder that the weekly sync moved to the meeting room this week.' },
      { channel: 'general', from: 'jordan', ago: 1490, body: 'Thanks Priya. I will bring the Harborview feedback.' },
      { channel: 'general', from: 'priya', ago: 300, body: 'Friday demo and drinks is on. Show us anything you made this week, however small.' },
      { channel: 'general', from: 'elena', ago: 290, body: 'I will show the new newsletter template.' },
      { channel: 'spring-catalog', from: 'marcus', ago: 240, body: 'Uploaded both cover options. I am leaning towards the one with the coastline photo.' },
      { channel: 'spring-catalog', from: 'elena', ago: 230, body: 'Same here, the headline reads better on it too.' },
      { channel: 'spring-catalog', from: 'priya', ago: 220, body: 'Agreed. Sam, any news from the printer on the paper stock?' },
      { channel: 'spring-catalog', from: 'demo', ago: 200, body: 'Call is on Tuesday. They quoted two weeks, so we are fine for the deadline if we confirm by Wednesday.' },
      { channel: 'spring-catalog', from: 'marcus', ago: 45, body: 'Spreads 1 to 12 are ready for review in tomorrow\'s design review.' },
      { channel: 'random', from: 'jordan', ago: 600, body: 'Anyone up for the new noodle place at lunch?' },
      { channel: 'random', from: 'marcus', ago: 590, body: 'Yes please.' },
      { channel: 'random', from: 'elena', ago: 120, body: 'Office plant update: the fern has survived another week.' },
      { dm: 'priya', from: 'priya', ago: 180, body: 'Hi Sam, could you put the quarterly budget draft on the planner before our 1:1?' },
      { dm: 'priya', from: 'demo', ago: 170, body: 'Sure, it is on the Operations board as OPS-4.' },
      { dm: 'jordan', from: 'jordan', ago: 60, body: 'Do you have five minutes after lunch to look at the Harborview invoice?' },
    ],
  };
}

/** Planner boards with lists and cards. `due` is a day offset from Monday of this week. */
export function plannerBoards() {
  const lists = [
    ['To do', 'todo'], ['In progress', 'in_progress'], ['Review', 'in_progress'], ['Done', 'done'],
  ];
  return [
    {
      title: 'Spring catalog', key: 'CAT', background: '#0e7490', owner: 'elena',
      members: ['demo', 'priya', 'marcus', 'elena'], lists,
      labels: [['Design', '#7c3aed'], ['Copy', '#0284c7'], ['Print', '#d97706'], ['Blocked', '#dc2626']],
      cards: [
        { list: 'To do', title: 'Write the newsletter announcement', assignee: 'elena', due: 9, labels: ['Copy'], type: 'task' },
        { list: 'To do', title: 'Book the photographer for the web lookbook', assignee: 'elena', due: 6, priority: 'low' },
        { list: 'In progress', title: 'Confirm paper stock and quantities with the printer', assignee: 'demo', due: 2, labels: ['Print', 'Blocked'], priority: 'high',
          description: 'Two quotes so far. Waiting for samples of the uncoated stock.',
          checklist: ['Request samples', 'Compare quotes', 'Confirm quantities', 'Sign off the order'], checked: 2,
          comment: { from: 'marcus', body: 'The uncoated stock looked great on the test print.' } },
        { list: 'In progress', title: 'Design product spreads 13 to 24', assignee: 'marcus', due: 4, labels: ['Design'], points: 5 },
        { list: 'Review', title: 'Cover: choose between the two options', assignee: 'marcus', due: 2, labels: ['Design'], priority: 'high',
          comment: { from: 'priya', body: 'Coastline photo, please. Let us lock it in at the design review.' } },
        { list: 'Review', title: 'Product descriptions for spreads 1 to 12', assignee: 'elena', due: 1, labels: ['Copy'] },
        { list: 'Done', title: 'Pick the product line-up', assignee: 'priya', due: -3, done: true },
        { list: 'Done', title: 'Photograph the spring collection', assignee: 'marcus', due: -2, done: true, labels: ['Design'] },
      ],
    },
    {
      title: 'Operations', key: 'OPS', background: '#4d7c0f', owner: 'demo',
      members: ['demo', 'priya', 'jordan'], lists,
      labels: [['Finance', '#059669'], ['Office', '#9333ea'], ['Hiring', '#db2777']],
      cards: [
        { list: 'To do', title: 'Renew the studio insurance', assignee: 'demo', due: 12, labels: ['Office'] },
        { list: 'To do', title: 'Post the junior designer job ad', assignee: 'priya', due: 8, labels: ['Hiring'] },
        { list: 'In progress', title: 'Send the Harborview Bakery invoice', assignee: 'jordan', due: 3, labels: ['Finance'], priority: 'high' },
        { list: 'Review', title: 'Quarterly budget draft', assignee: 'demo', due: 8, labels: ['Finance'], points: 3,
          description: 'Draft numbers for review at the quarterly budget meeting.',
          comment: { from: 'priya', body: 'Thanks Sam, I will read it before our 1:1.' } },
        { list: 'Done', title: 'Move the shared drive to the new folder structure', assignee: 'demo', due: -4, done: true },
      ],
    },
  ];
}

/** Mail in the demo mailbox. `ago` is hours before the reset. */
export function mailMessages() {
  return [
    {
      from: 'priya', to: ['demo'], ago: 26, seen: true,
      subject: 'Welcome aboard the spring catalog',
      body: 'Hi Sam,\n\nThanks for taking on print and budget for the spring catalog. Elena has the overall plan in the Notes app, and the cards are on the Spring catalog board.\n\nShout if anything is unclear.\n\nPriya',
    },
    {
      from: 'jordan', to: ['demo'], cc: ['marcus'], ago: 20,
      subject: 'Harborview Bakery: feedback on logo round two',
      body: 'Hi Sam, hi Marcus,\n\nThe client liked option B best, with two small changes:\n\n- a slightly warmer brown\n- the tagline in sentence case\n\nCould we have a revised version by Thursday\'s check-in?\n\nThanks,\nJordan',
    },
    {
      from: 'elena', to: ['demo'], ago: 5,
      subject: 'Newsletter draft for the catalog launch',
      body: 'Hi Sam,\n\nFirst draft of the launch newsletter is below. Can you check the dates against the print schedule?\n\n"Our spring catalog is here: 48 pages of new pieces, photographed on the coast where we work."\n\nElena',
    },
    {
      from: 'marcus', to: ['demo'], ago: 2,
      subject: 'Paper samples arrived',
      body: 'Sam,\n\nThe printer\'s samples are on your desk. The uncoated one feels great; the coated one shows fingerprints. My vote is uncoated.\n\nMarcus',
    },
    {
      from: 'demo', to: ['priya'], ago: 23, folder: 'sent', seen: true,
      subject: 'Re: Welcome aboard the spring catalog',
      body: 'Thanks Priya, glad to help. I have a call with the printer on Tuesday and will put the budget draft on the Operations board.\n\nSam',
    },
  ];
}
