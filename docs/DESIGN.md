# Design notes

**English** · [简体中文](./DESIGN.zh-CN.md)

What this fork adds on top of [upstream](https://github.com/RUIIIOVO/paseo-usage-sidebar), and why
it works the way it does. The [README](../README.md) covers installing and using the plugin; this
covers the account owner, per-account deduplication, the fleet meter, pace, and the meter's folds.

## Whose plan it is

Each provider in the panel is headed by whose plan it is and which plan it is:
`Claude (you@example.com)` on the left and `Max 20x` on the right.

Paseo 0.11 and later name an account-scoped row `Source (account)`, so the address comes off the row
name itself (`shared/usage/account.ts`). No file is read for it. A provider whose row carries no
account shows no address.

### One block per account

Knowing the account also collapses duplicates: a subscription reports the same numbers wherever it is
signed in, so two providers resolving to one account render as one block instead of the same reading
twice. Rows whose account cannot be read are never folded together — unknown is not one account.

### The sidebar shows the fleet

Paseo's client can hold several hosts at once, and each runs its own copy of this plugin. Paseo merges
the copies' sidebar items into one row and mounts only one host's copy: the host in the current route,
else the one last picked in the panel's host menu, else the first. Left alone, the meter would show
that one host and nothing else.

So the meter reads every online host itself, straight from each daemon
(`getPaseoClient(id).providers.listUsage()`), and merges the readings one block per account
(`shared/usage/fleet.ts`). The host Paseo mounted is asked first; for each account the first working
reading wins, so a host that is rate-limited or erroring hands its accounts to one that is not. A host
that cannot be read is skipped. Each app sees only the hosts it is connected to: a laptop connected to
a VM shows the VM's accounts too, and the VM's own app shows only itself.

The panel stays per host: its host menu picks whose readings it shows.

### One set of pins per app

A pin names a provider id and a window (`claude:weekly`), not an account, so on the fleet meter it
shows that window for every account that reports it. Pins belong to the app, not to a host: every
host's copy reads and edits one store on the renderer's `globalThis`, saved to localStorage
(`client/selection/store.ts`). Each edit is also written to the panel's host's state file, and the
first host found with pins seeds the app when it has none of its own: a fresh install, or a phone,
which has no localStorage.

## The sidebar meter's headings

Rows are grouped under the provider and the account they count against — `Claude · you@example.com`.
The address is last because it is the first thing the ellipsis eats: at this width the provider name
is what makes the rows beneath it legible, and the address is what tells two plans apart once you
already know the name.

Each heading is also a fold. Click it — or press Enter or Space with it focused — to hide that
account's rows; the caret on the trailing edge tracks the state. The fold lives in the renderer
only: it survives the 60-second repaint and a sidebar remount, not a reload.

The meter is drawn by the plugin's own sidebar item, under its row, so it moves and hides with that
item in Settings > Sidebar. A heading only folds; the rows beneath it open the usage panel.

## Pace

A percentage says how much is gone. It cannot say whether that is a lot — and that depends entirely
on where the window is in its own life. `▲12%` beside the number means twelve points ahead of the
clock: 57% spent of a window only 45% elapsed. A tick on the bar marks where the fill would sit if
you were tracking the clock exactly, so the gap between the tick and the fill edge is the arrow's
number, drawn to scale.

| Reading | Means |
| --- | --- |
| **▼ green** | Behind the clock. At this rate the window resets with headroom to spare. |
| **▲ orange** | 1–5 points ahead. Worth knowing; not worth changing plans over. |
| **▲ red** | More than 5 points ahead. The window runs out early unless the rate drops. |

Nothing shows within a point of pace. The elapsed share advances every second while the used share
only moves when you spend, so without a dead band every bar would flicker an arrow at a fraction of
a point off and the signal would stop meaning anything.

The elapsed share is reconstructed backwards from the reset instant, because the daemon reports when
a window resets but never when it began or how long it runs: `five_hour` is five hours, `weekly` and
`weekly_<model>` seven days, `daily` a day, and `monthly` a real calendar month — 28 days back from a
1 March reset, not a flat 30. A window whose id does not state its period (`coding_limit_*`,
`interval_*`, anything provider-specific) shows no arrow and no tick, rather than one derived from a
guess.

**Pace** in the panel header turns the whole reading off on both surfaces. The choice is stored
beside the pin set in `$XDG_STATE_HOME/paseo-usage-sidebar/selection.json`, and defaults on. The two
are written independently and merged server-side, so flipping the pace arrow never freezes the
default pin set into an explicit one, and a reorder never carries a stale toggle back over a newer
value.

### Why the arrow may be green

The bars deliberately use no green. It reads as "good", which spends the eye's only strong signal on
the state that needs no attention; blue is the neutral "nothing to do here", so warm hues mean
exactly one thing.

The one green in the plugin is the pace arrow's "behind the clock". Pace is a two-directional
reading, and a one-directional ramp has no colour for its good end — but a green arrow beside a blue
bar cannot be read as part of the ramp the way a green fill would be. Ahead-of-pace reuses the ramp's
own orange and red, so an arrow and the bar beneath it escalate on the same two colours.

## Privacy

Paseo plugins are unsandboxed by design, so this is worth reading before you trust one. The fork
changes what upstream reads from disk; everything else is as upstream.

- **Server code** runs in a daemon subprocess and calls exactly one SDK method,
  `paseo.providers.listUsage()`. No other daemon operation, no sockets of its own.
- **No credentials** are read, stored, or transmitted. The account address comes off the row name
  Paseo already reports; no login file is opened.
- **No new network access.** The meter asks the other hosts for usage through the connections Paseo
  already holds to them; the plugin opens no sockets of its own.
- **Two writes, both yours** — the pin set and display choices, in each host's state file and in the
  app's localStorage. They hold provider and window ids and two display settings: no tokens, no usage
  numbers, nothing account-identifying.

## Files this fork adds

```
client/selection/store.ts       # One pin set per app, shared by every host's copy
shared/usage/account.ts         # Plan owner from Paseo's row name, and per-account dedupe
shared/usage/account.check.ts   # Its self-check — the account key and the dedupe rule
shared/usage/fleet.ts           # Every host's reading merged, one block per account
shared/usage/pace.ts            # Spend against the clock: elapsed share, delta, thresholds
shared/usage/pace.check.ts      # Its self-check — the one module here with arithmetic in it
```

The self-checks are plain asserts and predate upstream's `npm test`. Run the one beside whatever you
touched, alongside `npm run typecheck` and `npm test`:

```bash
npx tsx shared/usage/pace.check.ts      # the pace arithmetic
npx tsx shared/usage/account.check.ts   # the account key, per-account dedupe
```
