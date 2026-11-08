import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginHostProps } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { messagesFor, type Locale, type Messages } from "../../shared/i18n/messages";
import type { Selection } from "../../shared/selection/contract";
import { countFailedPolls, isMeterStale, isUsageDisabled, type PollTally } from "../../shared/usage/errors";
import { clampPct, formatPct, type DisplayMode } from "../../shared/usage/format";
import { groupKey, rowTiming, toGroups, type MeterRow } from "../../shared/usage/meter";
import { formatPaceDelta, paceLabel, paceMarkPct, windowPace } from "../../shared/usage/pace";
import { paceColor, paletteForSurface, type Palette } from "../../shared/usage/palette";
import { useLocale } from "../i18n/locale";
import { getSelection, subscribeSelection } from "../selection/store";
import { heldAccounts } from "../usage/claims";
import { useSelectionQuery, useUsageSnapshot } from "../usage/queries";
import { setWebTitle } from "../web";

const DEFAULT_SELECTION: Selection = { keys: [], configured: false, showPace: true, displayAs: "used" };

/**
 * Folded headings, by group key. Module-level and unpersisted on purpose: the
 * fold has to outlive a sidebar remount (route changes, resize breakpoints) but
 * not the session.
 */
const folded = new Set<string>();
let foldVersion = 0;
const foldListeners = new Set<() => void>();

function toggleFold(key: string): void {
  if (!folded.delete(key)) {
    folded.add(key);
  }
  foldVersion += 1;
  for (const listener of foldListeners) {
    listener();
  }
}

function subscribeFold(listener: () => void): () => void {
  foldListeners.add(listener);
  return () => {
    foldListeners.delete(listener);
  };
}

const getFoldVersion = () => foldVersion;

/** The track is the label colour, faint; a theme that is not `#rrggbb` gets its border instead. */
function trackColor(theme: PluginTheme): string {
  const muted = theme.colors.foregroundMuted;
  return /^#[0-9a-f]{6}$/i.test(muted) ? `${muted}38` : theme.colors.border;
}

type RowContext = {
  labelColor: string;
  track: string;
  palette: Palette;
  locale: Locale;
  messages: Messages;
  showPace: boolean;
  displayAs: DisplayMode;
  platform: PluginHostProps["layout"]["platform"];
};

function MeterRowView({ row, ctx }: { row: MeterRow; ctx: RowContext }) {
  const ref = useRef<View | null>(null);
  // Read at render, not memoized: comparisons against the clock, and the meter
  // re-renders on every poll.
  const pace = ctx.showPace ? windowPace(row.window, row.usedPct) : null;
  const timing = rowTiming(row, ctx.messages, ctx.locale);
  const tooltip = timing.alternate ? `${row.label} · ${timing.alternate}` : null;
  useEffect(() => {
    setWebTitle(ref.current, tooltip, ctx.platform);
  }, [tooltip, ctx.platform]);

  const color = ctx.labelColor;
  const mark = pace ? paceColor(ctx.palette, pace.trend) : null;
  return (
    <View ref={ref} style={styles.item}>
      {/* Space-between, so the number and its arrow travel as one group at the trailing edge. */}
      <View style={styles.head}>
        <Text numberOfLines={1} style={[styles.label, { color }]}>
          {row.label}
        </Text>
        <View style={styles.valueGroup}>
          <Text style={[styles.value, { color }]}>
            {row.displayPct != null ? formatPct(row.displayPct, ctx.locale) : "—"}
          </Text>
          {pace ? (
            // The glyph alone reads as decoration to a screen reader.
            <Text accessibilityLabel={paceLabel(pace, ctx.locale, ctx.messages)} style={[styles.mark, { color: mark! }]}>
              {formatPaceDelta(pace, ctx.locale)}
            </Text>
          ) : null}
        </View>
      </View>
      {/* The tick sits outside the track, which clips its own fill to keep the rounded ends. */}
      <View style={styles.trackRow}>
        <View style={[styles.track, { backgroundColor: ctx.track }]}>
          <View
            style={[styles.fill, { width: `${clampPct(row.displayPct ?? 0)}%`, backgroundColor: ctx.palette[row.tone] }]}
          />
        </View>
        {pace ? (
          // Where the bar would stand if it were tracking the clock exactly.
          <View
            style={[
              styles.tick,
              { insetInlineStart: `${clampPct(paceMarkPct(row.window, ctx.displayAs) ?? 0)}%`, backgroundColor: mark! },
            ]}
          />
        ) : null}
      </View>
      {/* A percentage alone cannot be acted on: 90% used is fine with a reset an hour out. */}
      {timing.text ? (
        <Text
          numberOfLines={1}
          style={[
            styles.foot,
            { color: timing.atRisk ? ctx.palette.danger : color, opacity: timing.atRisk ? 1 : 0.85 },
          ]}
        >
          {timing.text}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The always-visible meter under the plugin's sidebar row: the pinned windows,
 * grouped per provider account under a heading that folds. Rendered by the
 * sidebar item itself, so it follows the host's theme, layout and lifetime.
 */
export function SidebarMeter({
  theme,
  layout,
  onOpen,
}: {
  theme: PluginTheme;
  layout: PluginHostProps["layout"];
  onOpen: () => void;
}) {
  const locale = useLocale(layout.platform);
  const messages = useMemo(() => messagesFor(locale), [locale]);
  const query = useUsageSnapshot();
  const selectionQuery = useSelectionQuery();
  // The store carries the panel's saved edits the moment they land.
  const published = useSyncExternalStore(subscribeSelection, getSelection, getSelection);
  const selection = published ?? selectionQuery.data ?? DEFAULT_SELECTION;
  useSyncExternalStore(subscribeFold, getFoldVersion, getFoldVersion);

  const tally = useRef<PollTally | null>(null);
  const counted = countFailedPolls(tally.current, query);
  tally.current = counted.tally;

  const blockRef = useRef<View | null>(null);
  useEffect(() => {
    setWebTitle(blockRef.current, messages.title, layout.platform);
  });

  // Usage switched off on the host is not a failure to fade over: there is nothing to show.
  const disabled = query.isError && isUsageDisabled(query.error);
  // Re-asked every render rather than remembered: the claim can lapse between
  // polls, and a copy that lost it has to stop painting the block the other
  // machine now owns.
  const groups = query.data && !disabled ? toGroups(heldAccounts(query.data), selection, messages) : [];
  if (groups.length === 0) {
    return null;
  }

  const ctx: RowContext = {
    labelColor: theme.colors.foregroundMuted,
    track: trackColor(theme),
    palette: paletteForSurface(theme.colors.surface0),
    locale,
    messages,
    showPace: selection.showPace,
    displayAs: selection.displayAs,
    platform: layout.platform,
  };

  // Faded, not explained: the block has no room for a sentence, and the
  // countdowns keep ticking through a failed poll; the panel carries the fix.
  const stale = isMeterStale(counted.failures, groups.length);
  return (
    <View ref={blockRef} style={[styles.block, stale ? styles.stale : null]}>
      {groups.map((group) => {
        const key = groupKey(group);
        const open = !folded.has(key);
        return (
          <View key={key} style={styles.section}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              accessibilityLabel={group.provider}
              onPress={() => toggleFold(key)}
              style={styles.heading}
            >
              <Text numberOfLines={1} style={[styles.headingText, { color: ctx.labelColor }]}>
                {group.provider}
              </Text>
              {/* Vertical glyphs only: a sideways caret points the wrong way in Arabic. */}
              <Text
                aria-hidden
                accessibilityElementsHidden
                importantForAccessibility="no"
                style={[styles.caret, { color: ctx.labelColor }]}
              >
                {open ? "▴" : "▾"}
              </Text>
            </Pressable>
            {/* The rows open the panel. A sibling of the heading, so a fold never navigates. */}
            {open && group.rows.length > 0 ? (
              <Pressable accessibilityRole="button" accessibilityLabel={messages.title} onPress={onOpen} style={styles.body}>
                {group.rows.map((row, index) => (
                  <MeterRowView key={`${row.window.id}:${index}`} row={row} ctx={ctx} />
                ))}
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Lined up with the row's label: the row's container and its pressable each pad by 8.
  block: { flexDirection: "column", gap: 9, marginTop: 5, marginBottom: 9, paddingHorizontal: 16 },
  stale: { opacity: 0.45 },
  // Rows are three lines tall, so they need more air between them than within them.
  section: { flexDirection: "column", gap: 8 },
  heading: { flexDirection: "row", alignItems: "baseline", gap: 6, opacity: 0.75 },
  // The name takes the slack so the caret keeps the trailing edge.
  headingText: { flex: 1, minWidth: 0, fontSize: 10, fontWeight: "600", letterSpacing: 0.4, userSelect: "none" },
  caret: { flexShrink: 0, fontSize: 10, fontWeight: "400" },
  body: { flexDirection: "column", gap: 8 },
  item: { flexDirection: "column", gap: 3 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 },
  label: { flexShrink: 1, fontSize: 11 },
  valueGroup: { flexDirection: "row", alignItems: "baseline", gap: 3, flexShrink: 0 },
  value: { fontSize: 11, fontWeight: "500" },
  mark: { fontSize: 11, fontWeight: "600" },
  trackRow: { position: "relative" },
  track: { height: 3, borderRadius: 2, overflow: "hidden" },
  fill: { height: 3, borderRadius: 2 },
  // Taller than the track on both sides, pulled half its width back so it straddles the instant.
  tick: { position: "absolute", top: -2, height: 7, width: 2, borderRadius: 1, marginInlineStart: -1 },
  // Same size as the label and barely dimmed: this is the number that says whether the percentage matters.
  foot: { fontSize: 11 },
});
