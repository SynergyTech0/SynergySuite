// Browser check for the month view and repeating events: a weekly series shows on the right
// days at the same local time across the November daylight saving change; one occurrence is
// changed on its own, then this and following; a new repeating event is made in the editor and
// one occurrence deleted; Today, the arrows, the mini month, day view and agenda all move.
//
// Needs the calendar running in development mode with an empty database, e.g.
//   DATABASE_URL=postgres://... DEV_USER_EMAIL=alice@example.com PORT=3130 npm start
// then: BASE_URL=http://127.0.0.1:3130 npm run test:e2e -w apps/calendar
// Uses playwright-core (installed with the office workspace) and its Chromium
// (PLAYWRIGHT_BROWSERS_PATH, or CHROMIUM_PATH for a specific executable).
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3130';
const step = msg => console.log(`- ${msg}`);

async function api(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

const series = await api('POST', '/api/events', {
  title: 'Team sync', startAt: '2026-10-19T14:00:00Z', endAt: '2026-10-19T14:30:00Z', tzid: 'America/New_York',
  rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=6',
});
await api('POST', '/api/events', { title: 'Offsite', allDay: true, startAt: '2026-11-12T00:00:00Z', endAt: '2026-11-14T00:00:00Z' });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const context = await browser.newContext({ timezoneId: 'America/New_York', locale: 'en-US', viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.on('pageerror', e => { throw e; });
const cell = day => page.locator(`[data-day="${day}"]`);
const chips = day => cell(day).locator('.month-chip');
const chipTexts = async day => (await chips(day).allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());

try {
  step('a search link opens the occurrence; month view shows the series at 10:00 AM on both sides of the change');
  await page.goto(`${BASE}/?event=${series.id}&at=2026-11-02T15:00:00.000Z`);
  await page.getByRole('dialog').getByText('Edit event').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Month' }).click();
  await page.locator('.range-title', { hasText: 'November 2026' }).waitFor();
  for (const d of ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']) {
    assert.deepEqual(await chipTexts(d), ['10:00 AM Team sync ↻'], d);
  }
  assert.equal(await chips('2026-11-30').count(), 0, 'COUNT=6 ends the series');
  assert.match((await chipTexts('2026-11-12'))[0], /Offsite/);
  assert.match((await chipTexts('2026-11-13'))[0], /Offsite/);
  assert.equal(await chips('2026-11-14').count(), 0, 'all-day end is exclusive');
  await page.screenshot({ path: process.env.SCREENSHOT || '/dev/null' }).catch(() => {});

  step('this event: one occurrence renamed, the others unchanged');
  await chips('2026-11-09').first().click();
  await page.getByLabel('Title').fill('Team sync (1:1s)');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('dialog', { name: 'Edit repeating event' }).getByLabel('This event').check();
  await page.getByRole('button', { name: 'OK' }).click();
  await page.getByText('Team sync (1:1s)').waitFor();
  assert.deepEqual(await chipTexts('2026-11-02'), ['10:00 AM Team sync ↻']);
  assert.deepEqual(await chipTexts('2026-11-16'), ['10:00 AM Team sync ↻']);

  step('this and following: from the 16th on it is the Retro at 11');
  await chips('2026-11-16').first().click();
  await page.getByLabel('Title').fill('Retro');
  await page.getByLabel('Start').fill('2026-11-16T11:00');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByLabel('This and following events').check();
  await page.getByRole('button', { name: 'OK' }).click();
  await page.waitForFunction(() => document.querySelector('[data-day="2026-11-23"]')?.innerText.includes('Retro'));
  assert.deepEqual(await chipTexts('2026-11-16'), ['11:00 AM Retro ↻']);
  assert.deepEqual(await chipTexts('2026-11-23'), ['11:00 AM Retro ↻']);
  assert.deepEqual(await chipTexts('2026-11-02'), ['10:00 AM Team sync ↻']);
  assert.deepEqual(await chipTexts('2026-11-09'), ['10:00 AM Team sync (1:1s) ↻']);

  step('a new event repeating Wednesdays and Fridays, four times');
  await cell('2026-11-18').click({ position: { x: 60, y: 70 } });
  await page.getByLabel('Title').fill('Gym');
  await page.getByLabel('Repeat', { exact: true }).selectOption('WEEKLY');
  await page.getByRole('group', { name: 'On these days' }).getByRole('button').nth(5).click(); // Friday
  await page.getByLabel('Ends').selectOption('count');
  await page.getByLabel('Occurrences').fill('4');
  assert.match(await page.locator('.repeat-box .hint').innerText(), /Weekly on Wed, Fri, 4 times/);
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForFunction(() => document.querySelector('[data-day="2026-11-27"]')?.innerText.includes('Gym'));
  for (const d of ['2026-11-18', '2026-11-20', '2026-11-25', '2026-11-27']) assert.ok((await chipTexts(d)).some(t => t.includes('9:00 AM Gym')), d);
  assert.equal((await chipTexts('2026-12-02')).length, 0);

  step('delete one occurrence');
  await chips('2026-11-25').filter({ hasText: 'Gym' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog', { name: 'Delete repeating event' }).getByLabel('This event').check();
  await page.getByRole('dialog', { name: 'Delete repeating event' }).getByRole('button', { name: 'Delete' }).click();
  await page.waitForFunction(() => !document.querySelector('[data-day="2026-11-25"]')?.innerText.includes('Gym'));
  assert.ok((await chipTexts('2026-11-27')).some(t => t.includes('Gym')));

  step('Today, arrows and the mini month');
  await page.getByRole('button', { name: 'Today' }).click();
  const thisMonth = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'America/New_York' });
  await page.locator('.range-title', { hasText: thisMonth }).waitFor();
  await page.getByRole('button', { name: 'Next month' }).first().click(); // the toolbar arrow
  await page.locator('.range-title', { hasText: 'November 2026' }).waitFor();
  await page.locator('.mini').getByRole('button', { name: 'Next month' }).click();
  await page.locator('.mini').getByRole('button', { name: 'December 9, 2026' }).click();
  await page.locator('.range-title', { hasText: 'December 2026' }).waitFor();
  await page.getByRole('button', { name: 'Previous month' }).first().click();
  await page.locator('.range-title', { hasText: 'November 2026' }).waitFor();

  step('day view and agenda');
  await cell('2026-11-02').getByRole('button', { name: /November 2, 2026/ }).click();
  await page.locator('.range-title', { hasText: 'Monday, November 2, 2026' }).waitFor();
  assert.match(await page.locator('.event').first().innerText(), /Team sync/);
  await page.getByRole('tab', { name: 'Agenda' }).click();
  const agenda = await page.locator('.agenda').innerText();
  assert.match(agenda, /Monday, November 2\n10:00 AM – 10:30 AM\nTeam sync/);
  assert.match(agenda, /Thursday, November 12\nAll day\nOffsite/);
  step('ok');
} finally {
  await browser.close();
}
