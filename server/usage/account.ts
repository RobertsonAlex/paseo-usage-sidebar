import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderUsage, UsageSnapshot } from "../../shared/usage/contract";

/**
 * Whose subscription a row is reporting.
 *
 * The daemon's `provider.usage.list` payload carries the plan ("Max 20x") but not
 * the account it belongs to, and there is no plugin API to ask it for one. The
 * owner is read from the same local file the provider's own CLI keeps it in — the
 * address only; the tokens sitting beside it are never read or forwarded.
 *
 *   claude -> $CLAUDE_CONFIG_DIR/.claude.json  oauthAccount.emailAddress
 *   codex  -> $CODEX_HOME/auth.json            the id_token's `email` claim
 *
 * Any other provider stays null, which renders the same as "signed in, owner
 * unknown": the header simply prints no address.
 */

/** The address Claude Code records for the logged-in account. */
export function claudeOwner(config: unknown): string | null {
  const account = (config as { oauthAccount?: { emailAddress?: unknown } } | null)?.oauthAccount;
  return typeof account?.emailAddress === "string" ? account.emailAddress || null : null;
}

/**
 * Codex stores no address of its own — it keeps the OIDC id_token, whose payload
 * carries one. Only the claims are decoded; the signature is nobody's business
 * here, because this is a display label and not an authorization decision.
 */
export function codexOwner(auth: unknown): string | null {
  const token = (auth as { tokens?: { id_token?: unknown } } | null)?.tokens?.id_token;
  if (typeof token !== "string") {
    return null;
  }
  const payload = token.split(".")[1];
  if (!payload) {
    return null;
  }
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: unknown;
    };
    return typeof claims?.email === "string" ? claims.email || null : null;
  } catch {
    return null;
  }
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    // Missing, unreadable, half-written: all of them mean the same thing here.
    return null;
  }
}

const READERS: Record<string, () => Promise<string | null>> = {
  claude: async () =>
    claudeOwner(await readJson(join(process.env["CLAUDE_CONFIG_DIR"] || homedir(), ".claude.json"))),
  codex: async () =>
    codexOwner(await readJson(join(process.env["CODEX_HOME"] || join(homedir(), ".codex"), "auth.json"))),
};

/**
 * `.claude.json` also holds the per-project history, so it grows into the
 * megabytes on an old install, and the panel re-reads usage every 60 seconds.
 * The address inside changes about as often as you log in, so it is cached.
 */
const TTL_MS = 10 * 60_000;
const cache = new Map<string, { owner: string | null; at: number }>();

async function ownerFor(providerId: string): Promise<string | null> {
  const hit = cache.get(providerId);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return hit.owner;
  }
  const owner = (await READERS[providerId]?.()) ?? null;
  cache.set(providerId, { owner, at: Date.now() });
  return owner;
}

/**
 * One block per account.
 *
 * A subscription reports the same numbers wherever it is signed in, so two rows
 * resolving to one owner are one reading shown twice. The first wins and the rest
 * are dropped rather than merged — there is nothing to merge, the windows and
 * resets are identical.
 *
 * Rows whose owner could not be read are never folded together: null is "unknown",
 * not "the same unknown account".
 */
export function dedupeByAccount(providers: readonly ProviderUsage[]): ProviderUsage[] {
  const seen = new Set<string>();
  return providers.filter((provider) => {
    if (!provider.accountLabel) {
      return true;
    }
    if (seen.has(provider.accountLabel)) {
      return false;
    }
    seen.add(provider.accountLabel);
    return true;
  });
}

export async function withAccounts(snapshot: UsageSnapshot): Promise<UsageSnapshot> {
  const providers = await Promise.all(
    snapshot.providers.map(async (provider) => ({
      ...provider,
      accountLabel: await ownerFor(provider.providerId),
    })),
  );
  return { ...snapshot, providers: dedupeByAccount(providers) };
}
