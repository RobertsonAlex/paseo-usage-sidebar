import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  applySelectionPatch,
  SelectionSchema,
  type Selection,
  type SelectionPatch,
} from "../../shared/selection/contract";

/**
 * The pin list is kept in the plugin's own state file. That predates Paseo 0.8's
 * `defineSettings`; moving to it would need a migration for the files already
 * on disk. It holds provider and window ids only: no tokens, no usage numbers,
 * nothing account-identifying.
 *
 * Written to XDG state rather than into $PASEO_HOME so it never collides with
 * daemon-owned files, and replaced atomically so a crash mid-write cannot leave
 * a truncated file behind.
 */
const EMPTY: Selection = { keys: [], configured: false, showPace: true, displayAs: "used" };

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

/** Applies the patch to what is on disk; see `applySelectionPatch` for the merge rule. */
export function writeSelectionState(patch: SelectionPatch): Selection {
  const next = applySelectionPatch(readSelectionState(), patch);
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
    `[usage-sidebar] Saved: pinned ${next.keys.join(", ") || "(none)"}; pace ${next.showPace ? "on" : "off"}; showing ${next.displayAs}`,
  );
  return next;
}
