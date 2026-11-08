import type { Locale, Messages } from "../i18n/messages";
import { pinnedRows, type Selection } from "../selection/contract";
import type { UsageSnapshot, UsageTone, UsageWindow } from "./contract";
import {
  formatResetPrimary,
  formatResetSecondary,
  formatRunsOutLabel,
  formatWindowReset,
  resolveTone,
  windowDisplayPct,
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
 * Group pinned rows by provider, keeping the order Paseo reports. The provider
 * name is always shown: a bare "Weekly" is ambiguous as soon as a second
 * provider reports usage.
 */
export function toGroups(snapshot: UsageSnapshot, selection: Selection, messages: Messages): MeterGroup[] {
  const groups: MeterGroup[] = [];
  const rows = pinnedRows(snapshot, selection, (_provider, window) => windowLabel(window, messages), messages);
  for (const row of rows) {
    const entry: MeterRow = {
      label: row.label,
      usedPct: row.usedPct,
      displayPct: windowDisplayPct(row.window, selection.displayAs),
      tone: resolveTone(row.window.tone, row.usedPct),
      window: row.window,
    };
    const last = groups[groups.length - 1];
    // Both halves of the heading decide the grouping, not just the name: two
    // accounts on one provider are two plans with two sets of windows, and a
    // heading that named one of them would be counting the other's rows.
    if (last && last.provider === row.providerName && last.account === row.accountLabel) {
      last.rows.push(entry);
    } else {
      groups.push({ provider: row.providerName, account: row.accountLabel, rows: [entry] });
    }
  }
  return groups;
}

/** Both halves, because both halves decide the grouping in toGroups(). */
export function groupKey(group: MeterGroup): string {
  return `${group.provider}\u0000${group.account ?? ""}`;
}
