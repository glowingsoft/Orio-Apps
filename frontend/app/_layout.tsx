// Iter-91 — MUST be the FIRST import so I18nManager.forceRTL runs before any
// screen module calls StyleSheet.create (RN Web compiles styles at module load).
import "@/src/rtl-bootstrap";

import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import { LogBox, Platform, StatusBar, View } from "react-native";
import { PushHost } from "@/src/push/PushHost";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useEffect } from "react";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { queryClient } from "@/src/query-client";
import { AuthProvider, useAuth } from "@/src/auth-context";
import { I18nProvider } from "@/src/i18n";
import { colors } from "@/src/theme";
import { RoomSessionProvider } from "@/src/room/RoomSession";
import { CallProvider } from "@/src/calls/CallProvider";
import { RoomLockHost } from "@/src/room/RoomLockGate";
import { PresenceHeartbeat } from "@/src/components/PresenceHeartbeat";
import { ImageCropperHost } from "@/src/media/ImageCropper";
import { FloatingMiniRoom } from "@/src/room/FloatingMiniRoom";
import { ToastProvider } from "@/src/components/Toast";
import { NetworkWatcher } from "@/src/components/NetworkWatcher";
import { DeletionCancelledNotice } from "@/src/components/DeletionCancelledNotice";
import { LuxuryGiftBanner } from "@/src/components/LuxuryGiftBanner";
import { RealtimeHost } from "@/src/components/RealtimeHost";
import { ImageViewerProvider } from "@/src/components/ImageViewer";
import { ConfirmHost } from "@/src/components/ConfirmHost";
import { LevelUpWatcher } from "@/src/levels/LevelUpWatcher";
import { BanScreen } from "@/src/components/BanScreen";
import { installDiagnostics, setDiagRoute } from "@/src/diagnostics";
import { loadNotifications } from "@/src/isExpoGo";

LogBox.ignoreAllLogs(true);
installDiagnostics();

// Push — foreground display + Android channel (module scope, native only).
// loadNotifications() returns null in Expo Go, since expo-notifications
// itself cannot be touched there (it would crash on ExpoTopicSubscriptionModule).
const Notifications = loadNotifications();
if (Notifications && Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}
if (Notifications && Platform.OS === "android") {
  Notifications.setNotificationChannelAsync("default", {
    name: "Default",
    importance: Notifications.AndroidImportance.MAX,
  });
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    setDiagRoute(segments.join("/"));
    if (loading) return;
    const inAuth = segments[0] === "(auth)";
    const inTabs = segments[0] === "(tabs)";
    const inAdmin = segments[0] === "admin";
    const inProfileCompletion = segments[0] === "profile-completion";
    if (!user && !inAuth && !inAdmin) {
      router.replace("/(auth)/login");
    } else if (
      user &&
      !user.profile_completed &&
      !inProfileCompletion &&
      !inAdmin
    ) {
      // Iter-44 — gate every post-login screen behind profile completion.
      router.replace("/profile-completion");
    } else if (
      user &&
      user.profile_completed &&
      !inTabs &&
      ![
        "room",
        "chat",
        "create-room",
        "game",
        "games",
        "settings",
        "delete-account",
        "language",
        "vip",
        "vip-guide",
        "friendship",
        "cp",
        "rankings",
        "families",
        "invite",
        "my-rooms",
        "managed-rooms",
        "visitors",
        "user",
        "tasks",
        "edit-profile",
        "earnings",
        "agency",
        "withdraw",
        "withdrawals",
        "payout-methods",
        "recharge-agent",
        "admin",
        "profile-completion",
        "search",
        "report",
        "room-ranking",
        "global-ranking",
        "level",
        "level-rules",
        "bag",
        "store",
        "medal",
        "notifications",
        "support",
        "activities",
        "activity-apply",
        "friend-requests",
        "connections",
        "accounts",
        "create-post",
        "post",
        "user-posts",
      ].includes(segments[0] as string)
    ) {
      router.replace("/(tabs)/home");
    }
  }, [user, loading, segments, router]);

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <GestureHandlerRootView
          style={{ flex: 1, backgroundColor: colors.surface }}
        >
          <QueryClientProvider client={queryClient}>
            <KeyboardProvider>
              <I18nProvider>
                <AuthProvider>
                  <RoomSessionProvider>
                    <ToastProvider>
                      <ImageViewerProvider>
                        <StatusBar
                          barStyle="dark-content"
                          backgroundColor={colors.surface}
                        />
                        <AuthGate>
                          <CallProvider>
                            <View style={{ flex: 1 }}>
                              <Stack
                                screenOptions={{
                                  headerShown: false,
                                  contentStyle: {
                                    backgroundColor: colors.surface,
                                  },
                                }}
                              />
                              <FloatingMiniRoom />
                              <LevelUpWatcher />
                              <BanScreen />
                              <PresenceHeartbeat />
                              <RealtimeHost />
                              <NetworkWatcher />
                              <DeletionCancelledNotice />
                              <LuxuryGiftBanner />
                              <ImageCropperHost />
                              <RoomLockHost />
                              <PushHost />
                              <ConfirmHost />
                            </View>
                          </CallProvider>
                        </AuthGate>
                      </ImageViewerProvider>
                    </ToastProvider>
                  </RoomSessionProvider>
                </AuthProvider>
              </I18nProvider>
            </KeyboardProvider>
          </QueryClientProvider>
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
