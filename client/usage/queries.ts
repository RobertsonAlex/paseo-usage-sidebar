import { getPaseoClient, useHosts, useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { readSelection, type Selection } from "../../shared/selection/contract";
import { listUsage, type UsageSnapshot } from "../../shared/usage/contract";
import { shouldPoll } from "../../shared/usage/errors";
import { mergeFleet, readHost } from "../../shared/usage/fleet";
import { seedSelection } from "../selection/store";

const REFRESH_INTERVAL_MS = 60_000;
const STALE_TIME_MS = 30_000;

export const SNAPSHOT_KEY = ["usage-sidebar", "snapshot"] as const;
export const FLEET_KEY = ["usage-sidebar", "fleet"] as const;
export const SELECTION_KEY = ["usage-sidebar", "selection"] as const;

/**
 * One poll per query, however many readers it has. A `refetchInterval` per
 * observer would run one timer each; this counts mounted readers per key
 * instead and runs a single timer while any is mounted.
 */
const polls = new Map<string, { readers: number; timer: ReturnType<typeof setInterval> }>();

function tick(queryClient: QueryClient, key: readonly unknown[]): void {
  const hidden = typeof document !== "undefined" && document.hidden === true;
  if (shouldPoll(queryClient.getQueryState(key), hidden, Date.now())) {
    void queryClient.refetchQueries({ queryKey: key, type: "active" });
  }
}

function useSharedPoll(queryClient: QueryClient, key: readonly unknown[]): void {
  const id = JSON.stringify(key);
  useEffect(() => {
    const poll = polls.get(id) ?? {
      readers: 0,
      timer: setInterval(() => tick(queryClient, key), REFRESH_INTERVAL_MS),
    };
    poll.readers += 1;
    polls.set(id, poll);
    return () => {
      poll.readers -= 1;
      if (poll.readers === 0) {
        clearInterval(poll.timer);
        polls.delete(id);
      }
    };
    // `key` is tracked by its serialized id; the array itself is new each render.
  }, [queryClient, id]);
}

/** This host's snapshot, through this plugin's server half: what the panel shows. */
export function useUsageSnapshot() {
  const fetchUsage = useRpc(listUsage);
  const queryClient = useQueryClient();
  useSharedPoll(queryClient, SNAPSHOT_KEY);
  return useQuery<UsageSnapshot>({
    queryKey: SNAPSHOT_KEY,
    queryFn: () => fetchUsage({}),
    staleTime: STALE_TIME_MS,
  });
}

/**
 * Every online host's usage, one block per account: what the sidebar meter
 * shows. The rendered host is asked first, so its reading wins a tie.
 *
 * Fails only when no host answered, so the meter's stale fade means what it
 * did before: nothing on screen is current. A host that is merely asleep or
 * rate-limited is skipped, and the account comes from whoever else has it.
 */
export function useFleetSnapshot(renderedServerId: string) {
  const queryClient = useQueryClient();
  const online = useHosts()
    .filter((host) => host.status === "online")
    .map((host) => host.serverId);
  const key = [...FLEET_KEY, renderedServerId, ...online] as const;
  useSharedPoll(queryClient, key);
  return useQuery<UsageSnapshot>({
    queryKey: key,
    queryFn: async () => {
      const readings = await Promise.all(
        online.map((serverId) => readHost(serverId, () => getPaseoClient(serverId).providers.listUsage())),
      );
      if (readings.length > 0 && readings.every((reading) => reading.snapshot === null)) {
        throw new Error("No host returned usage");
      }
      return mergeFleet(readings, renderedServerId);
    },
    staleTime: STALE_TIME_MS,
    // A host joining or leaving changes the key; keep the bars up meanwhile.
    placeholderData: (previous) => previous,
  });
}

/**
 * This host's saved pins and display choices. They seed the app-wide store
 * (client/selection/store.ts) while it has nothing of its own.
 */
export function useSelectionQuery() {
  const fetchSelection = useRpc(readSelection);
  return useQuery<Selection>({
    queryKey: SELECTION_KEY,
    queryFn: async () => {
      const selection = await fetchSelection({});
      seedSelection(selection);
      return selection;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}
