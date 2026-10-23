import { Alert, Platform } from "react-native";

type Btn = { text: string; onPress?: () => void; style?: "default" | "cancel" | "destructive" };

/**
 * Cross-platform confirm dialog.
 *   • Native: uses React Native's Alert.alert.
 *   • Web:    falls back to window.confirm (since Alert.alert doesn't render on RN-Web).
 * The confirm/cancel labels come from the first destructive/non-cancel button.
 */
export function confirmDialog(title: string, message: string, buttons: Btn[]): void {
  const cancelBtn = buttons.find((b) => b.style === "cancel");
  const actionBtn = buttons.find((b) => b.style !== "cancel");

  if (Platform.OS === "web") {
    try {
      // eslint-disable-next-line no-alert
      const ok = typeof window !== "undefined" && window.confirm(`${title}\n\n${message}`);
      if (ok) actionBtn?.onPress?.();
      else cancelBtn?.onPress?.();
      return;
    } catch {
      // fall through to Alert as last resort
    }
  }
  Alert.alert(title, message, buttons as any);
}
