import assert from "node:assert/strict";
import type { ProviderUsage } from "../../shared/usage/contract";
import { accountOf, dedupeByAccount } from "./account";

/**
 * Self-check for the account half: the key read off Paseo's row name, and the
 * rule that decides whether a row is a second account or a second copy of one.
 *
 * `npx tsx server/usage/account.check.ts` — see shared/usage/pace.check.ts for
 * why the repo's checks are plain asserts.
 */

function provider(providerId: string, accountLabel: string | null): ProviderUsage {
  return {
    providerId,
    displayName: providerId,
    status: "available",
    planLabel: null,
    accountLabel,
    windows: [],
    balances: [],
    details: [],
  };
}

const ids = (providers: ProviderUsage[]) => providers.map((entry) => entry.providerId);

// One block per account, first occurrence wins.
assert.deepEqual(
  ids(dedupeByAccount([provider("claude", "a@x"), provider("pi", "a@x"), provider("codex", "b@x")])),
  ["claude", "codex"],
  "a second row for the same account is dropped, a different account is kept",
);
// Unknown owners are distinct from each other, not one anonymous account.
assert.deepEqual(
  ids(dedupeByAccount([provider("claude", null), provider("codex", null)])),
  ["claude", "codex"],
  "rows with no readable owner are never folded together",
);
assert.deepEqual(ids(dedupeByAccount([])), [], "an empty snapshot stays empty");

// Paseo 0.11 folds the account into the display name.
assert.equal(accountOf("Claude (you@example.com)"), "you@example.com");
assert.equal(accountOf("Claude"), null, "a bare name has no account");

console.log("account checks passed");
