# Design notes

**English** · [简体中文](./DESIGN.zh-CN.md)

What this fork adds on top of [upstream](https://github.com/RUIIIOVO/paseo-usage-sidebar), and why
it works the way it does. The [README](../README.md) covers installing and using the plugin; this
covers the account owner, per-account deduplication, pace, and the meter's folds.

## Whose plan it is

Each provider in the panel is headed by whose plan it is and which plan it is:
`Claude (you@example.com)` on the left and `Max 20x` on the right.

The account is the one part of the row Paseo does not report: its payload carries the plan but not
whose plan it is, so the address is read from the provider CLI's own login file — `~/.claude.json`
for Claude, the `id_token` in `~/.codex/auth.json` for Codex. Read-only, and only the address; the
tokens beside it are never touched. A provider that keeps its account somewhere else simply shows no
address.

`server/usage/account.ts` stitches the address on server-side, because it comes off the filesystem,
which only that half of the plugin can reach. The login files it reads are cached for ten minutes:
`~/.claude.json` also holds your per-project history and grows into the megabytes, and the address
inside changes about as often as you log in.

### One block per account

Knowing the account also collapses duplicates: a subscription reports the same numbers wherever it is
signed in, so two providers resolving to one account render as one block instead of the same reading
twice. Rows whose account cannot be read are never folded together — unknown is not one account.

That holds across machines too. Paseo's client can hold several daemons at once, and each runs its own
copy of this plugin, so a subscription signed in here and on a second PC used to paint itself twice in
one sidebar. The copies cannot see each other through the daemon — nothing in `provider.usage.list`
has a host dimension — but their client bundles all run in the same renderer, so they claim accounts
through it (`client/usage/claims.ts`): the first copy to poll paints the shared subscription and the
others paint nothing for it.

The claim is a lease. Only a poll that came back with numbers renews it, and teardown releases it
outright; a copy repaints between polls, because the countdowns tick against the clock, but repainting
only asks whether it still holds the account. So a machine whose daemon goes unreachable goes quiet
after one lease and the other takes over, rather than holding a frozen block forever by failing at it.
A host still on an older build does not take part, and keeps painting its duplicate until you update
it.

## The sidebar meter's headings

Rows are grouped under the provider and the account they count against — `Claude · you@example.com`.
The address is last because it is the first thing the ellipsis eats: at this width the provider name
is what makes the rows beneath it legible, and the address is what tells two plans apart once you
already know the name.

Each heading is also a fold. Click it — or press Enter or Space with it focused — to hide that
account's rows; the caret on the trailing edge tracks the state. The fold lives in the renderer
only: it survives the 60-second repaint and a sidebar remount, not a reload.

The meter node is otherwise `pointer-events:none`, so it never steals a click meant for the sidebar.
The account headings opt back in so they can be folded, and so do rows carrying a reset tooltip.

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
- **No credentials** are read, stored, or transmitted. Two login files are opened read-only for the
  account address alone — `oauthAccount.emailAddress` in `~/.claude.json`, and the `email` claim of
  the `id_token` in `~/.codex/auth.json`. No access or refresh token is read, and the macOS Keychain
  is never queried. The address is rendered in the panel and goes nowhere else.
- **No outbound network access.** Nothing leaves the machine; the plugin opens no sockets at all.
- **One write, and it is yours** — the pin set and pace toggle. It holds provider and window ids and
  that one boolean: no tokens, no usage numbers, nothing account-identifying.
- **Client code** renders the response and persists nothing. Its one piece of shared state is the
  account claim: an in-memory map on the renderer's `globalThis`, holding the same addresses already
  shown on screen. It never leaves the renderer and never reaches disk.

## Files this fork adds

```
client/usage/claims.ts          # One block per account across hosts, claimed in the renderer
client/usage/claims.check.ts    # Its self-check — handover, renewal, expiry
server/usage/account.ts         # Plan owner from the CLI login files, and per-account dedupe
server/usage/account.check.ts   # Its self-check — login-file parsing and the dedupe rule
shared/usage/pace.ts            # Spend against the clock: elapsed share, delta, thresholds
shared/usage/pace.check.ts      # Its self-check — the one module here with arithmetic in it
```

The self-checks are plain asserts and predate upstream's `npm test`. Run the one beside whatever you
touched, alongside `npm run typecheck` and `npm test`:

```bash
npx tsx shared/usage/pace.check.ts      # the pace arithmetic
npx tsx server/usage/account.check.ts   # login-file parsing, per-account dedupe
npx tsx client/usage/claims.check.ts    # which copy paints a shared subscription
```
