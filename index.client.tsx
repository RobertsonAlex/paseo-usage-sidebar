import type { PluginCleanup } from "@getpaseo/plugin";
import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { titles } from "./client/i18n/titles";
import { SidebarMeter } from "./client/ui/sidebar-meter";
import { UsageSurface } from "./client/ui/usage-surface";

const SURFACE_ID = "usage";

/** The row that opens the screen, with the meter under it; the item moves and hides as one block. */
function SidebarItem({ theme, layout, host, currentScreen, openScreen }: PluginSidebarItemProps) {
  const open = () => openScreen({ screenId: SURFACE_ID });
  return (
    <>
      <SidebarRow icon="Gauge" active={currentScreen?.screenId === SURFACE_ID} onPress={open} />
      <SidebarMeter theme={theme} layout={layout} hostId={host.id} onOpen={open} />
    </>
  );
}

/**
 * Client entry: the screen, its sidebar row and meter, and the Command Center
 * shortcut.
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

  // The removers are idempotent, so running them here is safe even though Paseo
  // also drops outstanding registrations after this cleanup returns.
  return () => {
    for (const remove of removers) {
      remove();
    }
  };
}
