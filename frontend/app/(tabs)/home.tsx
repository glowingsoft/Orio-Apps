import { useMemo, useState, useCallback, useRef } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, Modal, TextInput, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useQuery } from "@tanstack/react-query";
import {
  apiListRooms,
  apiRoomFilterCountries,
  apiListRoomsPopular,
  apiListRoomsPk,
  apiRoomsFollowing,
  apiRoomsWatched,
  apiRoomsMine,
  apiRoomsManaged,
} from "@/src/api";
import { HomeRoomsMenu } from "@/src/room/HomeRoomsMenu";
import { useAuth } from "@/src/auth-context";
import { useI18n } from "@/src/i18n";
import { colors, spacing, radius } from "@/src/theme";
import { OrioRefreshControl } from "@/src/components/OrioRefreshControl";
import { OrioCreateRoom } from "@/src/components/OrioIcons";
import { typography } from "@/src/components/typography";
import { TabBackground } from "@/src/components/TabBackground";
import { RoomCard } from "@/src/components/RoomCard";
import { CountryFlag } from "@/src/components/CountryFlag";

const ALL_COUNTRY_FLAG = "🌐";

export default function Rooms() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { isRTL, t } = useI18n();
  const ALL_COUNTRY = { code: "all", name: t.allCountries, flag: ALL_COUNTRY_FLAG };
  // Iter-49 — ORIO Party Rooms discovery pills (7 real filters)
  const DISCOVERY_TABS: { id: string; icon: string; label: string }[] = [
    { id: "recommended", icon: "sparkles",        label: t.discoveryRecommended },
    { id: "pk",          icon: "flash",           label: "PK" },
    { id: "music",       icon: "musical-notes",   label: t.discoveryMusic },
    { id: "chat",        icon: "chatbubbles",     label: t.discoveryChat },
    { id: "games",       icon: "game-controller", label: t.discoveryGames },
    { id: "cp",          icon: "heart",           label: "CP" },
    { id: "watched",     icon: "time",            label: t.discoveryWatched },
  ];

  const [selectedCountry, setSelectedCountry] = useState<any>(ALL_COUNTRY);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<
    "recommended" | "pk" | "music" | "chat" | "games" | "cp" | "watched"
  >("recommended");

  const cc = selectedCountry?.code;
  // Iter-67 — Fetch my owned rooms once (lightweight) so we can hide the
  // "Start a Room" entry points for users who already own one.
  const { data: ownedForGate = [] } = useQuery({
    queryKey: ["rooms-mine-gate"],
    queryFn: apiRoomsMine,
    staleTime: 15_000,
  });
  // Prefetched so the 🏠 popup opens instantly with real data.
  const { data: managedRooms = [] } = useQuery({ queryKey: ["rooms-managed"], queryFn: apiRoomsManaged, staleTime: 15_000 });
  const homeBtnRef = useRef<View>(null);
  const [homeMenuY, setHomeMenuY] = useState<number | null>(null);
  const openHomeMenu = () => {
    homeBtnRef.current?.measureInWindow((_x, y, _w, h) => setHomeMenuY(y + h + 6));
  };
  const alreadyOwnsRoom = (ownedForGate as any[]).some(
    (r) => r && r.is_live !== false && !r.is_deleted,
  );
  const { data: rooms = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["rooms", tab, cc],
    queryFn: async () => {
      if (tab === "recommended") return apiListRooms({ sort: "recommended", country_code: cc });
      if (tab === "pk")          return apiListRoomsPk(cc);
      if (tab === "music")       return apiListRooms({ category: "music", country_code: cc });
      if (tab === "chat")        return apiListRooms({ category: "chat", country_code: cc });
      if (tab === "games")       return apiListRooms({ category: "games", country_code: cc });
      if (tab === "cp")          return apiListRooms({ category: "cp", country_code: cc });
      if (tab === "watched")     return apiRoomsWatched(cc);
      return [] as any[];
    },
    // Iter-122 — live presence drives visibility + counts; keep the list fresh.
    refetchInterval: 10_000,
    refetchOnMount: "always",
  });
  const { data: countries = [] } = useQuery({ queryKey: ["room-filter-countries"], queryFn: apiRoomFilterCountries });

  // Iter-93 — Localize country names for RTL (Arabic uses `name_ar` from backend).
  const localizedName = (c: any) =>
    (isRTL && c?.name_ar) ? c.name_ar : (c?.name || "");

  const filteredCountries = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return [ALL_COUNTRY, ...(countries as any[])];
    return [ALL_COUNTRY, ...(countries as any[])].filter(
      (c: any) =>
        c.name?.toLowerCase().includes(s) ||
        c.name_ar?.toLowerCase?.().includes(s) ||
        c.code?.toLowerCase().includes(s),
    );
  }, [countries, search]);

  const onRefresh = useCallback(() => { refetch(); }, [refetch]);

  const renderRoom = ({ item }: any) => (
    <View style={{ paddingHorizontal: spacing.xl }}>
      <RoomCard room={item} pk={tab === "pk"} testID={`room-card-${item.id}`} />
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="rooms-screen">
      {/* Iter-66 — soft purple top glow (absolute, sits BEHIND content). */}
      <TabBackground />
      <View style={[styles.header]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, typography.screenTitleAccent, isRTL && { textAlign: "right" }]}>{t.partyRooms}</Text>
        </View>
        <Pressable testID="search-btn" onPress={() => router.push("/search" as any)} style={styles.iconBtn}>
          <Icon name="search" size={22} color={colors.brandPrimary} />
        </Pressable>
        <View style={{ width: 10 }} />
        {/* Iter-55 — Trophy opens the global supporter ranking. */}
        <Pressable
          testID="global-ranking-btn"
          onPress={() => router.push("/global-ranking" as any)}
          style={styles.iconBtn}
          accessibilityLabel={t.globalRankingLabel}
        >
          <Icon name="trophy" size={22} color="#FFD60A" />
        </Pressable>
        <View style={{ width: 10 }} />
        <View ref={homeBtnRef} collapsable={false}>
          <Pressable
            testID="enter-my-room-btn"
            onPress={openHomeMenu}
            style={styles.iconBtn}
            accessibilityLabel={t.enterMyRoom}
          >
            <Icon name="home" size={22} color={colors.brandPrimary} />
          </Pressable>
        </View>
      </View>
      <HomeRoomsMenu
        anchorY={homeMenuY}
        onClose={() => setHomeMenuY(null)}
        myRoom={(ownedForGate as any[]).find((r) => r && r.is_live !== false && !r.is_deleted) || null}
        managed={managedRooms as any[]}
        onOpen={(path) => { setHomeMenuY(null); router.push(path as any); }}
      />

      {/* Horizontal discovery categories — scroll horizontally.
          Wrapped in a fixed-height View so the row's layout is immune to
          measurement thrash when the active pill re-styles on tap. */}
      <View style={styles.tabBarWrap} testID="discovery-tabbar">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabRow}
        >
          {DISCOVERY_TABS.map((tk) => (
            <Pressable
              key={tk.id}
              testID={`tab-${tk.id}`}
              onPress={() => setTab(tk.id as any)}
              style={[styles.tabBtn, tab === tk.id && styles.tabBtnActive]}
            >
              <Icon
                name={tk.icon}
                size={16}
                color={tab === tk.id ? colors.onBrandPrimary : colors.gold}
                style={{ flexShrink: 0 }}
              />
              <Text style={[styles.tabText, tab === tk.id && styles.tabTextActive]} numberOfLines={1}>{tk.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Iter-66 — soft purple top glow only (no decorative graphics). */}

      {/* Country selector — always visible, combines with the tab filter */}
      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md, marginTop: spacing.sm }}>
        <Pressable
          testID="country-selector-btn"
          onPress={() => setPickerOpen(true)}
          style={styles.countryBtn}
        >
          <CountryFlag code={selectedCountry.code === "all" ? null : selectedCountry.code} flag={selectedCountry.flag} size={24} />
          <Text style={styles.countryBtnLabel} numberOfLines={1}>{localizedName(selectedCountry)}</Text>
          <Icon name="chevron-down" size={18} color={colors.muted} />
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={colors.gold} /></View>
      ) : rooms.length === 0 ? (
        <View style={styles.center}>
          <Icon
            name={tab === "following" ? "heart-outline" : tab === "watched" ? "time-outline" : tab === "pk" ? "flash-outline" : "mic-off"}
            size={48}
            color={colors.muted}
          />
          <Text style={styles.emptyText}>
            {tab === "following" ? t.emptyFollowing :
             tab === "watched"   ? t.emptyWatched :
             tab === "pk"        ? t.emptyPk :
             tab === "games"     ? t.emptyGames :
             tab === "family"    ? t.emptyFamily :
             tab === "popular"   ? t.emptyPopular :
             t.emptyRooms}
          </Text>
        </View>
      ) : (
        <FlatList
          testID="rooms-list"
          data={rooms}
          keyExtractor={(i) => i.id}
          renderItem={renderRoom}
          contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}
          refreshControl={<OrioRefreshControl refreshing={isRefetching} onRefresh={onRefresh} />}
        />
      )}

      {/* Country picker modal — dark premium panel */}
      <Modal
        visible={pickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable style={styles.pickerOverlay} onPress={() => setPickerOpen(false)}>
          <Pressable style={[styles.pickerSheet, { paddingBottom: insets.bottom + spacing.md }]}>
            <View style={styles.dragHandle} />
            <Text style={styles.pickerTitle}>{t.selectCountryTitle}</Text>
            <View style={styles.searchWrap}>
              <Icon name="search" size={16} color={colors.muted} />
              <TextInput
                testID="country-search"
                value={search}
                onChangeText={setSearch}
                placeholder={t.searchCountries}
                placeholderTextColor={colors.muted}
                style={styles.searchInput}
              />
            </View>
            <FlatList
              data={filteredCountries}
              keyExtractor={(c: any) => c.code}
              contentContainerStyle={{ paddingBottom: spacing.xl }}
              renderItem={({ item }: any) => {
                const active = selectedCountry?.code === item.code;
                return (
                  <Pressable
                    testID={`country-opt-${item.code}`}
                    onPress={() => { setSelectedCountry(item); setPickerOpen(false); setSearch(""); }}
                    style={[styles.countryRow, active && styles.countryRowActive]}
                  >
                    <CountryFlag code={item.code === "all" ? null : item.code} flag={item.flag} size={30} />
                    <Text style={[styles.countryRowName, isRTL && { textAlign: "right" }]} numberOfLines={1}>{localizedName(item)}</Text>
                    <View style={{ flex: 1 }} />
                    {active && <Icon name="checkmark-circle" size={20} color={colors.gold} />}
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", paddingHorizontal: spacing.lg, paddingVertical: spacing.md, alignItems: "center" },
  hi: { color: colors.muted, fontSize: 13 },
  title: { color: colors.onSurface, fontSize: 26, fontWeight: "800", marginTop: 2 },
  iconBtn: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: colors.gold + "66",
  },

  // Country selector button
  countryBtn: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderWidth: 1, borderColor: colors.border,
  },
  countryBtnLabel: { flex: 1, color: colors.onSurface, fontWeight: "700", fontSize: 13 },

  // Iter-19: horizontal discovery tab row
  tabBarWrap: {
    height: 52,          // explicit, stable so icons never clip when the
                          // active pill re-styles on tap
    marginTop: spacing.xs,
    justifyContent: "center",
  },
  tabRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
  },
  tabBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border,
    height: 36,
  },
  tabBtnActive: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  tabText: { color: colors.muted, fontWeight: "800", fontSize: 12 },
  tabTextActive: { color: colors.onBrandPrimary },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  emptyText: { color: colors.muted, fontSize: 15 },
  emptyCta: { backgroundColor: colors.gold, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.pill },
  emptyCtaText: { color: colors.onBrandPrimary, fontWeight: "800" },

  // Picker modal
  pickerOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  pickerSheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.md, paddingTop: spacing.sm, height: "80%",
    borderTopWidth: 1, borderTopColor: colors.gold + "22",
  },
  dragHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.md },
  pickerTitle: { color: colors.onSurface, fontWeight: "800", fontSize: 18, textAlign: "center", marginBottom: spacing.md },
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, height: 42, marginBottom: spacing.md,
  },
  searchInput: { flex: 1, color: colors.onSurface, fontSize: 14 },
  countryRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.md,
    marginBottom: 4,
  },
  countryRowActive: { backgroundColor: colors.gold + "18" },
  countryRowName: { color: colors.onSurface, fontWeight: "600", fontSize: 15 },
  // My Rooms sheet (double-tap Home)
  myRoomsOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-end" },
  myRoomsSheet: {
    backgroundColor: colors.surfaceSecondary,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    maxHeight: "80%",
  },
  myRoomsTitle: { color: colors.onSurface, fontWeight: "900", fontSize: 18, textAlign: "center", marginBottom: spacing.md },
  myRoomsSection: { color: colors.gold, fontSize: 11, fontWeight: "900", letterSpacing: 1, marginBottom: 8, textTransform: "uppercase" },
  myRoomsEmpty: { color: colors.muted, fontSize: 12, paddingVertical: 6 },
  myRoomRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  myRoomCover: { width: 40, height: 40, borderRadius: 8, backgroundColor: colors.surfaceTertiary },
  myRoomName: { color: colors.onSurface, fontWeight: "800", fontSize: 14 },
  myRoomMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
});
