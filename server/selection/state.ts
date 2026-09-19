import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SelectionSchema, type Selection } from "../../shared/selection/contract";

/**
 * Paseo 0.7 has no plugin settings storage — `defineSettings` arrives in 0.8 —
 * so the pin list is kept in the plugin's own state file. It holds provider and
 * window ids only: no tokens, no usage numbers, nothing account-identifying.
 *
 * Written to XDG state rather than into $PASEO_HOME so it never collides with
 * daemon-owned files, and replaced atomically so a crash mid-write cannot leave
 * a truncated file behind.
 */
const EMPTY: Selection = { keys: [], configured: false, showPace: true };

function stateFile(): string {
  const base = process.env.XDG_STATE_HOME?.trim() || join(homedir(), ".local", "state");
  return join(base, "paseo-usage-sidebar", "selection.json");
}

export function readSelectionState(): Selection {
  try {
    const parsed = SelectionSchema.safeParse(JSON.parse(readFileSync(stateFile(), "utf8")));
    return parsed.success ? parsed.data : EMPTY;
  } catch {
    return EMPTY;
  }
}

/**
 * Merges rather than replaces: the two settings in this file are written by
 * different controls, and an absent field means "leave it alone", not "clear
 * it". Pinning stays the only thing that marks the selection configured — the
 * pace toggle is a display preference and has no business promoting the default
 * pin set into a frozen one.
 */
export function writeSelectionState({ keys, showPace }: { keys?: string[]; showPace?: boolean }): Selection {
  const current = readSelectionState();
  const next: Selection = {
    keys: keys ? [...new Set(keys.filter((key) => typeof key === "string" && key.length > 0))] : current.keys,
    configured: keys ? true : current.configured,
    showPace: showPace ?? current.showPace,
  };
  const path = stateFile();
  try {
    mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
    renameSync(temporary, path);
  } catch (error) {
    // Swallowing this used to make the panel lie: the meter repainted in the new
    // order, the write had failed, and the arrangement snapped back at the next
    // reload with nothing to explain it. Fail the RPC instead.
    console.error("[usage-sidebar] Could not persist the sidebar selection", error);
    throw new Error(`Could not persist the sidebar selection: ${error instanceof Error ? error.message : error}`);
  }
  console.log(
    `[usage-sidebar] Saved: pinned ${next.keys.join(", ") || "(none)"}; pace ${next.showPace ? "on" : "off"}`,
  );
  return next;
}
