import assert from "node:assert/strict";
import { messagesFor } from "../i18n/messages";
import type { UsageWindow } from "./contract";
import { elapsedPct, formatPaceDelta, paceLabel, windowPace } from "./pace";

/**
 * Self-check for the one piece of this plugin with arithmetic in it.
 *
 * `npx tsx shared/usage/pace.check.ts` — no runner, no fixtures; the repo's
 * other check is `npm run typecheck`, and types alone cannot catch a window
 * start reconstructed a day off or a threshold that steps on the wrong side.
 */

const NOW = new Date("2026-03-15T12:00:00Z").getTime();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function window(id: string, resetsInMs: number): UsageWindow {
  return { id, label: id, resetsAt: new Date(NOW + resetsInMs).toISOString() };
}

// Elapsed share, reconstructed backwards from the reset instant.
assert.equal(elapsedPct(window("five_hour", 5 * HOUR), NOW), 0, "a just-started 5h window is 0% elapsed");
assert.equal(elapsedPct(window("five_hour", 2 * HOUR), NOW), 60, "3h into a 5h window is 60% elapsed");
assert.equal(elapsedPct(window("weekly", 3.5 * DAY), NOW), 50, "3.5d left of 7d is halfway");
assert.equal(elapsedPct(window("weekly_model_fable", 3.5 * DAY), NOW), 50, "model-scoped weeklies are weeks too");
assert.equal(elapsedPct(window("daily", 6 * HOUR), NOW), 75, "6h left of a day is 75% elapsed");

// Unknowable periods stay unknowable rather than being guessed.
assert.equal(elapsedPct(window("coding_limit_abc", 2 * HOUR), NOW), null, "unknown id yields no pace");
assert.equal(elapsedPct({ id: "weekly", label: "Weekly" }, NOW), null, "a window with no reset yields no pace");
assert.equal(
  elapsedPct({ id: "weekly", label: "Weekly", resetsAt: "not-a-date" }, NOW),
  null,
  "an unparseable reset yields no pace",
);

// A reset the daemon has not caught up with clamps instead of overshooting.
assert.equal(elapsedPct(window("five_hour", -HOUR), NOW), 100, "an overdue reset clamps to 100");
assert.equal(elapsedPct(window("five_hour", 6 * HOUR), NOW), 0, "a reset beyond the period clamps to 0");

// Calendar months, not a flat 30 days: March resets from a 28-day February.
const march = elapsedPct({ id: "monthly", label: "Monthly", resetsAt: "2026-03-01T00:00:00Z" }, Date.parse("2026-02-15T00:00:00Z"));
assert.ok(march != null && Math.abs(march - 50) < 0.1, `Feb 15 is halfway through a 28-day month, got ${march}`);
// The 31st does not roll forward into the following month (naive setMonth does).
const marchFrom31 = elapsedPct({ id: "monthly", label: "Monthly", resetsAt: "2026-03-31T00:00:00Z" }, Date.parse("2026-03-16T00:00:00Z"));
assert.ok(marchFrom31 != null && marchFrom31 > 40 && marchFrom31 < 60, `Mar 31 reset spans Feb 28 -> Mar 31, got ${marchFrom31}`);

// The thresholds: green below pace, orange 1-5 points over, red past 5.
const half = window("five_hour", 2.5 * HOUR); // 50% elapsed
assert.equal(windowPace(half, 50, NOW), null, "dead on pace shows nothing");
assert.equal(windowPace(half, 50.9, NOW), null, "under a point over is still noise");
assert.equal(windowPace(half, 49.5, NOW), null, "under a point below is still noise");
assert.equal(windowPace(half, 51, NOW)?.trend, "ahead", "+1 point is the first orange reading");
assert.equal(windowPace(half, 55, NOW)?.trend, "ahead", "+5 points is still orange");
assert.equal(windowPace(half, 55.1, NOW)?.trend, "over", "past +5 points goes red");
assert.equal(windowPace(half, 49, NOW)?.trend, "behind", "-1 point is the first green reading");
assert.equal(windowPace(half, null, NOW), null, "no usage figure, no pace");
assert.equal(windowPace(window("coding_limit_abc", HOUR), 90, NOW), null, "no period, no pace");

// Rendering: the arrow carries direction, the digits an unsigned magnitude.
const messages = messagesFor("en");
const ahead = windowPace(half, 62, NOW);
const behind = windowPace(half, 38, NOW);
assert.ok(ahead && behind);
assert.equal(formatPaceDelta(ahead, "en"), "▲12%");
assert.equal(formatPaceDelta(behind, "en"), "▼12%");
assert.equal(paceLabel(ahead, "en", messages), "12 points ahead of pace");
assert.equal(paceLabel(behind, "en", messages), "12 points behind pace");

console.log("pace.ts: all checks passed");
