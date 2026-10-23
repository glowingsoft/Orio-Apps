/**
 * Push notifications (Emergent managed relay). Native only — every API is
 * guarded so the web preview never touches expo-notifications.
 */
import { useEffect, useState } from "react";
import { Platform, Linking } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { apiRegisterPush, apiPushPref } from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { ConfirmModal } from "@/src/components/ConfirmModal";
import { useI18n } from "@/src/i18n";
import { loadNotifications } from "@/src/isExpoGo";

/** Ask permission (if allowed) → native device token → backend. */
export async function registerForPush(): Promise<boolean> {
  const Notifications = loadNotifications();
  if (Platform.OS === "web" || !Notifications) return false;
  try {
    const cur = await Notifications.getPermissionsAsync();
    let status = cur.status;
    if (status !== "granted" && cur.canAskAgain) status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== "granted") return false;
    const tok = await Notifications.getDevicePushTokenAsync();
    await apiRegisterPush(Platform.OS, String(tok.data));
    return true;
  } catch { return false; }
}

function openUrl(router: any, url?: string) {
  if (!url) return;
  if (url.startsWith("http")) Linking.openURL(url);
  else router.push(url as any);
}

/** Mounted once at root: tap handlers, cold start, re-registration, weekly nudge. */
export function PushHost() {
  const router = useRouter();
  const { user } = useAuth();
  const { isRTL } = useI18n();
  const [nudge, setNudge] = useState(false);

  useEffect(() => {
    const Notifications = loadNotifications();
    if (Platform.OS === "web" || !Notifications) return;
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const d: any = r.notification.request.content.data || {};
      openUrl(router, d.deeplink || d.action_url);
    });
    Notifications.getLastNotificationResponseAsync().then((r) => {
      if (!r) return;
      const d: any = r.notification.request.content.data || {};
      openUrl(router, d.deeplink || d.action_url);
    });
    return () => sub.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const Notifications = loadNotifications();
    if (Platform.OS === "web" || !Notifications || !user?.id) return;
    (async () => {
      const pref = await apiPushPref().catch(() => ({ enabled: true }));
      if (!pref.enabled) return;
      await registerForPush();
      const { status, canAskAgain } = await Notifications.getPermissionsAsync();
      if (status !== "denied" || canAskAgain) return;
      const last = await AsyncStorage.getItem("pushNudgeAt");
      if (last && Date.now() - Number(last) <= 7 * 24 * 3600 * 1000) return;
      setNudge(true);
    })();
  }, [user?.id]);

  const stamp = () => AsyncStorage.setItem("pushNudgeAt", String(Date.now())).catch(() => {});
  if (!nudge) return null;
  return (
    <ConfirmModal
      visible
      title={isRTL ? "تفعيل الإشعارات" : "Turn on notifications"}
      body={isRTL ? "فعّل الإشعارات لتصلك الرسائل والدعوات فوراً." : "Enable notifications to get messages and invites instantly."}
      primaryLabel={isRTL ? "فتح الإعدادات" : "Open Settings"}
      secondaryLabel={isRTL ? "لاحقاً" : "Later"}
      onPrimary={() => { stamp(); setNudge(false); Linking.openSettings(); }}
      onSecondary={() => { stamp(); setNudge(false); }}
      onDismiss={() => { stamp(); setNudge(false); }}
    />
  );
}
