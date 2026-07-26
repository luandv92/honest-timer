/*!
 * honest-timer — a scarcity countdown that doesn't lie.
 *
 * Two properties that most "urgency countdown" widgets on the web fake:
 *   1. The deadline survives a page reload (it's read from localStorage, not
 *      recomputed from "now" on every load).
 *   2. Once the deadline passes, it STAYS passed — it never silently re-arms
 *      itself into a fresh countdown on the next visit. If you want a new
 *      countdown, you decide that explicitly (see `resetHonestTimer`).
 *
 * The whole "is this timer honest?" question comes down to one function:
 * `getOrCreateDeadline`. Read it — it's five lines. Everything else in this
 * file is rendering and wiring around that one guarantee.
 *
 * MIT License. See LICENSE.
 */

const STORAGE_PREFIX = 'honest_timer_';

/**
 * In-memory fallback storage, used only when `localStorage` is unavailable
 * (private-browsing quota errors, non-browser environments, etc). Falling
 * back silently means the widget still renders, but you lose reload
 * persistence — that trade-off is intentional (fail open, never throw).
 */
function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

let memoryFallback = null;

/** Returns a working Storage-like object, preferring the real localStorage. */
export function safeStorage() {
  try {
    const testKey = '__honest_timer_test__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return window.localStorage;
  } catch (_e) {
    if (!memoryFallback) memoryFallback = createMemoryStorage();
    return memoryFallback;
  }
}

/**
 * THE CORE LOOP. This is the entire "honesty" contract of the widget.
 *
 * - If no deadline is stored yet for `key`, compute one (`now + minutes`)
 *   and persist it.
 * - If a deadline IS already stored, return it as-is — whether it's still
 *   running or already in the past. We never recompute it automatically.
 *
 * That last point is the deliberate difference from a lot of production
 * "scarcity timer" snippets floating around (including an earlier internal
 * version this package generalizes from): those often re-arm the deadline
 * whenever the stored value is found to be in the past, which quietly turns
 * an expired one-time deadline into a repeating countdown on the next visit.
 * That is exactly the "resets/loops" behavior an honest timer must not do.
 * If you want a new sale window, call `resetHonestTimer(key)` yourself —
 * it's one explicit line, not an automatic side effect of page load.
 */
export function getOrCreateDeadline(key, minutes, storage) {
  const store = storage || safeStorage();
  const raw = store.getItem(key);
  const existing = raw ? parseInt(raw, 10) : 0;
  if (existing) return existing;
  const deadline = Date.now() + minutes * 60000;
  store.setItem(key, String(deadline));
  return deadline;
}

/** Clears a stored deadline so the next call to getOrCreateDeadline starts a fresh window. */
export function resetHonestTimer(key, storage) {
  const store = storage || safeStorage();
  store.removeItem(STORAGE_PREFIX + key);
}

/** Formats milliseconds as "H:MM:SS" (or "MM:SS" once under an hour). Clamps negatives to 0. */
export function formatDuration(ms) {
  const clamped = ms < 0 ? 0 : ms;
  const totalSeconds = Math.floor(clamped / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n) => (n < 10 ? '0' : '') + n;
  return (hours > 0 ? hours + ':' + pad(minutes) : pad(minutes)) + ':' + pad(seconds);
}

/**
 * Creates and starts a single countdown.
 *
 * options:
 *   key        (required) string — namespaces the localStorage entry and
 *              lets before/after/raise-to elements find this timer.
 *   minutes    (required on first run) number — countdown length used only
 *              the first time this key is ever seen.
 *   el         Element | selector string — rendered with the remaining time.
 *   onTick     (msRemaining) => void — called every second.
 *   onExpire   ({ key, deadline }) => void — called exactly once, the moment
 *              the countdown hits zero. Wire your real price change here.
 *   storage    Storage-like — injectable for tests / non-browser use.
 *
 * Returns a controller: { getDeadline, getMsRemaining, isExpired, destroy }.
 */
export function createHonestTimer(options) {
  const opts = options || {};
  if (!opts.key) throw new Error('honest-timer: "key" is required');

  const storage = opts.storage || safeStorage();
  const storageKey = STORAGE_PREFIX + opts.key;
  const minutes = opts.minutes != null ? opts.minutes : 120;
  const deadline = getOrCreateDeadline(storageKey, minutes, storage);

  const el = typeof opts.el === 'string'
    ? (typeof document !== 'undefined' ? document.querySelector(opts.el) : null)
    : (opts.el || null);

  let expired = false;
  let intervalId = null;

  function msRemaining() {
    return deadline - Date.now();
  }

  function tick() {
    const left = msRemaining();
    if (el) el.textContent = formatDuration(left);
    if (typeof opts.onTick === 'function') opts.onTick(Math.max(0, left));
    if (left <= 0 && !expired) {
      expired = true;
      if (intervalId != null) { clearInterval(intervalId); intervalId = null; }
      if (typeof opts.onExpire === 'function') opts.onExpire({ key: opts.key, deadline });
    }
  }

  tick();
  if (!expired) {
    intervalId = setInterval(tick, 1000);
  }

  return {
    getDeadline: () => deadline,
    getMsRemaining: msRemaining,
    isExpired: () => expired,
    destroy: () => { if (intervalId != null) { clearInterval(intervalId); intervalId = null; } },
  };
}

/** Escapes a value for safe use inside an attribute-selector string. */
function escapeAttrValue(value) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}

/**
 * Applies the declarative before/after/raise-to wiring for one timer key.
 *   [data-honest-timer-before="KEY"]                shown while running, hidden on expiry
 *   [data-honest-timer-after="KEY"]                  hidden while running, shown on expiry
 *   [data-honest-timer-key="KEY"][data-honest-timer-raise-to="NEW TEXT"]
 *                                                     textContent swapped to NEW TEXT on expiry
 */
function applyDeclarativeState(root, key, isExpired) {
  const esc = escapeAttrValue(key);

  root.querySelectorAll('[data-honest-timer-before="' + esc + '"]').forEach((elem) => {
    elem.style.display = isExpired ? 'none' : '';
  });

  root.querySelectorAll('[data-honest-timer-after="' + esc + '"]').forEach((elem) => {
    elem.style.display = isExpired ? '' : 'none';
  });

  if (isExpired) {
    root.querySelectorAll('[data-honest-timer-key="' + esc + '"][data-honest-timer-raise-to]').forEach((elem) => {
      const newText = elem.getAttribute('data-honest-timer-raise-to');
      if (newText != null) elem.textContent = newText;
    });
  }
}

/**
 * Scans `root` (default: document) for `[data-honest-timer]` elements and
 * wires each one up automatically. This is what runs the plain <script>
 * usage — no JS required from the integrator beyond the data attributes.
 *
 *   <span data-honest-timer
 *         data-honest-timer-key="launch-week"
 *         data-honest-timer-minutes="180"></span>
 */
export function autoInit(root) {
  const scope = root || (typeof document !== 'undefined' ? document : null);
  if (!scope) return [];

  const controllers = [];
  scope.querySelectorAll('[data-honest-timer]').forEach((elem) => {
    const key = elem.getAttribute('data-honest-timer-key');
    if (!key) {
      if (typeof console !== 'undefined') {
        console.warn('honest-timer: element is missing data-honest-timer-key, skipping', elem);
      }
      return;
    }
    const minutes = parseFloat(elem.getAttribute('data-honest-timer-minutes') || '120');

    const controller = createHonestTimer({
      key,
      minutes,
      el: elem,
      onExpire: () => applyDeclarativeState(scope, key, true),
    });

    // Reflect current state immediately (covers the case where the page is
    // loaded fresh after the deadline already passed on a previous visit).
    applyDeclarativeState(scope, key, controller.isExpired());
    controllers.push(controller);
  });

  return controllers;
}

const VERSION = '1.0.0';

// Auto-run when included as a plain <script type="module"> in a page — no
// build step, no explicit init() call required. Guarded so re-evaluating
// this module (e.g. accidentally included twice) doesn't double-wire.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (!window.__honestTimerBooted) {
    window.__honestTimerBooted = true;
    const boot = () => { try { autoInit(); } catch (_e) { /* never break the host page */ } };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }
}

export default {
  VERSION,
  safeStorage,
  getOrCreateDeadline,
  resetHonestTimer,
  formatDuration,
  createHonestTimer,
  autoInit,
};
