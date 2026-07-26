// Plain Node test runner for the deadline-persistence logic — no framework.
// Run with: node tests/test.js
import assert from 'node:assert/strict';
import {
  getOrCreateDeadline,
  resetHonestTimer,
  formatDuration,
} from '../src/honest-timer.js';

// A tiny in-memory Storage stand-in, so tests don't touch real localStorage
// and each test starts from a clean slate.
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('first call creates a deadline roughly minutes*60000ms in the future', () => {
  const storage = fakeStorage();
  const before = Date.now();
  const deadline = getOrCreateDeadline('sale', 120, storage);
  const after = Date.now();
  assert.ok(deadline >= before + 120 * 60000, 'deadline should be at least 120 minutes out');
  assert.ok(deadline <= after + 120 * 60000, 'deadline should not be further than 120 minutes out');
  assert.equal(storage.getItem('sale'), String(deadline), 'deadline must be persisted to storage');
});

test('reload does NOT reset the countdown: same key returns the same deadline', () => {
  const storage = fakeStorage();
  const first = getOrCreateDeadline('sale', 120, storage);
  // Simulate a page reload some time later by just calling again.
  const second = getOrCreateDeadline('sale', 120, storage);
  assert.equal(second, first, 'second call must return the identical deadline, not a recomputed one');
});

test('reload does NOT reset the countdown even with a different requested duration', () => {
  // Once a deadline exists, the stored value wins — the `minutes` argument
  // is only used the very first time a key is seen.
  const storage = fakeStorage();
  const first = getOrCreateDeadline('sale', 120, storage);
  const second = getOrCreateDeadline('sale', 5, storage);
  assert.equal(second, first, 'an existing deadline must not be overwritten by a new minutes value');
});

test('an EXPIRED deadline is never silently re-armed (no loop, no reset)', () => {
  const storage = fakeStorage();
  // Manually seed a deadline that is already 10 minutes in the past.
  const pastDeadline = Date.now() - 10 * 60000;
  storage.setItem('sale', String(pastDeadline));

  const result = getOrCreateDeadline('sale', 120, storage);

  assert.equal(result, pastDeadline, 'an expired deadline must be returned as-is, not recomputed into a fresh one');
  assert.ok(result < Date.now(), 'the returned deadline must still be in the past');
});

test('different keys are independent (no cross-talk between timers)', () => {
  const storage = fakeStorage();
  const a = getOrCreateDeadline('sale-a', 30, storage);
  const b = getOrCreateDeadline('sale-b', 200, storage);
  assert.notEqual(a, b, 'two different keys with different durations must not collide');
  assert.equal(getOrCreateDeadline('sale-a', 30, storage), a);
  assert.equal(getOrCreateDeadline('sale-b', 200, storage), b);
});

test('resetHonestTimer clears the stored deadline so the next call starts fresh', () => {
  const storage = fakeStorage();
  const first = getOrCreateDeadline('honest_timer_sale', 120, storage);
  resetHonestTimer('sale', storage);
  const after = getOrCreateDeadline('honest_timer_sale', 5, storage);
  assert.notEqual(after, first, 'after an explicit reset, a new deadline must be computed');
});

test('formatDuration: clamps negative remaining time to 00:00, never goes negative', () => {
  assert.equal(formatDuration(-5000), '00:00');
});

test('formatDuration: renders MM:SS under an hour', () => {
  assert.equal(formatDuration(65 * 1000), '01:05');
});

test('formatDuration: renders H:MM:SS once an hour or more remains', () => {
  assert.equal(formatDuration((2 * 3600 + 3 * 60 + 4) * 1000), '2:03:04');
});

let passed = 0;
let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log('  ok  -', name);
    passed++;
  } catch (err) {
    console.error('  FAIL -', name);
    console.error('       ', err.message);
    failed++;
  }
}

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
