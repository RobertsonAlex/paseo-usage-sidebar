import { withAccounts } from "./account";
import { normalizeSnapshot, type ProviderUsage, type UsageSnapshot } from "./contract";

/**
 * One reading per account across every host this app can reach.
 *
 * Paseo merges a plugin's sidebar item from all connected hosts into one row
 * and mounts a single host's copy of it, so the meter is the only place the
 * whole fleet can be shown, and it has to read the other hosts itself. It reads
 * their daemons directly (`getPaseoClient(id).providers.listUsage()`): Paseo
 * gives a plugin no way to call its own copy on another host.
 *
 * A host that cannot be read is a `null` snapshot, and is skipped rather than
 * failing the fleet: one machine asleep must not blank the others' bars.
 */
export type HostReading = { serverId: string; snapshot: UsageSnapshot | null };

/** A host's daemon read the way this plugin's server half reads its own. */
export async function readHost(serverId: string, listUsage: () => Promise<unknown>): Promise<HostReading> {
  try {
    return { serverId, snapshot: withAccounts(normalizeSnapshot(await listUsage())) };
  } catch {
    return { serverId, snapshot: null };
  }
}

/** A reading with numbers in it beats one without: an error, or a provider reporting nothing. */
function works(provider: ProviderUsage): boolean {
  return provider.status === "available" && provider.windows.length > 0;
}

/**
 * Merge the hosts' readings, one block per account.
 *
 * The rendered host is asked first, then the others in the order Paseo lists
 * them; for each account the first working reading wins, so a host that is
 * rate-limited or erroring hands the account to one that is not. With no
 * working reading anywhere the first error stays, so the account does not just
 * vanish. Blocks keep the position their account was first seen in.
 *
 * Rows whose account cannot be read are never folded together, across hosts as
 * within one: null is "unknown", not "the same unknown account".
 */
export function mergeFleet(readings: readonly HostReading[], renderedServerId: string | null): UsageSnapshot {
  const ordered = [
    ...readings.filter((reading) => reading.serverId === renderedServerId),
    ...readings.filter((reading) => reading.serverId !== renderedServerId),
  ];

  const merged: ProviderUsage[] = [];
  const slot = new Map<string, number>();
  let fetchedAt: string | null = null;
  for (const { snapshot } of ordered) {
    if (!snapshot) {
      continue;
    }
    if (snapshot.fetchedAt && (!fetchedAt || snapshot.fetchedAt > fetchedAt)) {
      fetchedAt = snapshot.fetchedAt;
    }
    for (const provider of snapshot.providers) {
      const account = provider.accountLabel;
      if (!account) {
        merged.push(provider);
        continue;
      }
      const index = slot.get(account);
      if (index === undefined) {
        slot.set(account, merged.length);
        merged.push(provider);
      } else if (!works(merged[index]!) && works(provider)) {
        merged[index] = provider;
      }
    }
  }
  return { fetchedAt, source: "sdk", providers: merged };
}
