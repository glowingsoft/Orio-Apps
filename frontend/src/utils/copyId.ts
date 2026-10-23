import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/**
 * Copy an ORIO numeric ID to the clipboard. Triggers a light haptic on
 * native platforms. Silently no-ops if clipboard isn't available.
 * Consumers own the "Copied!" toast/feedback state.
 */
export async function copyIdToClipboard(id: string | number | null | undefined): Promise<boolean> {
  const v = id == null ? "" : String(id);
  if (!v) return false;
  try {
    await Clipboard.setStringAsync(v);
    if (Platform.OS !== "web") {
      try { await Haptics.selectionAsync(); } catch {}
    }
    return true;
  } catch {
    return false;
  }
}
