/**
 * The sidebar meter's row model and its poll bookkeeping.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { messagesFor } from "../shared/i18n/messages";
import type { Selection } from "../shared/selection/contract";
import type { ProviderUsage, UsageSnapshot } from "../shared/usage/contract";
import { DISABLED_RECHECK_MS, countFailedPolls, shouldPoll } from "../shared/usage/errors";
import { groupKey, rowTiming, toGroups } from "../shared/usage/meter";

const en = messagesFor("en");
const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();

function provider(providerId: string, accountLabel: string | null, windows: ProviderUsage["windows"]): ProviderUsage {
  return {
    providerId,
    displayName: providerId === "claude" ? "Claude" : providerId,
    status: "available",
    planLabel: null,
    accountLabel,
    windows,
    balances: [],
    details: [],
  };
}

const snapshot = (providers: ProviderUsage[]): UsageSnapshot => ({ fetchedAt: null, source: "sdk", providers });
const selection = (keys: string[], displayAs: Selection["displayAs"] = "used"): Selection => ({
  keys,
  configured: true,
  showPace: true,
  displayAs,
});

describe("toGroups", () => {
  const data = snapshot([
    provider("claude", "a@x", [
      { id: "five_hour", label: "Session", usedPct: 40 },
      { id: "weekly", label: "Weekly", usedPct: 96 },
    ]),
    { ...provider("claude-2", "b@x", [{ id: "weekly", label: "Weekly", usedPct: 10 }]), displayName: "Claude" },
  ]);

  it("groups by provider and account, in pinned order", () => {
    const groups = toGroups(data, selection(["claude:weekly", "claude:five_hour", "claude-2:weekly"]), en);
    assert.deepEqual(
      groups.map((group) => [group.provider, group.account, group.rows.map((row) => row.window.id)]),
      [
        ["Claude", "a@x", ["weekly", "five_hour"]],
        ["Claude", "b@x", ["weekly"]],
      ],
    );
    // Same name, different account: two headings that fold apart.
    assert.notEqual(groupKey(groups[0]!), groupKey(groups[1]!));
  });

  it("splits a group again when pins interleave providers", () => {
    const groups = toGroups(data, selection(["claude:weekly", "claude-2:weekly", "claude:five_hour"]), en);
    assert.equal(groups.length, 3);
  });

  it("prints remaining but keeps tone on used", () => {
    const [group] = toGroups(data, selection(["claude:weekly"], "remaining"), en);
    const row = group!.rows[0]!;
    assert.equal(row.usedPct, 96);
    assert.equal(row.displayPct, 4);
    assert.equal(row.tone, "danger");
  });

  it("is empty when nothing pinned resolves", () => {
    assert.deepEqual(toGroups(data, selection(["gone:1"]), en), []);
  });
});

describe("rowTiming", () => {
  const row = (window: ProviderUsage["windows"][number]) =>
    toGroups(snapshot([provider("p", null, [window])]), selection([`p:${window.id}`]), en)[0]!.rows[0]!;

  it("counts down to the reset, with the clock time as the alternate", () => {
    const timing = rowTiming(row({ id: "w", label: "W", usedPct: 20, resetsAt: inMs(2 * 3_600_000) }), en, "en");
    assert.equal(timing.atRisk, false);
    assert.match(timing.text ?? "", /^resets in/);
    assert.match(timing.alternate ?? "", /^resets at/);
  });

  it("says when a window runs out before its reset", () => {
    const timing = rowTiming(
      row({ id: "w", label: "W", usedPct: 80, resetsAt: inMs(5 * 3_600_000), runsOutAt: inMs(3_600_000), shortfallPct: 20 }),
      en,
      "en",
    );
    assert.equal(timing.atRisk, true);
    assert.match(timing.text ?? "", /^runs out in/);
  });
});

describe("countFailedPolls", () => {
  it("counts errors since the last poll that landed", () => {
    let step = countFailedPolls(null, { dataUpdatedAt: 0, errorUpdateCount: 0 });
    assert.equal(step.failures, 0);
    step = countFailedPolls(step.tally, { dataUpdatedAt: 100, errorUpdateCount: 0 });
    step = countFailedPolls(step.tally, { dataUpdatedAt: 100, errorUpdateCount: 1 });
    assert.equal(step.failures, 1);
    step = countFailedPolls(step.tally, { dataUpdatedAt: 100, errorUpdateCount: 2 });
    assert.equal(step.failures, 2);
    step = countFailedPolls(step.tally, { dataUpdatedAt: 200, errorUpdateCount: 2 });
    assert.equal(step.failures, 0);
  });

  it("counts every error when nothing has landed yet", () => {
    assert.equal(countFailedPolls(null, { dataUpdatedAt: 0, errorUpdateCount: 3 }).failures, 3);
  });

  it("takes a populated cache seen for the first time as fresh", () => {
    assert.equal(countFailedPolls(null, { dataUpdatedAt: 100, errorUpdateCount: 3 }).failures, 0);
  });
});

describe("shouldPoll", () => {
  const off = { status: "error", error: new Error("Usage is off on this host"), errorUpdatedAt: 1_000 };

  it("polls by default and skips while hidden", () => {
    assert.equal(shouldPoll(undefined, false, 0), true);
    assert.equal(shouldPoll({ status: "success", error: null, errorUpdatedAt: 0 }, true, 0), false);
  });

  it("keeps polling through an ordinary failure", () => {
    assert.equal(shouldPoll({ status: "error", error: new Error("boom"), errorUpdatedAt: 1_000 }, false, 2_000), true);
  });

  it("re-checks a host with usage off only every few minutes", () => {
    assert.equal(shouldPoll(off, false, 1_000 + DISABLED_RECHECK_MS - 1), false);
    assert.equal(shouldPoll(off, false, 1_000 + DISABLED_RECHECK_MS), true);
  });
});
