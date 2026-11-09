import type { Locale, Messages } from "../i18n/messages";
import { defaultKeys, rowKey, type Selection } from "../selection/contract";
import type { UsageSnapshot, UsageTone, UsageWindow } from "./contract";
import {
  formatResetPrimary,
  formatResetSecondary,
  formatRunsOutLabel,
  formatWindowReset,
  resolveTone,
  windowDisplayPct,
  windowUsedPct,
} from "./format";
import { windowLabel } from "./window-label";

/** `usedPct` drives tone and pace; `displayPct` is what the row prints and fills, per the used/remaining choice. */
export type MeterRow = { label: string; usedPct: number | null; displayPct: number | null; tone: UsageTone; window: UsageWindow };
export type MeterGroup = { provider: string; account: string | null; rows: MeterRow[] };

export type RowTiming = { text: string | null; atRisk: boolean; alternate: string | null };

/**
 * The line under a row. A window projected to run out before it resets says so
 * instead — that is the number that changes what you do next — and whichever
 * reset form the row did not print rides along in the tooltip, so a countdown
 * still yields its wall-clock instant on hover and vice versa.
 */
export function rowTiming(row: MeterRow, messages: Messages, locale: Locale): RowTiming {
  const atRisk = row.window.runsOutAt != null && row.window.shortfallPct != null;
  return {
    text: atRisk
      ? formatRunsOutLabel(row.window.runsOutAt, messages)
      : formatWindowReset(row.window, locale, messages),
    atRisk,
    alternate: atRisk
      ? formatResetPrimary(row.window.resetsAt, locale, messages)
      : formatResetSecondary(row.window.resetsAt, locale, messages),
  };
}

/**
 * Group pinned rows by provider and account, in pinned order.
 *
 * A pin names a provider id and a window, not an account, so it resolves to that
 * window on every account reporting it. Within one host each account has a
 * provider id of its own; across the fleet two machines report the same id for
 * two different subscriptions, and both are what the pin means.
 *
 * Each heading appears once, where its first pinned row falls, and collects its
 * rows in pinned order beneath it. The provider name is always shown: a bare
 * "Weekly" is ambiguous as soon as a second provider reports usage.
 */
export function toGroups(snapshot: UsageSnapshot, selection: Selection, messages: Messages): MeterGroup[] {
  const groups: MeterGroup[] = [];
  const byHeading = new Map<string, MeterGroup>();
  const seen = new Set<string>();
  for (const key of selection.configured ? selection.keys : defaultKeys(snapshot)) {
    for (const provider of snapshot.providers) {
      const window = provider.windows.find((candidate) => rowKey(provider.providerId, candidate.id) === key);
      // Both halves of the heading decide the grouping, not just the name: two
      // accounts on one provider are two plans with two sets of windows, and a
      // heading that named one of them would be counting the other's rows.
      const heading: MeterGroup = { provider: provider.displayName, account: provider.accountLabel, rows: [] };
      const headingKey = groupKey(heading);
      if (!window || seen.has(`${headingKey}\u0000${key}`)) {
        continue;
      }
      seen.add(`${headingKey}\u0000${key}`);
      const usedPct = windowUsedPct(window);
      let group = byHeading.get(headingKey);
      if (!group) {
        group = heading;
        byHeading.set(headingKey, group);
        groups.push(group);
      }
      group.rows.push({
        label: windowLabel(window, messages),
        usedPct,
        displayPct: windowDisplayPct(window, selection.displayAs),
        tone: resolveTone(window.tone, usedPct),
        window,
      });
    }
  }
  return groups;
}

/** Both halves, because both halves decide the grouping in toGroups(). */
export function groupKey(group: MeterGroup): string {
  return `${group.provider}\u0000${group.account ?? ""}`;
}
