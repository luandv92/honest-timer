# honest-timer

A scarcity countdown widget that doesn't lie.

Most "X% off — offer ends in 09:58" countdown timers on the web are decoration.
Reload the page and the clock jumps right back to 10:00. Nothing actually
happens when it hits zero — the price is exactly the same tomorrow. It's a
well-known dark pattern, and most people who shop online have learned to
distrust every countdown they see.

`honest-timer` is the opposite of that, on purpose:

- **The deadline is real.** It's computed once (`now + N minutes`) and saved
  to `localStorage`. Reloading the page does not reset it — the countdown
  keeps counting down from wherever it actually is.
- **Expiry is real.** When the clock hits zero, the widget can swap an
  element's price/text automatically (`data-honest-timer-raise-to`) and/or
  call your own code (`onExpire`) so you can wire it to whatever your real
  price change is — a Stripe price ID, a discount code, a plan tier.
- **It never re-arms itself.** Once a deadline has passed, it stays passed.
  Nothing about hitting zero silently resets the countdown into a new
  window on your next visit. If you want a fresh sale, you say so explicitly
  (`resetHonestTimer`) — it is never an accidental side effect of a reload.
- **Zero dependencies, no build step.** It's one file. Drop it in a
  `<script type="module">` tag or pull it straight from the repo. There's
  nothing to bundle to make it work.

## Why this is auditable

The entire "is this timer honest?" question comes down to one function,
`getOrCreateDeadline`, in [`src/honest-timer.js`](./src/honest-timer.js):

```js
export function getOrCreateDeadline(key, minutes, storage) {
  const raw = storage.getItem(key);
  const existing = raw ? parseInt(raw, 10) : 0;
  if (existing) return existing;
  const deadline = Date.now() + minutes * 60000;
  storage.setItem(key, String(deadline));
  return deadline;
}
```

Five lines. If a deadline is already stored for this key, it's returned
as-is — expired or not, we never overwrite it automatically. If there isn't
one yet, we compute it once and persist it. That's the whole trick. Everything
else in the file is rendering (`formatDuration`), wiring
(`createHonestTimer`, `autoInit`), and the declarative `data-*` attribute
contract described below.

You don't have to take a README's word for any of this — go read the
function yourself. That's the point of shipping something this small.

## Install

Not published to npm. It's one file with zero dependencies and no build step,
so the simplest install is to copy it:

```bash
curl -O https://raw.githubusercontent.com/luandv92/honest-timer/master/src/honest-timer.js
```

```html
<script type="module" src="./honest-timer.js"></script>
```

Or pull it straight from the repo if you'd rather have it in `package.json`:

```bash
npm install github:luandv92/honest-timer
```

```js
import { createHonestTimer } from 'honest-timer';
```

(`type="module"` is all modern browsers require; you don't need a bundler
or transpiler to ship an ES module as a static file.)

## Quick start (declarative, zero JS)

```html
<script type="module" src="./honest-timer.js"></script>

<!-- the countdown display -->
<span data-honest-timer
      data-honest-timer-key="launch-week"
      data-honest-timer-minutes="2880"></span>

<!-- shown while the timer runs, hidden on expiry -->
<span data-honest-timer-before="launch-week">$47</span>

<!-- hidden while the timer runs, shown on expiry -->
<span data-honest-timer-after="launch-week" style="display:none">$67</span>

<!-- OR: a single element whose text is swapped automatically on expiry -->
<span data-honest-timer-key="launch-week"
      data-honest-timer-raise-to="$67">$47</span>
```

That's the entire integration. Loading the script scans the page for
`[data-honest-timer]` elements and wires each one up automatically — see
[`demo.html`](./demo.html) for a full working page you can open directly in
a browser.

### Declarative attributes

| Attribute                          | Where                    | Meaning |
|-------------------------------------|---------------------------|---------|
| `data-honest-timer`                 | countdown display element | marks this element as a live countdown |
| `data-honest-timer-key="KEY"`       | any related element       | namespaces the timer; ties before/after/raise-to elements to a specific countdown |
| `data-honest-timer-minutes="N"`     | countdown display element | length of the countdown **the first time this key is ever seen** — ignored on subsequent loads, since the stored deadline wins |
| `data-honest-timer-before="KEY"`    | any element                | visible while running, hidden on expiry |
| `data-honest-timer-after="KEY"`     | any element                | hidden while running, visible on expiry |
| `data-honest-timer-raise-to="TEXT"` | element with `data-honest-timer-key` | on expiry, this element's text is replaced with `TEXT` — the actual price bump |

## Quick start (JS API)

For anything more custom — wiring the expiry to a Stripe Price ID, an
analytics event, a copy change on ten elements at once — use the
programmatic API directly:

```js
import { createHonestTimer } from 'honest-timer';

const timer = createHonestTimer({
  key: 'launch-week',       // required — localStorage namespace
  minutes: 2880,            // used only the first time this key is seen
  el: '#countdown',         // element or selector to render into
  onTick(msRemaining) {
    // called every second
  },
  onExpire({ key, deadline }) {
    // called exactly once. Wire your REAL price change here:
    document.querySelector('#price').textContent = '$67';
    // e.g. also flip which Stripe Price ID / checkout link is active,
    // fire an analytics event, disable the old coupon code, etc.
  },
});

timer.getDeadline();      // epoch ms
timer.getMsRemaining();   // ms left (can be negative)
timer.isExpired();        // boolean
timer.destroy();          // stop the interval (e.g. on component unmount)
```

## Starting a new countdown window on purpose

Because the deadline never resets itself, rolling out a genuinely new sale
window is one explicit call:

```js
import { resetHonestTimer } from 'honest-timer';

resetHonestTimer('launch-week');
// next createHonestTimer({ key: 'launch-week', minutes: ... }) call
// will compute and persist a brand new deadline.
```

## API reference

- `createHonestTimer(options)` — starts a countdown, returns a controller.
- `autoInit(root?)` — scans `root` (default `document`) for
  `[data-honest-timer]` elements and wires them up. Runs automatically on
  page load; call it again yourself if you inject new timer markup later
  (e.g. after a client-side route change).
- `getOrCreateDeadline(key, minutes, storage)` — the core persistence
  primitive described above.
- `resetHonestTimer(key, storage?)` — clears a stored deadline.
- `formatDuration(ms)` — formats milliseconds as `H:MM:SS` (or `MM:SS` under
  an hour). Clamps negative values to zero.
- `safeStorage()` — returns `window.localStorage`, or an in-memory fallback
  if localStorage throws (private-browsing quota, non-browser environment).

All storage-touching functions accept an optional `storage` argument (any
object with `getItem`/`setItem`/`removeItem`) — this is what makes the
persistence logic testable without a real browser; see `tests/test.js`.

## Testing

No test framework — plain Node `assert`, because a widget this size doesn't
need one.

```bash
npm test
# or
node tests/test.js
```

## What this generalizes from

This package generalizes the core persisted-deadline mechanic from a
production landing-page countdown snippet: read a deadline from
`localStorage`, and only compute a fresh one if none exists yet, so a page
reload never resets a running countdown. That part is copied faithfully.

One thing was changed deliberately, not carried over: the original snippet
also recomputed a brand-new deadline whenever the *stored* one was found to
be in the past — which meant an expired countdown would quietly restart on
the next visit. This package's `getOrCreateDeadline` never does that; an
expired deadline is returned as-is, forever, until you explicitly call
`resetHonestTimer`. An "honest" timer that quietly loops after expiry isn't
actually honest, so that behavior didn't make the cut here.

## License

MIT — see [LICENSE](./LICENSE).
