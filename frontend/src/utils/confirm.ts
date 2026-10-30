import { Alert, Platform } from "react-native";

type Btn = { text: string; onPress?: () => void; style?: "default" | "cancel" | "destructive" };

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  destructive?: boolean;
};
export type ConfirmRequest = ConfirmOptions & { resolve: (ok: boolean) => void };

let host: ((req: ConfirmRequest) => void) | null = null;
export function registerConfirmHost(fn: (req: ConfirmRequest) => void) {
  host = fn;
  return () => {
    if (host === fn) host = null;
  };
}

function platformConfirm(opts: ConfirmOptions): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(typeof window !== "undefined" && window.confirm(`${opts.title}\n\n${opts.message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(opts.title, opts.message, [
      { text: opts.cancelText, style: "cancel", onPress: () => resolve(false) },
      { text: opts.confirmText, style: opts.destructive ? "destructive" : "default", onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

/** Yes/no confirmation; resolves true when confirmed. Uses the in-app modal on web and native. */
export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  const h = host;
  if (h) return new Promise((resolve) => h({ ...opts, resolve }));
  return platformConfirm(opts);
}

/**
 * Cross-platform confirm dialog (Alert-style buttons).
 * The confirm/cancel labels come from the first destructive/non-cancel button and the cancel button.
 */
export function confirmDialog(title: string, message: string, buttons: Btn[]): void {
  const cancelBtn = buttons.find((b) => b.style === "cancel");
  const actionBtn = buttons.find((b) => b.style !== "cancel");

  if (host) {
    confirmAction({
      title,
      message,
      confirmText: actionBtn?.text ?? "OK",
      cancelText: cancelBtn?.text ?? "Cancel",
      destructive: actionBtn?.style === "destructive",
    }).then((ok) => (ok ? actionBtn?.onPress?.() : cancelBtn?.onPress?.()));
    return;
  }
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
