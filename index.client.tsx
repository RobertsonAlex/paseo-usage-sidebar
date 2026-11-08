import type { PluginCleanup } from "@getpaseo/plugin";
import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { titles } from "./client/i18n/titles";
import { startSidebarMeter } from "./client/ui/sidebar-meter";
import { UsageSurface } from "./client/ui/usage-surface";
import { releaseAccounts } from "./client/usage/claims";

const SURFACE_ID = "usage";

/** Renders with the item's id, so the meter's `plugin-sidebar-usage-sidebar-usage` anchor still matches. */
function SidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="Gauge"
      active={currentScreen?.screenId === SURFACE_ID}
      onPress={() => openScreen({ screenId: SURFACE_ID })}
    />
  );
}

/**
 * Client entry: the screen, its sidebar row, the Command Center shortcut, and
 * the sidebar meter.
 *
 * The labels Paseo renders are message references, so the app follows a
 * language change itself and nothing here re-registers.
 */
export default function contribute(client: PluginClientContext): PluginCleanup {
  const title = titles.message("title");
  const removers = [
    client.addScreen({ id: SURFACE_ID, title, Component: UsageSurface }),
    client.addSidebarHeaderItem({ id: SURFACE_ID, title, Component: SidebarItem }),
    client.addCommandCenterItem({
      id: "open-usage",
      title,
      // Searchable in English regardless of the display language: the command
      // center is typed into, and muscle memory outlives a language switch.
      keywords: ["usage", "quota", "plan", "limit", "tokens"],
      icon: "Gauge",
      context: "global",
      onSelect: (context) => {
        context.openScreen({ screenId: SURFACE_ID });
      },
    }),
  ];

  const stopMeter = startSidebarMeter(client, SURFACE_ID);

  // The removers are idempotent, so running them here is safe even though Paseo
  // also drops outstanding registrations after this cleanup returns.
  return () => {
    stopMeter();
    for (const remove of removers) {
      remove();
    }
    // Last, and unconditional: another host's copy is waiting on these.
    releaseAccounts();
  };
}
