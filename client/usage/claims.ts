import type { UsageSnapshot } from "../../shared/usage/contract";

/**
 * One block per account, across plugin instances.
 *
 * Paseo's client can hold more than one daemon at a time — this machine and a
 * second PC — and each daemon runs its own copy of this plugin. The server half
 * of a copy is a subprocess of its own daemon, and `provider.usage.list` has no
 * host dimension, so no copy can see another's providers: two machines signed
 * into one Claude subscription each report it, and the sidebar paints the same
 * reading twice.
 *
 * The renderer is the one place the copies meet — every client bundle is
 * evaluated in it, which is also what lets sidebar-meter.ts touch the DOM at all
 * — so the claim lives on `globalThis`. Each copy claims the accounts it is
 * painting; a copy that finds an account already held renders nothing for it.
 *
 * The key is versioned because the copies are not the same build: one host
 * updates before the other, and a build that predates this file simply does not
 * participate. That degrades to today's duplicate, which is the right failure.
 */

const KEY = "__paseoUsageSidebarAccountClaims_v1";

type Claim = { holder: object; at: number };

/**
 * A claim is a lease, not a lock.
 *
 * A copy whose daemon goes unreachable keeps its client bundle alive in the
 * renderer — nothing tears it down — and a permanent claim would leave the
 * surviving machine's block hidden behind a dead one forever. The holder renews
 * on every poll, so the lease only has to outlive a missed poll or two.
 *
 * ponytail: a fixed TTL rather than a heartbeat. It is tied to the 60s poll in
 * both surfaces; raise it with them, or move to a heartbeat if the meter ever
 * stops polling on a fixed interval.
 */
const LEASE_MS = 150_000;

function registry(): Map<string, Claim> {
  const scope = globalThis as Record<string, unknown>;
  const existing = scope[KEY];
  // Bundles are evaluated in one realm, so `Map` is the same intrinsic in each
  // copy and this holds across builds.
  if (existing instanceof Map) {
    return existing as Map<string, Claim>;
  }
  const created = new Map<string, Claim>();
  scope[KEY] = created;
  return created;
}

/**
 * This copy's identity, at module scope so the panel and the sidebar meter claim
 * as one instance. Two objects here would have the two surfaces of a single copy
 * competing for the same account, and whichever polled second would go blank.
 */
const SELF: object = {};

function holds(account: string, holder: object, now: number): boolean {
  const current = registry().get(account);
  return current != null && current.holder === holder && now - current.at <= LEASE_MS;
}

function claim(account: string, holder: object, now: number): boolean {
  const claims = registry();
  const current = claims.get(account);
  if (current && current.holder !== holder && now - current.at <= LEASE_MS) {
    return false;
  }
  claims.set(account, { holder, at: now });
  return true;
}

/**
 * The providers this copy is the one to paint.
 *
 * Providers with no readable account are always kept: null is "unknown", not
 * "the same unknown account" — the rule the server half already applies within a
 * single host (server/usage/account.ts).
 */
export function claimAccounts(
  snapshot: UsageSnapshot,
  holder: object = SELF,
  now: number = Date.now(),
): UsageSnapshot {
  return {
    ...snapshot,
    providers: snapshot.providers.filter(
      (provider) => !provider.accountLabel || claim(provider.accountLabel, holder, now),
    ),
  };
}

/**
 * The providers this copy holds *right now*, claiming and renewing nothing.
 *
 * The split from `claimAccounts` is what makes the lease mean anything. A copy
 * repaints on a failed poll too — the countdowns are relative to now, so they
 * have to keep ticking — and if that repaint renewed, a copy whose daemon had
 * gone unreachable would hold its accounts forever by failing at them, which is
 * the exact case the lease exists for. So only a poll that came back with
 * numbers renews; painting merely asks.
 *
 * The consequence is deliberate: a copy that has not reached its daemon for a
 * lease goes quiet, whether or not another machine is there to take over. By
 * then its numbers are two and a half minutes stale, and a stale block that
 * claims to be current is worse than no block.
 */
export function heldAccounts(
  snapshot: UsageSnapshot,
  holder: object = SELF,
  now: number = Date.now(),
): UsageSnapshot {
  return {
    ...snapshot,
    providers: snapshot.providers.filter(
      (provider) => !provider.accountLabel || holds(provider.accountLabel, holder, now),
    ),
  };
}

/**
 * Hand everything back. Called from the client cleanup so a reload, a disabled
 * plugin, or a closed connection passes the accounts on at once rather than
 * leaving the other host waiting out the lease.
 */
export function releaseAccounts(holder: object = SELF): void {
  const claims = registry();
  for (const [account, current] of claims) {
    if (current.holder === holder) {
      claims.delete(account);
    }
  }
}
