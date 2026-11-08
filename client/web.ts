import type { View } from "react-native";

/** A hover tooltip on web; native has no hover, so this does nothing there. */
export function setWebTitle(view: View | null, label: string | null, platform: string): HTMLElement | null {
  if (platform !== "web") return null;
  const node = view as unknown as HTMLElement | null;
  if (!node || typeof node.setAttribute !== "function") return null;
  if (label === null) node.removeAttribute("title");
  else node.setAttribute("title", label);
  return node;
}

/** Native has accessibilityLabel; web also gets a hover tooltip. */
export function updatePinButtonMetadata(view: View | null, label: string, platform: string): void {
  const node = setWebTitle(view, label, platform);
  // Keyboard focus uses the button's surface tint instead of a browser outline.
  if (node) node.style.outlineStyle = "none";
}
