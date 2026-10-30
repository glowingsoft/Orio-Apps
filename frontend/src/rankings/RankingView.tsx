/**
 * Shared premium ranking layout (Global + Room ranking): sticky tab strips,
 * Messages-style rows, crimson FlameBadge points, pinned viewer row at bottom.
 * Room-kind items render with the same RoomCard used in the Rooms tab.
 */
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Image } from "expo-image";
import { useRouter, Stack } from "expo-router";
import { safeBack } from "@/src/navigation/safeBack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { colors, spacing } from "@/src/theme";
import { VipName } from "@/src/components/VipName";
import { VipBadge } from "@/src/components/VipBadge";
import { AgeBadge, LevelBadgeChip } from "@/src/levels/badges";
import { RoomCard } from "@/src/components/RoomCard";
import { FlameBadge } from "./FlameBadge";
import { FamilyLogo } from "@/src/families/FamilyLogo";

export type RankEntry = {
  rank: number;
  score: number;
  kind: "user" | "room" | "family" | "pair";
  user?: any;
  room?: any;
  /** CP / Friends boards rank two users together. */
  pair?: any[];
};

/** Round avatar with an icon fallback when there is no picture. */
function Avatar({
  uri,
  size = 48,
  icon = "person",
  style,
}: {
  uri?: string | null;
  size?: number;
  icon?: "person" | "people";
  style?: any;
}) {
  const [failedUri, setFailedUri] = React.useState<string | null>(null);
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (uri && failedUri !== uri) {
    return (
      <Image
        source={uri}
        style={[styles.avatar, box, style]}
        contentFit="cover"
        onError={() => setFailedUri(uri)}
      />
    );
  }
  return (
    <View style={[styles.avatar, box, styles.avatarEmpty, style]}>
      <Icon name={icon} size={size * 0.5} color={colors.muted} />
    </View>
  );
}
export type Tab = { id: string; label: string };

/** K / M compact (letters never translated). */
export function compact(n: number) {
  if (n >= 1_000_000_000)
    return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1_000)
    return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return String(n);
}

function Points({ score, testID }: { score: number; testID?: string }) {
  return (
    <View style={styles.amountWrap}>
      <Text style={styles.amount} testID={testID}>
        {compact(Math.max(0, Math.round(score || 0)))}
      </Text>
      <FlameBadge size={15} />
    </View>
  );
}

function RankRow({
  e,
  mine,
  isRTL,
  onPress,
}: {
  e: RankEntry;
  mine?: boolean;
  isRTL?: boolean;
  onPress: () => void;
}) {
  if (e.kind === "room" && e.room) {
    return (
      <View
        style={styles.roomRow}
        testID={mine ? "rank-row-me" : `rank-row-${e.rank}`}
      >
        <Text
          style={[
            styles.rankNum,
            e.rank > 0 &&
              e.rank <= 3 && {
                color: ["#E0A800", "#8A9099", "#B5733F"][e.rank - 1],
              },
          ]}
        >
          {e.rank > 0 ? e.rank : "50+"}
        </Text>
        <View style={{ flex: 1 }}>
          <RoomCard room={e.room} testID={`rank-room-${e.room.id}`} />
          {/* Flame + points pinned to the card's upper corner, overlapping its edge. */}
          <View
            style={styles.roomFlame}
            pointerEvents="none"
            testID={mine ? "rank-room-flame-me" : `rank-room-flame-${e.rank}`}
          >
            <Text
              style={styles.roomFlameText}
              testID={mine ? "rank-my-amount" : undefined}
            >
              {compact(Math.max(0, Math.round(e.score || 0)))}
            </Text>
            <FlameBadge size={18} />
          </View>
        </View>
      </View>
    );
  }
  const rankColor = e.rank > 0 &&
    e.rank <= 3 && { color: ["#E0A800", "#8A9099", "#B5733F"][e.rank - 1] };
  if (e.kind === "pair" && e.pair?.length) {
    const [a, b] = e.pair;
    return (
      <View
        testID={mine ? "rank-row-me" : `rank-row-${e.rank}`}
        style={styles.row}
      >
        <Text style={[styles.rankNum, rankColor]}>
          {e.rank > 0 ? e.rank : "50+"}
        </Text>
        <View style={styles.pairAvatars}>
          <Avatar uri={a?.avatar_url} size={40} />
          <Avatar uri={b?.avatar_url} size={40} style={styles.pairSecond} />
        </View>
        <View style={{ flex: 1, alignItems: "flex-start", gap: 2 }}>
          <VipName
            name={a?.nickname || "—"}
            color={a?.name_color}
            vipLevel={a?.vip_level}
            style={styles.name}
            numberOfLines={1}
          />
          <VipName
            name={b?.nickname || "—"}
            color={b?.name_color}
            vipLevel={b?.vip_level}
            style={styles.name}
            numberOfLines={1}
          />
        </View>
        <Points score={e.score} testID={mine ? "rank-my-amount" : undefined} />
      </View>
    );
  }
  const u = e.user || {};
  return (
    <Pressable
      testID={mine ? "rank-row-me" : `rank-row-${e.rank}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      <Text
        style={[
          styles.rankNum,
          e.rank > 0 &&
            e.rank <= 3 && {
              color: ["#E0A800", "#8A9099", "#B5733F"][e.rank - 1],
            },
        ]}
      >
        {e.rank > 0 ? e.rank : "50+"}
      </Text>
      {e.kind === "family" ? (
        <FamilyLogo uri={u.avatar_url} name={u.nickname} size={48} radius={12} />
      ) : (
        <Avatar uri={u.avatar_url} />
      )}
      <View style={{ flex: 1, alignItems: "flex-start", gap: 3 }}>
        <VipName
          name={u.nickname || "—"}
          color={u.name_color}
          vipLevel={u.vip_level}
          style={styles.name}
          numberOfLines={1}
        />
        {e.kind === "family" && (
          <View style={styles.familyTag}>
            <Icon name="people" size={11} color={colors.brandPrimary} />
            <Text style={styles.familyTagText}>{isRTL ? "عائلة" : "Family"}</Text>
          </View>
        )}
        {e.kind === "user" && (
          <View style={styles.badges}>
            <AgeBadge age={u.age} gender={u.gender} />
            {(u.vip_level ?? 0) > 0 && (
              <VipBadge level={u.vip_level} size="sm" />
            )}
            {u.wealth_level != null && (
              <LevelBadgeChip
                sys="wealth"
                level={Number(u.wealth_level || 0)}
                size="sm"
              />
            )}
            {u.charm_level != null && (
              <LevelBadgeChip
                sys="charm"
                level={Number(u.charm_level || 0)}
                size="sm"
              />
            )}
          </View>
        )}
      </View>
      <Points score={e.score} testID={mine ? "rank-my-amount" : undefined} />
    </Pressable>
  );
}

export function RankingView({
  title,
  isRTL,
  tabs,
  tab,
  onTab,
  periods,
  period,
  onPeriod,
  items,
  me,
  loading,
  refreshing,
  onRefresh,
}: {
  title: string;
  isRTL: boolean;
  tabs: Tab[];
  tab: string;
  onTab: (id: string) => void;
  periods: Tab[];
  period: string;
  onPeriod: (id: string) => void;
  items: RankEntry[];
  me: RankEntry | null;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const open = (e: RankEntry) => {
    if (e.kind === "family") {
      router.push("/families" as any);
      return;
    }
    if (e.user?.id) router.push(`/user/${e.user.id}` as any);
  };
  return (
    <View style={styles.root} testID="ranking-screen">
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.stickyTabs} testID="rank-sticky-tabs">
        <View
          style={[
            styles.header,
            { paddingTop: insets.top + spacing.sm, flexDirection: "row" },
          ]}
        >
          <Pressable
            testID="rank-back"
            onPress={() => safeBack(router)}
            hitSlop={10}
            style={styles.backBtn}
          >
            <Icon
              name={isRTL ? "chevron-forward" : "chevron-back"}
              size={22}
              color={colors.onSurface}
            />
          </Pressable>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Icon name="trophy" size={22} color="#FFD60A" />
            <Text style={styles.title}>{title}</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabStrip}
          contentContainerStyle={styles.tabStripContent}
        >
          {tabs.map((c) => (
            <Pressable
              key={c.id}
              testID={`cat-${c.id}`}
              onPress={() => onTab(c.id)}
              hitSlop={6}
              style={styles.tabBtn}
            >
              <Text style={[styles.tabText, tab === c.id && styles.tabTextOn]}>
                {c.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabStrip}
          contentContainerStyle={styles.tabStripContent}
        >
          {periods.map((p) => (
            <Pressable
              key={p.id}
              testID={`period-${p.id}`}
              onPress={() => onPeriod(p.id)}
              hitSlop={6}
              style={styles.tabBtn}
            >
              <Text
                style={[styles.tabTextSm, period === p.id && styles.tabTextOn]}
              >
                {p.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Icon name="trophy-outline" size={56} color={colors.muted} />
          <Text style={styles.emptyText}>
            {isRTL ? "لا توجد بيانات لهذه الفترة" : "No data for this period"}
          </Text>
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={items}
          keyExtractor={(e) => `${e.rank}-${e.user?.id ?? e.room?.id}`}
          refreshing={refreshing}
          onRefresh={onRefresh}
          contentContainerStyle={{ paddingBottom: 16 }}
          renderItem={({ item }) => (
            <RankRow e={item} isRTL={isRTL} onPress={() => open(item)} />
          )}
        />
      )}
      {me && (
        <View
          style={[styles.myRow, { paddingBottom: insets.bottom + 8 }]}
          testID="rank-my-row"
        >
          <RankRow e={me} mine isRTL={isRTL} onPress={() => open(me)} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
  },
  title: { color: colors.onSurface, fontSize: 18, fontWeight: "900" },
  stickyTabs: { zIndex: 5, backgroundColor: colors.surface, flexShrink: 0 },
  tabStrip: { flexGrow: 0 },
  tabStripContent: {
    paddingHorizontal: spacing.lg,
    gap: 18,
    alignItems: "center",
    height: 40,
  },
  tabBtn: { height: 40, justifyContent: "center" },
  tabText: { color: "rgba(0,0,0,0.38)", fontWeight: "800", fontSize: 15 },
  tabTextSm: { color: "rgba(0,0,0,0.38)", fontWeight: "700", fontSize: 13 },
  tabTextOn: { color: "#000000" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  emptyText: { color: colors.muted, fontSize: 14 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  roomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: spacing.lg,
    paddingTop: 12,
    paddingBottom: 4,
  },
  roomFlame: {
    position: "absolute",
    top: -10,
    end: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(208,16,43,0.35)",
  },
  roomFlameText: { color: "#C8102E", fontSize: 12, fontWeight: "900" },
  badges: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexWrap: "wrap",
  },
  amountWrap: { flexDirection: "row", alignItems: "center", gap: 3 },
  myRow: {
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  rankNum: {
    color: colors.onSurfaceSecondary,
    fontSize: 14,
    fontWeight: "900",
    minWidth: 26,
    textAlign: "center",
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceTertiary,
  },
  avatarEmpty: { alignItems: "center", justifyContent: "center" },
  familyTag: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.brandPrimary + "1A" },
  familyTagText: { color: colors.brandPrimary, fontSize: 11, fontWeight: "700" },
  pairAvatars: { flexDirection: "row", width: 66 },
  pairSecond: { marginStart: -14, borderWidth: 2, borderColor: colors.surface },
  name: { color: colors.onSurface, fontSize: 14, fontWeight: "800" },
  amount: { color: colors.onSurface, fontSize: 14, fontWeight: "900" },
});
