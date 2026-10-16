const test = require('node:test');
const assert = require('node:assert');
const { businessDays } = require('../server/days');

// 2026-10-12 is a Monday.
test('a single weekday is one day', () => {
  assert.strictEqual(businessDays('2026-10-14', '2026-10-14'), 1);
});

test('a Saturday-to-Sunday range is zero days', () => {
  assert.strictEqual(businessDays('2026-10-17', '2026-10-18'), 0);
});

test('a Friday-to-Monday range is two days', () => {
  assert.strictEqual(businessDays('2026-10-16', '2026-10-19'), 2);
});

test('a full Monday-to-Sunday week is five days', () => {
  assert.strictEqual(businessDays('2026-10-12', '2026-10-18'), 5);
});

test('a range spanning a month end counts both months', () => {
  // Thu 29 Oct to Tue 3 Nov 2026: Thu, Fri, Mon, Tue.
  assert.strictEqual(businessDays('2026-10-29', '2026-11-03'), 4);
});

test('an end before the start is zero days', () => {
  assert.strictEqual(businessDays('2026-10-16', '2026-10-12'), 0);
});
