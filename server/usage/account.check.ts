import assert from "node:assert/strict";
import type { ProviderUsage } from "../../shared/usage/contract";
import { claudeOwner, codexOwner, dedupeByAccount } from "./account";

/**
 * Self-check for the account half: two login files parsed defensively, and the
 * rule that decides whether a row is a second account or a second copy of one.
 *
 * `npx tsx server/usage/account.check.ts` — see shared/usage/pace.check.ts for
 * why the repo's checks are plain asserts.
 */

// Claude keeps the address in plain JSON beside the tokens.
assert.equal(claudeOwner({ oauthAccount: { emailAddress: "you@example.com" } }), "you@example.com");
assert.equal(claudeOwner({ oauthAccount: {} }), null, "a login file with no address yields none");
assert.equal(claudeOwner({ oauthAccount: { emailAddress: "" } }), null, "an empty address is not an address");
assert.equal(claudeOwner({ oauthAccount: { emailAddress: 42 } }), null, "a non-string address is ignored");
assert.equal(claudeOwner(null), null, "a missing file yields no owner");
assert.equal(claudeOwner("not an object"), null, "a file that is not the expected shape yields no owner");

// Codex keeps it inside the id_token, so the claims have to be decoded first.
const claims = Buffer.from(JSON.stringify({ email: "you@example.com" })).toString("base64url");
assert.equal(codexOwner({ tokens: { id_token: `header.${claims}.signature` } }), "you@example.com");
assert.equal(codexOwner({ tokens: { id_token: "not-a-jwt" } }), null, "a token with no payload segment yields none");
assert.equal(codexOwner({ tokens: { id_token: "header.!!!.signature" } }), null, "undecodable claims yield none");
assert.equal(
  codexOwner({ tokens: { id_token: `header.${Buffer.from("{}").toString("base64url")}.sig` } }),
  null,
  "claims without an email yield none",
);
assert.equal(codexOwner({}), null, "a logged-out auth file yields no owner");

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

console.log("account checks passed");
