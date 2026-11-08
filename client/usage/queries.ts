import { useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { readSelection, type Selection } from "../../shared/selection/contract";
import { listUsage, type UsageSnapshot } from "../../shared/usage/contract";
import { shouldPoll } from "../../shared/usage/errors";
import { publishSelection } from "../selection/store";
import { claimAccounts } from "./claims";

const REFRESH_INTERVAL_MS = 60_000;
const STALE_TIME_MS = 30_000;

export const SNAPSHOT_KEY = ["usage-sidebar", "snapshot"] as const;
export const SELECTION_KEY = ["usage-sidebar", "selection"] as const;

/**
 * One poll for the sidebar meter and the panel together. The sidebar item and
 * the screen share this installation's query cache, but a `refetchInterval` per
 * observer would run one timer each and poll twice a minute with both mounted;
 * this counts mounted readers instead and runs a single timer while any is.
 */
let readers = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function tick(queryClient: QueryClient): void {
  const hidden = typeof document !== "undefined" && document.hidden === true;
  if (shouldPoll(queryClient.getQueryState(SNAPSHOT_KEY), hidden, Date.now())) {
    void queryClient.refetchQueries({ queryKey: SNAPSHOT_KEY, type: "active" });
  }
}

function useSharedPoll(queryClient: QueryClient): void {
  useEffect(() => {
    readers += 1;
    timer ??= setInterval(() => tick(queryClient), REFRESH_INTERVAL_MS);
    return () => {
      readers -= 1;
      if (readers === 0 && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, [queryClient]);
}

/**
 * The raw snapshot, every account in it. A poll that lands renews this copy's
 * claims (client/usage/claims.ts); readers then ask `heldAccounts` what they may
 * paint, which is what lets a claim lapse through failed polls.
 */
export function useUsageSnapshot() {
  const fetchUsage = useRpc(listUsage);
  const queryClient = useQueryClient();
  useSharedPoll(queryClient);
  return useQuery<UsageSnapshot>({
    queryKey: SNAPSHOT_KEY,
    queryFn: async () => {
      const snapshot = await fetchUsage({});
      claimAccounts(snapshot);
      return snapshot;
    },
    staleTime: STALE_TIME_MS,
  });
}

/** The persisted pins and display choices, published so every reader sees an edit at once. */
export function useSelectionQuery() {
  const fetchSelection = useRpc(readSelection);
  return useQuery<Selection>({
    queryKey: SELECTION_KEY,
    queryFn: async () => {
      const selection = await fetchSelection({});
      publishSelection(selection);
      return selection;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}
