const test = require('node:test');
const assert = require('node:assert/strict');
const { Availability, HOUR, MIN_HOURS } = require('../../../src/main/availability');

const T0 = Date.UTC(2026, 9, 1);

test('the live rate is the share of hours seen with a stream live, once there are enough of them', () => {
  const a = new Availability();
  for (let h = 0; h < MIN_HOURS - 1; h++) a.note(7, T0 + h * HOUR, h === 0);
  assert.equal(a.rate(7, T0 + MIN_HOURS * HOUR), null, 'too few hours to say');
  a.note(7, T0 + (MIN_HOURS - 1) * HOUR, false);
  assert.equal(a.rate(7, T0 + MIN_HOURS * HOUR), 1 / MIN_HOURS);
  assert.equal(a.rate(99), null, 'never seen');
});

test('one live look makes the whole hour live, however many quiet looks it has', () => {
  const a = new Availability();
  for (let h = 0; h < MIN_HOURS; h++) {
    a.note(7, T0 + h * HOUR, false);
    a.note(7, T0 + h * HOUR + 20 * 60_000, h % 2 === 0);
    a.note(7, T0 + h * HOUR + 40 * 60_000, false);
  }
  assert.equal(a.rate(7, T0 + MIN_HOURS * HOUR), 0.5);
});

test('only the last week counts, and it survives being saved and loaded', () => {
  const a = new Availability();
  for (let h = 0; h < 10; h++) a.note(7, T0 + h * HOUR, true);
  const later = T0 + 8 * 24 * HOUR;
  for (let h = 0; h < MIN_HOURS; h++) a.note(7, later + h * HOUR, false);
  assert.equal(a.rate(7, later + MIN_HOURS * HOUR), 0, 'the live hours a week ago are gone');
  const b = new Availability(JSON.parse(JSON.stringify(a)));
  assert.equal(b.rate(7, later + MIN_HOURS * HOUR), 0);
  assert.equal(new Availability(null).rate(7), null, 'nothing saved yet');
});
