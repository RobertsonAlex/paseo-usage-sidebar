import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import type { Messages } from "../i18n/messages";
import type { ProviderUsage, UsageSnapshot, UsageWindow } from "../usage/contract";

/**
 * Which rows the sidebar meter pins. A row is identified by provider and window
 * id rather than by index, so a provider that reports its windows in a different
 * order — or temporarily drops one — does not silently repoint the selection.
 */
export const SelectionSchema = z.object({
  keys: z.array(z.string()).default([]),
  /** False until the user picks anything; the meter then shows its own default. */
  configured: z.boolean().default(false),
  /**
   * The pace arrow beside each percentage. Defaults on — it is the reading that
   * says whether the percentage next to it is a problem — and lives here rather
   * than in its own store because it is the second thing this plugin persists
   * and a second state file to keep in sync would cost more than the field does.
   */
  showPace: z.boolean().default(true),
});

export type Selection = z.output<typeof SelectionSchema>;

export const readSelection = defineRpc({
  name: "selection.read",
  input: z.object({}),
  output: SelectionSchema,
});

/**
 * Both fields optional, and each written independently: flipping the pace arrow
 * must not freeze the default pin set into an explicit one, and a reorder must
 * not carry a stale copy of the toggle back over a newer value.
 */
export const writeSelection = defineRpc({
  name: "selection.write",
  input: z.object({ keys: z.array(z.string()).optional(), showPace: z.boolean().optional() }),
  output: SelectionSchema,
});

export function rowKey(providerId: string, windowId: string): string {
  return `${providerId}:${windowId}`;
}

/** Default pin set: every window of the first provider that reports usage. */
export function defaultKeys(snapshot: UsageSnapshot): string[] {
  const provider = snapshot.providers.find(
    (candidate) => candidate.status === "available" && candidate.windows.length > 0,
  );
  return provider ? provider.windows.map((window) => rowKey(provider.providerId, window.id)) : [];
}

/**
 * Apply a rearrangement of the rows on screen to the full pin list.
 *
 * The reorder block only ever sees the pins the current snapshot can resolve, so
 * what it hands back is a permutation of those — not of the list that gets
 * persisted. Saving it as-is dropped every pin whose provider happened to be
 * missing from that one poll, for good. The visible keys are instead dealt back
 * into the slots visible keys already held, which leaves an unresolved pin exactly
 * where it was, ready for the poll that brings its window back.
 */
export function reorderVisible(order: readonly string[], visible: readonly string[]): string[] {
  const slots = new Set(visible);
  const queue = [...visible];
  const next = order.map((key) => (slots.has(key) ? (queue.shift() ?? key) : key));
  // Not reachable from the panel, where `visible` is drawn from `order`; kept so a
  // caller that passes a stray key loses nothing rather than losing it silently.
  return [...next, ...queue];
}

export type PinnedRow = {
  key: string;
  providerId: string;
  providerName: string;
  /** Whose plan the row is counting against, when it could be read. */
  accountLabel: string | null;
  label: string;
  usedPct: number | null;
  window: UsageWindow;
};

/**
 * Resolve a selection against a snapshot, in the order the keys are pinned.
 *
 * The key order is the user's own arrangement, so it wins over the order Paseo
 * reports; an unconfigured selection falls back to `defaultKeys`, which is that
 * provider order. Keys whose provider or window disappeared are skipped rather
 * than rendered as empty rows, and a duplicate key is honoured once.
 */
export function pinnedRows(
  snapshot: UsageSnapshot,
  // Only the arrangement, not the whole stored selection: the panel resolves
  // rows from a local, not-yet-persisted order, and narrowing here keeps it from
  // having to invent a value for every display preference the file grows.
  selection: Pick<Selection, "keys" | "configured">,
  labelFor: (provider: ProviderUsage, window: UsageWindow, messages: Messages) => string,
  messages: Messages,
): PinnedRow[] {
  const available = new Map<string, { provider: ProviderUsage; window: UsageWindow }>();
  for (const provider of snapshot.providers) {
    for (const window of provider.windows) {
      available.set(rowKey(provider.providerId, window.id), { provider, window });
    }
  }

  const rows: PinnedRow[] = [];
  const seen = new Set<string>();
  for (const key of selection.configured ? selection.keys : defaultKeys(snapshot)) {
    const hit = available.get(key);
    if (!hit || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const { provider, window } = hit;
    rows.push({
      key,
      providerId: provider.providerId,
      providerName: provider.displayName,
      accountLabel: provider.accountLabel,
      label: labelFor(provider, window, messages),
      usedPct: window.usedPct ?? (window.remainingPct != null ? 100 - window.remainingPct : null),
      window,
    });
  }
  return rows;
}
