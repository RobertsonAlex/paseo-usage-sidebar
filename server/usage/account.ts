import type { ProviderUsage, UsageSnapshot } from "../../shared/usage/contract";

/**
 * Whose subscription a row is reporting.
 *
 * Paseo 0.11 names an account-scoped row `Source (account)` and that name is
 * shown as-is. The account is still pulled out as a key: dedupe and the
 * cross-machine claims (client/usage/claims.ts) group by it.
 */
export function accountOf(displayName: string): string | null {
  return displayName.match(/ \(([^()]+)\)$/)?.[1] ?? null;
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

export function withAccounts(snapshot: UsageSnapshot): UsageSnapshot {
  const providers = snapshot.providers.map((provider) => ({
    ...provider,
    accountLabel: accountOf(provider.displayName),
  }));
  return { ...snapshot, providers: dedupeByAccount(providers) };
}
