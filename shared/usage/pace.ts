import type { Locale, Messages } from "../i18n/messages";
import type { UsageWindow } from "./contract";
import { formatPct } from "./format";

/**
 * How far ahead of the clock a window is being spent.
 *
 * A percentage on its own cannot be acted on, and neither can a reset time: 57%
 * used is comfortable four hours into a five-hour window and alarming twenty
 * minutes in. This compares the share consumed against the share of the window
 * that has elapsed, and reports the gap in percentage points — the same unit as
 * the number it is printed beside, so the two need only one mental model.
 *
 * The daemon reports `resetsAt` but never a window start or a duration, so the
 * elapsed share has to be reconstructed backwards from the reset instant using a
 * known period per window id. Ids outside that table return null and the row
 * renders exactly as it did before: a guessed duration would put a confident
 * arrow on a number nobody can check.
 */

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Below this many points the reading is noise — the elapsed share moves every
 * second while the used share only moves when you spend, so every bar would
 * flicker an arrow at a fraction of a point off pace and the signal would stop
 * meaning anything.
 */
const ON_PACE_PTS = 1;
/** Past this, the overspend is no longer a nudge. */
const OVER_PACE_PTS = 5;

export type PaceTrend = "behind" | "ahead" | "over";
export type Pace = { deltaPts: number; trend: PaceTrend };

/**
 * The same clock instant one calendar month earlier, clamped into short months.
 *
 * A flat 30 days would put the monthly window's start up to a day and a half off
 * and quietly bias every reading taken from it. Naive `setMonth(-1)` has the
 * opposite failure — 31 March rolls forward into 3 March — so the day is pinned
 * to the 1st across the month change and restored afterwards.
 *
 * All of it in UTC, which is not cosmetic: a reset at midnight UTC on the 1st is
 * still the previous month's last day in any negative offset, and the local-time
 * form of this walked that case back an extra month — a 31-day span for February,
 * and every reading off it biased by days.
 */
function oneMonthEarlier(at: number): number {
  const date = new Date(at);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - 1);
  const daysInMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, daysInMonth));
  return date.getTime();
}

/**
 * How long the window covers, by id. Mirrors the id vocabulary `windowLabel`
 * reads, minus the ones whose period the id does not state: `coding_limit_*`,
 * `interval_*`, and any provider-specific id keep their unknown duration.
 */
function windowDurationMs(window: UsageWindow, resetsAtMs: number): number | null {
  const { id } = window;
  if (id === "five_hour") {
    return 5 * HOUR_MS;
  }
  if (id === "weekly" || id.startsWith("weekly_")) {
    return 7 * DAY_MS;
  }
  if (id === "daily") {
    return DAY_MS;
  }
  if (id === "monthly") {
    return resetsAtMs - oneMonthEarlier(resetsAtMs);
  }
  return null;
}

/** Share of the window already elapsed, or null when its period is unknowable. */
export function elapsedPct(window: UsageWindow, now: number = Date.now()): number | null {
  const resetsAtMs = window.resetsAt ? new Date(window.resetsAt).getTime() : Number.NaN;
  if (!Number.isFinite(resetsAtMs)) {
    return null;
  }
  const duration = windowDurationMs(window, resetsAtMs);
  if (duration == null || duration <= 0) {
    return null;
  }
  const elapsed = ((duration - (resetsAtMs - now)) / duration) * 100;
  // A reset the daemon has not caught up with yet reads as slightly past the end
  // of the window; clamping keeps that from printing as a phantom overspend.
  return Math.max(0, Math.min(100, elapsed));
}

/**
 * The gap between spend and clock, or null when there is nothing to say —
 * unknown period, unknown usage, or a window tracking its own pace closely
 * enough that an arrow would be noise.
 */
export function windowPace(
  window: UsageWindow,
  usedPct: number | null,
  now: number = Date.now(),
): Pace | null {
  if (usedPct == null) {
    return null;
  }
  const elapsed = elapsedPct(window, now);
  if (elapsed == null) {
    return null;
  }
  const deltaPts = usedPct - elapsed;
  if (deltaPts > OVER_PACE_PTS) {
    return { deltaPts, trend: "over" };
  }
  if (deltaPts >= ON_PACE_PTS) {
    return { deltaPts, trend: "ahead" };
  }
  if (deltaPts <= -ON_PACE_PTS) {
    return { deltaPts, trend: "behind" };
  }
  return null;
}

/**
 * `▲12%` / `▼9%` — the arrow carries the direction, the digits the magnitude.
 *
 * Formatted through `formatPct` rather than glued to a literal `%`, so the sign
 * lands where each language puts it (`12 %` in French, `٪١٢` in Arabic) and
 * matches the percentage it sits beside.
 */
export function formatPaceDelta(pace: Pace, locale: Locale): string {
  return `${pace.trend === "behind" ? "▼" : "▲"}${formatPct(Math.abs(pace.deltaPts), locale)}`;
}

/** Spelled out, for the tooltip and the screen reader: the glyph alone says nothing aloud. */
export function paceLabel(pace: Pace, locale: Locale, messages: Messages): string {
  const magnitude = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
    Math.abs(Math.round(pace.deltaPts)),
  );
  return pace.trend === "behind" ? messages.paceBehind(magnitude) : messages.paceAhead(magnitude);
}
