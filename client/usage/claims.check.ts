import assert from "node:assert/strict";
import { claimAccounts, heldAccounts, releaseAccounts } from "./claims";
import type { ProviderUsage, UsageSnapshot } from "../../shared/usage/contract";

/**
 * Self-check for the cross-instance claim: who paints a subscription when two
 * hosts report it, and what happens when the one who was painting it goes away.
 *
 * `npx tsx client/usage/claims.check.ts` — the holder is a parameter precisely
 * so two copies can be simulated in one process; in the renderer it defaults to
 * the bundle's own module-scoped identity.
 */

const LOCAL = {};
const SECOND_PC = {};
const NOW = Date.UTC(2026, 2, 15, 12);
const LEASE_MS = 150_000;

function snapshot(...accounts: Array<string | null>): UsageSnapshot {
  return {
    fetchedAt: null,
    source: "sdk",
    providers: accounts.map((accountLabel, index): ProviderUsage => ({
      providerId: `p${index}`,
      displayName: `p${index}`,
      status: "available",
      planLabel: null,
      accountLabel,
      windows: [],
      balances: [],
      details: [],
    })),
  };
}

const shown = (result: UsageSnapshot) => result.providers.map((provider) => provider.accountLabel);

// The first copy to poll paints the shared subscription; the second paints nothing.
assert.deepEqual(shown(claimAccounts(snapshot("you@x"), LOCAL, NOW)), ["you@x"]);
assert.deepEqual(shown(claimAccounts(snapshot("you@x"), SECOND_PC, NOW)), [], "a held account is not painted twice");

// And it stays with the holder across its own polls, rather than alternating.
assert.deepEqual(shown(claimAccounts(snapshot("you@x"), LOCAL, NOW + 60_000)), ["you@x"], "the holder keeps it");
assert.deepEqual(shown(claimAccounts(snapshot("you@x"), SECOND_PC, NOW + 60_000)), [], "the renewed lease still holds");

// An account only the second host has is its own to paint.
assert.deepEqual(
  shown(claimAccounts(snapshot("you@x", "work@x"), SECOND_PC, NOW + 60_000)),
  ["work@x"],
  "a subscription the holder does not report belongs to whoever does",
);

// Unknown owners are never folded together — same rule as the server half.
assert.deepEqual(shown(claimAccounts(snapshot(null), LOCAL, NOW)), [null]);
assert.deepEqual(shown(claimAccounts(snapshot(null), SECOND_PC, NOW)), [null], "null is not an account");

// A copy that stops renewing — its daemon unreachable, the bundle still alive —
// loses the account rather than hiding the surviving host's block forever.
assert.deepEqual(
  shown(claimAccounts(snapshot("you@x"), SECOND_PC, NOW + 60_000 + LEASE_MS + 1)),
  ["you@x"],
  "an expired lease is taken over",
);
assert.deepEqual(
  shown(claimAccounts(snapshot("you@x"), LOCAL, NOW + 60_000 + LEASE_MS + 2)),
  [],
  "and the previous holder is now the one that waits",
);

// Teardown hands over at once instead of after the lease.
releaseAccounts(SECOND_PC);
assert.deepEqual(shown(claimAccounts(snapshot("you@x"), LOCAL, NOW + 60_000 + LEASE_MS + 3)), ["you@x"]);
releaseAccounts(LOCAL);
assert.deepEqual(shown(claimAccounts(snapshot("you@x"), SECOND_PC, NOW)), ["you@x"], "a released account is free");

// Painting asks, it never renews: a copy that cannot reach its daemon stops
// painting rather than holding the account by failing at it.
releaseAccounts(LOCAL);
releaseAccounts(SECOND_PC);
assert.deepEqual(shown(claimAccounts(snapshot("you@x"), LOCAL, NOW)), ["you@x"], "a poll that returned claims");
assert.deepEqual(shown(heldAccounts(snapshot("you@x"), LOCAL, NOW + LEASE_MS)), ["you@x"], "and paints until the lease is out");
assert.deepEqual(
  shown(heldAccounts(snapshot("you@x"), LOCAL, NOW + LEASE_MS + 1)),
  [],
  "a copy that has not polled for a lease goes quiet",
);
assert.deepEqual(
  shown(heldAccounts(snapshot("you@x"), LOCAL, NOW + 10 * LEASE_MS)),
  [],
  "and repainting does not renew it back into existence",
);
assert.deepEqual(
  shown(claimAccounts(snapshot("you@x"), SECOND_PC, NOW + LEASE_MS + 2)),
  ["you@x"],
  "so the other machine can take it",
);
assert.deepEqual(shown(heldAccounts(snapshot("you@x"), LOCAL, NOW + LEASE_MS + 3)), [], "and the first stays quiet");
assert.deepEqual(shown(heldAccounts(snapshot(null), LOCAL, NOW)), [null], "an unknown account is nobody's to lose");

console.log("claim checks passed");
