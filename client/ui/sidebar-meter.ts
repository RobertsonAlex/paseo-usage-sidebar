import type { PluginCleanup } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { messagesFor, type Locale, type Messages } from "../../shared/i18n/messages";
import { getLocale, subscribeLocale } from "../i18n/locale";
import { publishSelection, subscribeSelection } from "../selection/store";
import { claimAccounts, heldAccounts } from "../usage/claims";
import { pinnedRows, readSelection, type Selection } from "../../shared/selection/contract";
import {
  clampPct,
  formatPct,
  formatResetPrimary,
  formatResetSecondary,
  formatRunsOutLabel,
  resolveTone,
} from "../../shared/usage/format";
import { paceColor, STATUS_DARK, STATUS_LIGHT, type Palette } from "../../shared/usage/palette";
import { elapsedPct, formatPaceDelta, paceLabel, windowPace } from "../../shared/usage/pace";
import { isMeterStale } from "../../shared/usage/errors";
import { listUsage, type UsageSnapshot, type UsageTone, type UsageWindow } from "../../shared/usage/contract";
import { windowLabel } from "../../shared/usage/window-label";

/**
 * An always-visible meter directly under the plugin's own sidebar item.
 *
 * Paseo has no sidebar-widget contribution: a sidebar item is
 * `{ id, title, icon, surface }` and renders as a host-owned row. This mounts a
 * plain DOM node next to that row instead, which is possible only because the
 * desktop and web clients evaluate plugin client bundles inside the same
 * renderer. It is unsupported by the plugin API and deliberately fail-soft:
 * every step that depends on host internals degrades to "render nothing".
 *
 * Anchor: the row's testID, which Paseo derives from this plugin's own id, so it
 * cannot collide with another plugin.
 */
const ANCHOR_SELECTOR = '[data-testid="plugin-sidebar-usage-sidebar-usage"]';
const REFRESH_INTERVAL_MS = 60_000;
/** Theme changes are not announced in the DOM, so the probed colours are polled. */
const APPEARANCE_POLL_MS = 2_000;
const NODE_MARK = "data-usage-sidebar-meter";

/**
 * Paseo's built-in themes, keyed by the sidebar background they paint.
 *
 * Plugins receive theme colors as props inside a surface, but this meter is a raw
 * DOM node outside React, so the theme has to be identified from what is actually
 * rendered. Every built-in theme paints a distinct sidebar background, which makes
 * it a reliable key. The label and track values are Paseo's own tokens, so the
 * meter's chrome matches the app exactly rather than approximating it; the bar
 * fills come from the plugin's shared ramp (shared/usage/palette.ts), which the
 * panel paints from too.
 */
type ThemeTokens = { track: string; label: string; status: Palette };

const THEMES: ReadonlyArray<{ sidebar: [number, number, number] } & ThemeTokens> = [
  // light
  { sidebar: [244, 244, 245], track: "#e4e4e7", label: "#71717a", status: STATUS_LIGHT },
  // dark
  { sidebar: [20, 23, 22], track: "#434645", label: "#A1A5A4", status: STATUS_DARK },
  // zinc
  { sidebar: [19, 19, 22], track: "#3f3f46", label: "#a1a1aa", status: STATUS_DARK },
  // midnight
  { sidebar: [18, 20, 32], track: "#3c3e4c", label: "#9a9db0", status: STATUS_DARK },
  // claude
  { sidebar: [26, 25, 24], track: "#4a4745", label: "#ada9a5", status: STATUS_DARK },
  // ghostty
  { sidebar: [33, 37, 45], track: "#4a4f5e", label: "#c8ccd8", status: STATUS_DARK },
  // pure black
  { sidebar: [0, 0, 0], track: "#202020", label: "#a1a1aa", status: STATUS_DARK },
];

/** dark (#141716) and zinc (#131316) differ by 5, so match the nearest theme, not the first in range. */
const MATCH_MAX_DISTANCE = 12;

function parseColor(value: string): { rgb: [number, number, number]; alpha: number } | null {
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) {
    return null;
  }
  const parts = (match[1] ?? "")
    .split(/[,/]/)
    .map((part) => Number.parseFloat(part.trim()))
    .filter((part) => !Number.isNaN(part));
  if (parts.length < 3) {
    return null;
  }
  return {
    rgb: [parts[0] as number, parts[1] as number, parts[2] as number],
    alpha: parts.length > 3 ? (parts[3] as number) : 1,
  };
}

function luminanceOf(rgb: [number, number, number]): number {
  return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
}

/**
 * A row-level highlight is at most a row tall; the sidebar background is the
 * whole column. Anything within that slack of the anchor's own height is the
 * selected-row tint, not the theme.
 */
const ROW_HEIGHT_SLACK = 1.5;

/**
 * First ancestor background that actually paints the *sidebar* — not the row.
 *
 * While the plugin's own surface is open, Paseo marks its sidebar row selected
 * and paints a surface tint on it. That tint is far lighter than the sidebar on
 * every dark theme, so probing it identified the Light theme and repainted the
 * meter in dark-on-dark text the moment you opened the panel. Row-sized painted
 * ancestors are therefore skipped: only a container spanning more than one row
 * can be carrying the theme's background.
 */
function paintedBackground(anchor: Element): [number, number, number] | null {
  const rowHeight = anchor.getBoundingClientRect().height;
  let current: Element | null = anchor;
  while (current) {
    const parsed = parseColor(getComputedStyle(current).backgroundColor);
    const spansMoreThanARow = rowHeight <= 0 || current.getBoundingClientRect().height > rowHeight * ROW_HEIGHT_SLACK;
    if (parsed && parsed.alpha > 0.05 && spansMoreThanARow) {
      return parsed.rgb;
    }
    current = current.parentElement;
  }
  return null;
}

function matchTheme(background: [number, number, number]): ThemeTokens | null {
  let best: ThemeTokens | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const theme of THEMES) {
    const distance =
      Math.abs(theme.sidebar[0] - background[0]) +
      Math.abs(theme.sidebar[1] - background[1]) +
      Math.abs(theme.sidebar[2] - background[2]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = theme;
    }
  }
  return bestDistance <= MATCH_MAX_DISTANCE ? best : null;
}

type Appearance = { labelColor: string; trackColor: string; palette: Palette; key: string };

/**
 * Exact tokens for a built-in theme; for anything else (a plugin-contributed
 * theme) fall back to the rendered text color plus a light/dark status palette
 * chosen by background luminance.
 */
function readAppearance(): Appearance | null {
  const anchor = document.querySelector(ANCHOR_SELECTOR);
  if (!anchor) {
    return null;
  }
  const background = paintedBackground(anchor);
  const matched = background ? matchTheme(background) : null;
  if (matched) {
    return {
      labelColor: matched.label,
      trackColor: matched.track,
      palette: matched.status,
      key: `${matched.label}|${matched.track}|${matched.status.ok}`,
    };
  }

  const dark = background ? luminanceOf(background) <= 0.5 : true;
  const labelColor = getComputedStyle(anchor).color || (dark ? "#A1A5A4" : "#71717a");
  const rgb = parseColor(labelColor)?.rgb ?? (dark ? [161, 165, 164] : [113, 113, 122]);
  return {
    labelColor,
    trackColor: `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.22)`,
    palette: dark ? STATUS_DARK : STATUS_LIGHT,
    key: `fallback|${labelColor}|${dark ? "dark" : "light"}`,
  };
}

type MeterRow = { label: string; usedPct: number | null; tone: UsageTone; window: UsageWindow };
type MeterGroup = { provider: string; account: string | null; rows: MeterRow[] };

type RowTiming = { text: string | null; atRisk: boolean; alternate: string | null };

/**
 * The line under a row. A window projected to run out before it resets says so
 * instead — that is the number that changes what you do next — and whichever
 * reset form the row did not print rides along in the tooltip, so a countdown
 * still yields its wall-clock instant on hover and vice versa.
 */
function rowTiming(row: MeterRow, messages: Messages, locale: Locale): RowTiming {
  const atRisk = row.window.runsOutAt != null && row.window.shortfallPct != null;
  return {
    text: atRisk
      ? formatRunsOutLabel(row.window.runsOutAt, messages)
      : formatResetPrimary(row.window.resetsAt, locale, messages),
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
function toGroups(snapshot: UsageSnapshot, selection: Selection, messages: Messages): MeterGroup[] {
  const groups: MeterGroup[] = [];
  const rows = pinnedRows(snapshot, selection, (_provider, window) => windowLabel(window, messages), messages);
  for (const row of rows) {
    const entry: MeterRow = {
      label: row.label,
      usedPct: row.usedPct,
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
function groupKey(group: MeterGroup): string {
  return `${group.provider}\u0000${group.account ?? ""}`;
}

export function startSidebarMeter(client: PluginClientContext): PluginCleanup {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
    return () => {};
  }

  // Not captured: Paseo's language setting can change while the meter is
  // mounted, and the meter repaints from these on every poll and every pin
  // change, so a stale capture would pin the whole block to the language that
  // happened to be active when the plugin loaded.
  let locale: Locale = getLocale("web");
  let messages: Messages = messagesFor(locale);
  let node: HTMLElement | null = null;
  let snapshot: UsageSnapshot | null = null;
  let selection: Selection = { keys: [], configured: false, showPace: true };
  let groups: MeterGroup[] = [];
  // Folded headings, by group key. Client-side and unpersisted on purpose: paint()
  // rebuilds the block from scratch on every poll, so the fold has to outlive the
  // nodes it applies to — but not the session.
  const folded = new Set<string>();
  let stopped = false;
  let appearance: Appearance | null = null;
  /** Drives `isMeterStale`; reset by any poll that lands. */
  let consecutiveFailures = 0;

  /** Repaints only when the measured colours actually changed. */
  function syncAppearance(): boolean {
    const next = readAppearance();
    if (!next) {
      return false;
    }
    if (appearance && appearance.key === next.key) {
      return false;
    }
    appearance = next;
    return true;
  }

  function recompute(): void {
    // Re-asked rather than remembered: the claim can lapse between polls, and a
    // copy that lost it has to stop painting the block the other machine now owns.
    groups = snapshot ? toGroups(heldAccounts(snapshot), selection, messages) : [];
  }

  function paint(): void {
    if (!node) {
      return;
    }
    const { labelColor, trackColor, palette } = appearance ?? {
      labelColor: STATUS_DARK.default,
      trackColor: "rgba(139, 144, 160, 0.22)",
      palette: STATUS_DARK,
    };

    node.textContent = "";
    // An empty flex column still occupies its own margins, which under a sidebar
    // row reads as a gap nobody asked for. `none` rather than removing the node:
    // the MutationObserver would see the removal and mount it straight back.
    node.style.display = groups.length === 0 ? "none" : "flex";
    if (groups.length === 0) {
      return;
    }

    /**
     * The block has no room for a sentence, and the countdowns keep ticking
     * through a failed poll, so without this the meter looks live while showing
     * numbers that stopped moving. Fading it is the whole signal the space
     * allows; the panel carries the explanation and the fix.
     */
    node.style.opacity = isMeterStale(consecutiveFailures, groups.length) ? "0.45" : "1";

    for (const group of groups) {
      // Rows are three lines tall now (label, bar, countdown), so they need more
      // air between them than within them or the block reads as one paragraph.
      const section = document.createElement("div");
      section.style.cssText = "display:flex;flex-direction:column;gap:8px;";

      const key = groupKey(group);
      const open = !folded.has(key);

      const provider = document.createElement("div");
      // The whole block is click-through, so a heading that folds has to opt back
      // in — and say so, both to the eye (the caret) and to a screen reader.
      provider.style.cssText = `color:${labelColor};font-size:10px;font-weight:600;letter-spacing:0.04em;opacity:0.75;display:flex;align-items:baseline;gap:6px;pointer-events:auto;cursor:pointer;user-select:none;`;
      provider.setAttribute("role", "button");
      provider.setAttribute("tabindex", "0");
      provider.setAttribute("aria-expanded", open ? "true" : "false");
      const toggle = () => {
        if (folded.has(key)) {
          folded.delete(key);
        } else {
          folded.add(key);
        }
        paint();
      };
      provider.onclick = toggle;
      provider.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggle();
        }
      };

      // The name takes the slack so the caret keeps the trailing edge, and the
      // ellipsis stays on the text rather than eating the affordance.
      const heading = document.createElement("span");
      heading.textContent = group.provider;
      heading.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      if (group.account) {
        // Trailing, and the first thing the ellipsis eats: at this width the
        // provider name is what makes the rows under it legible, and the address
        // is what tells two plans apart once you already know the name. Dropped
        // back to normal weight and no letter-spacing — the heading's tracking is
        // for a short label, and an email wearing it reads as shouting.
        const account = document.createElement("span");
        account.textContent = ` · ${group.account}`;
        account.style.cssText = "font-weight:400;letter-spacing:0;opacity:0.85;";
        heading.append(account);
      }

      // Vertical glyphs only: a sideways caret points the wrong way in Arabic.
      const caret = document.createElement("span");
      caret.textContent = open ? "▴" : "▾";
      caret.style.cssText = "font-weight:400;letter-spacing:0;flex-shrink:0;";
      caret.setAttribute("aria-hidden", "true");
      provider.append(heading, caret);
      section.append(provider);

      for (const row of open ? group.rows : []) {
        const item = document.createElement("div");
        item.style.cssText = "display:flex;flex-direction:column;gap:3px;";

        const head = document.createElement("div");
        head.style.cssText = "display:flex;justify-content:space-between;gap:8px;align-items:baseline;";

        const label = document.createElement("span");
        label.textContent = row.label;
        label.style.cssText = `color:${labelColor};font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;

        const value = document.createElement("span");
        value.textContent = row.usedPct != null ? formatPct(row.usedPct, locale) : "\u2014";
        value.style.cssText = `color:${labelColor};font-size:11px;font-weight:500;flex-shrink:0;`;

        // The head is space-between, so the number and its arrow travel as one
        // group; appended straight to the head, a third child would be flung to
        // the opposite edge with the percentage stranded in the middle.
        const valueGroup = document.createElement("div");
        valueGroup.style.cssText = "display:flex;align-items:baseline;gap:3px;flex-shrink:0;";
        valueGroup.append(value);
        head.append(label, valueGroup);

        // Computed here rather than in recompute(): it is a comparison against
        // the clock, and paint() runs on the 60-second poll while recompute()
        // only runs when the snapshot, the pins, or the language change.
        const pace = selection.showPace ? windowPace(row.window, row.usedPct) : null;
        if (pace) {
          const mark = document.createElement("span");
          mark.textContent = formatPaceDelta(pace, locale);
          mark.style.cssText = `color:${paceColor(palette, pace.trend)};font-size:11px;font-weight:600;flex-shrink:0;`;
          // The glyph alone reads as decoration to a screen reader.
          mark.setAttribute("aria-label", paceLabel(pace, locale, messages));
          valueGroup.append(mark);
        }

        const track = document.createElement("div");
        track.style.cssText = `height:3px;border-radius:2px;background:${trackColor};overflow:hidden;`;

        const fill = document.createElement("div");
        fill.style.cssText = `height:3px;border-radius:2px;width:${clampPct(row.usedPct ?? 0)}%;background:${palette[row.tone]};`;

        track.append(fill);

        // The tick sits outside the track, which clips its own fill to keep the
        // rounded ends — and a marker the height of a 3px bar is not a marker.
        const trackRow = document.createElement("div");
        trackRow.style.cssText = "position:relative;";
        trackRow.append(track);
        if (pace) {
          // Where the bar would stand if it were tracking the clock exactly.
          const tick = document.createElement("div");
          tick.style.cssText = `position:absolute;top:-2px;height:7px;width:2px;border-radius:1px;margin-inline-start:-1px;inset-inline-start:${clampPct(elapsedPct(row.window) ?? 0)}%;background:${paceColor(palette, pace.trend)};`;
          trackRow.append(tick);
        }
        item.append(head, trackRow);

        // A percentage alone cannot be acted on: 90% used is fine with a reset an
        // hour out and a problem with three days to go.
        const timing = rowTiming(row, messages, locale);
        if (timing.text) {
          const foot = document.createElement("div");
          foot.textContent = timing.text;
          // Same size as the label and barely dimmed: this is the number that
          // says whether the percentage above it matters, so it has to survive a
          // glance at a dark sidebar rather than fade into it.
          foot.style.cssText = `color:${timing.atRisk ? palette.danger : labelColor};font-size:11px;opacity:${timing.atRisk ? "1" : "0.85"};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
          item.append(foot);
        }
        if (timing.alternate) {
          item.title = `${row.label} · ${timing.alternate}`;
          // The meter as a whole is click-through; a row with a tooltip has to opt
          // back in, because pointer-events:none also suppresses hover.
          item.style.pointerEvents = "auto";
        }

        section.append(item);
      }

      node.append(section);
    }

    node.title = messages.title;
  }

  function ensureMounted(): void {
    if (stopped) {
      return;
    }
    const anchor = document.querySelector(ANCHOR_SELECTOR);
    const parent = anchor?.parentElement;
    if (!anchor || !parent) {
      return;
    }
    if (node && node.parentElement === parent) {
      return;
    }
    node?.remove();

    const created = document.createElement("div");
    created.setAttribute(NODE_MARK, "true");
    const anchorStyle = getComputedStyle(anchor);
    created.style.cssText = [
      "display:flex",
      "flex-direction:column",
      "gap:9px",
      "margin:5px 0 9px",
      `padding-left:${anchorStyle.paddingLeft || "8px"}`,
      `padding-right:${anchorStyle.paddingRight || "8px"}`,
      "pointer-events:none",
    ].join(";");

    parent.insertBefore(created, anchor.nextSibling);
    node = created;
    syncAppearance();
    paint();
  }

  async function refresh(): Promise<void> {
    try {
      // Claimed rather than shown outright: with a second machine connected, both
      // copies of this plugin paint into the same sidebar, and only one of them
      // should paint a shared subscription. See client/usage/claims.ts.
      snapshot = claimAccounts((await client.rpc(listUsage, {})) as UsageSnapshot);
      consecutiveFailures = 0;
      recompute();
      ensureMounted();
      syncAppearance();
      paint();
    } catch {
      // Keep the last snapshot, but still repaint: the countdowns are relative to
      // now, so they have to keep ticking through a failed poll — and past the
      // second failure the repaint is also what fades the block. Recomputed, not
      // just repainted — a poll that keeps failing is how a claim lapses, and
      // this is the only place that notices.
      consecutiveFailures += 1;
      recompute();
      paint();
    }
  }

  // The sidebar unmounts on route changes and on window resize breakpoints.
  const observer = new MutationObserver(() => ensureMounted());
  observer.observe(document.body, { childList: true, subtree: true });

  const unsubscribe = subscribeSelection((next) => {
    selection = next;
    recompute();
    ensureMounted();
    paint();
  });

  // Window labels, countdowns, and the percentage's number formatting all come
  // from these, so a language change has to rebuild the rows, not just repaint.
  const unsubscribeLocale = subscribeLocale((next) => {
    locale = next;
    messages = messagesFor(next);
    recompute();
    ensureMounted();
    paint();
  });

  async function loadSelection(): Promise<void> {
    try {
      publishSelection((await client.rpc(readSelection, {})) as Selection);
    } catch {
      // Leaves the default pin set in place.
    }
  }

  ensureMounted();
  void loadSelection();
  void refresh();
  const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
  const appearanceTimer = setInterval(() => {
    if (!stopped && syncAppearance()) {
      paint();
    }
  }, APPEARANCE_POLL_MS);

  const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : null;
  const onSchemeChange = () => {
    if (syncAppearance()) {
      paint();
    }
  };
  media?.addEventListener("change", onSchemeChange);

  return () => {
    stopped = true;
    clearInterval(timer);
    clearInterval(appearanceTimer);
    unsubscribe();
    unsubscribeLocale();
    media?.removeEventListener("change", onSchemeChange);
    observer.disconnect();
    node?.remove();
    node = null;
  };
}
