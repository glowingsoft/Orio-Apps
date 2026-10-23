import { Tabs } from "expo-router";
import Icon from "@react-native-vector-icons/ionicons";
import { colors } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { useQuery } from "@tanstack/react-query";
import { apiUnreadCount, fmtCount } from "@/src/api";
import { pollMs, useRealtimeConnected } from "@/src/realtime";

export default function TabsLayout() {
  const { t } = useI18n();
  const live = useRealtimeConnected();
  // Iter-135 — real unread DM count on the Messages tab (capped "9+").
  // Pushed over the realtime socket; polls only while it is down (+ slow safety net).
  const { data: unread } = useQuery({ queryKey: ["unread-count"], queryFn: apiUnreadCount, refetchInterval: pollMs(live, 60_000, 5000) });
  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        // iter-44 Phase 5 — freeze inactive tabs so they stop computing /
        // re-rendering until focused again. Preserves scroll position + state.
        freezeOnBlur: true,
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surfaceSecondary,
          borderTopColor: colors.border,
          borderTopWidth: 0.5,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: "700" },
      }}
    >
      {/* iter-44 Phase 3 — Games tab REMOVED from bottom nav.
          Iter-56 — Legacy /games tab file deleted. In-room games (Ludo etc.)
          remain accessible via Room Tools inside a room.
          Iter-93 — Removed the "re-tap Home opens My Rooms sheet" behavior
          per user request. Users can still access My Rooms via /my-rooms. */}
      <Tabs.Screen
        name="home"
        options={{
          title: t.partyRooms,
          tabBarIcon: ({ color, size }) => <Icon name="mic" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="posts"
        options={{
          title: t.posts,
          tabBarIcon: ({ color, size }) => <Icon name="newspaper" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: t.messagesTitle,
          tabBarIcon: ({ color, size }) => <Icon name="chatbubbles" size={size} color={color} />,
          tabBarBadge: fmtCount(unread?.unread) || undefined,
          tabBarBadgeStyle: { backgroundColor: colors.error, color: "#FFFFFF", fontSize: 10, fontWeight: "800" },
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: t.tabMe,
          tabBarIcon: ({ color, size }) => <Icon name="person" size={size} color={color} />,
        }}
      />
      {/* Hidden tabs — reachable only by direct route; nested pages hide the tab bar. */}
      <Tabs.Screen name="wallet" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="profile" options={{ href: null, tabBarStyle: { display: "none" } }} />
    </Tabs>
  );
}
