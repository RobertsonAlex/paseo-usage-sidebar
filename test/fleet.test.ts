/**
 * Merging every reachable host's usage into one reading per account.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProviderUsage, UsageSnapshot } from "../shared/usage/contract";
import { mergeFleet, readHost, type HostReading } from "../shared/usage/fleet";

function provider(
  providerId: string,
  accountLabel: string | null,
  status: ProviderUsage["status"] = "available",
  usedPct = 10,
): ProviderUsage {
  return {
    providerId,
    displayName: accountLabel ? `Claude (${accountLabel})` : providerId,
    status,
    planLabel: null,
    accountLabel,
    windows: status === "available" ? [{ id: "weekly", label: "Weekly", usedPct }] : [],
    balances: [],
    details: [],
    error: status === "error" ? "Rate limited" : null,
  };
}

const snapshot = (...providers: ProviderUsage[]): UsageSnapshot => ({ fetchedAt: null, source: "sdk", providers });
const host = (serverId: string, ...providers: ProviderUsage[]): HostReading => ({
  serverId,
  snapshot: snapshot(...providers),
});
const down = (serverId: string): HostReading => ({ serverId, snapshot: null });

const shown = (merged: UsageSnapshot) =>
  merged.providers.map((p) => [p.accountLabel, p.status, p.windows[0]?.usedPct ?? null]);

describe("mergeFleet", () => {
  it("shows one block for an account every host reports", () => {
    const merged = mergeFleet(
      [host("mac", provider("claude", "a@x", "available", 11)), host("vm", provider("claude", "a@x", "available", 12))],
      "mac",
    );
    assert.deepEqual(shown(merged), [["a@x", "available", 11]]);
  });

  it("prefers the rendered host when both readings work", () => {
    const merged = mergeFleet(
      [host("mac", provider("claude", "a@x", "available", 11)), host("vm", provider("claude", "a@x", "available", 12))],
      "vm",
    );
    assert.deepEqual(shown(merged), [["a@x", "available", 12]]);
  });

  it("takes a working reading from another host when the rendered host's errors", () => {
    const merged = mergeFleet(
      [host("mac", provider("claude", "a@x", "error")), host("vm", provider("claude", "a@x", "available", 35))],
      "mac",
    );
    assert.deepEqual(shown(merged), [["a@x", "available", 35]]);
  });

  it("keeps the error when no host has a working reading", () => {
    const merged = mergeFleet([host("mac", provider("claude", "a@x", "error"))], "mac");
    assert.deepEqual(shown(merged), [["a@x", "error", null]]);
  });

  it("skips hosts that could not be read at all", () => {
    const merged = mergeFleet([down("mac"), host("vm", provider("claude", "a@x", "available", 35))], "mac");
    assert.deepEqual(shown(merged), [["a@x", "available", 35]]);
  });

  it("keeps different accounts apart, in host order", () => {
    const merged = mergeFleet(
      [host("main", provider("claude", "main@x")), host("burt", provider("claude", "burt@x"))],
      "main",
    );
    assert.deepEqual(
      merged.providers.map((p) => p.accountLabel),
      ["main@x", "burt@x"],
    );
  });

  it("never folds rows whose account is unknown", () => {
    const merged = mergeFleet([host("mac", provider("codex", null)), host("vm", provider("codex", null))], "mac");
    assert.equal(merged.providers.length, 2);
  });

  it("is empty when no host answered", () => {
    assert.deepEqual(mergeFleet([down("mac")], "mac").providers, []);
  });
});

describe("readHost", () => {
  it("normalizes the daemon payload and reads the account off the row name", async () => {
    const reading = await readHost("vm", async () => ({
      providers: [{ providerId: "claude", displayName: "Claude (a@x)", status: "available", windows: [] }],
    }));
    assert.equal(reading.snapshot?.providers[0]?.accountLabel, "a@x");
  });

  it("turns a failed read into a host with no snapshot", async () => {
    const reading = await readHost("vm", async () => {
      throw new Error("Connection lost");
    });
    assert.deepEqual(reading, { serverId: "vm", snapshot: null });
  });
});
