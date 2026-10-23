/**
 * ORIO Real User Search (iter-44 Phase 3)
 * ----------------------------------------------------------------------------
 * Reached from the Rooms (Party rooms) header icon. Debounced search by
 * nickname, username, or numeric ID using the live /api/users/search endpoint.
 * Shows empty / typing / loading / results / no-results / error states.
 */
import { CountryFlag } from "@/src/components/CountryFlag";
import { View, Text, StyleSheet, TextInput, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { Image } from "expo-image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiSearchUsers, apiRoomsSearch } from "@/src/api";
import { RoomCard } from "@/src/components/RoomCard";
import { useI18n } from "@/src/i18n";
import { NewUserBadge } from "@/src/components/NewUserBadge";
import { VipBadge } from "@/src/components/VipBadge";
import { AgeBadge, LevelBadgeChip } from "@/src/levels/badges";
import { VipName } from "@/src/components/VipName";
import { colors, spacing, radius } from "@/src/theme";

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isRTL } = useI18n();
  // mode=id (Messages → Add Friends): exact User ID only → opens the profile.
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const idMode = mode === "id";
  const [idErr, setIdErr] = useState<string | null>(null);
  const [idBusy, setIdBusy] = useState(false);
  const [raw, setRaw] = useState("");
  const [debounced, setDebounced] = useState("");
  const typingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce (300ms) so we don't hammer the backend on every keystroke.
  useEffect(() => {
    if (typingRef.current) clearTimeout(typingRef.current);
    typingRef.current = setTimeout(() => setDebounced(raw.trim()), 300);
    return () => { if (typingRef.current) clearTimeout(typingRef.current); };
  }, [raw]);

  const q = useQuery({
    queryKey: ["users-search", debounced],
    queryFn: () => apiSearchUsers(debounced, 30),
    enabled: !idMode && debounced.length >= 1,
    staleTime: 10_000,
    retry: 1,
  });

  const [tab, setTab] = useState<"users" | "rooms">("users");
  const rq = useQuery({
    queryKey: ["rooms-search", debounced],
    queryFn: () => apiRoomsSearch(debounced),
    enabled: tab === "rooms" && debounced.length >= 1,
    staleTime: 10_000,
  });
  const submit = async () => {
    const v = raw.trim();
    if (!v) return;
    if (!idMode) { setDebounced(v); return; }
    if (!/^\d{3,12}$/.test(v)) { setIdErr(isRTL ? "أدخل معرّف مستخدم صحيحًا (أرقام فقط)" : "Enter a valid User ID (numbers only)"); return; }
    setIdBusy(true); setIdErr(null);
    try {
      const r = await apiSearchUsers(v, 10);
      const hit = (r.items || []).find((u) => String(u.numeric_id) === v);
      if (hit) router.replace(`/user/${hit.id}` as any);
      else setIdErr(isRTL ? "لا يوجد مستخدم بهذا المعرّف" : "No user found with this ID");
    } catch {
      setIdErr(isRTL ? "تعذر البحث" : "Could not search");
    } finally { setIdBusy(false); }
  };
  const state = useMemo<"empty" | "typing" | "loading" | "error" | "no-results" | "results">(() => {
    if (!raw.trim()) return "empty";
    if (raw.trim() !== debounced) return "typing";
    if (q.isLoading) return "loading";
    if (q.isError) return "error";
    if ((q.data?.items.length ?? 0) === 0) return "no-results";
    return "results";
  }, [raw, debounced, q.data, q.isLoading, q.isError]);

  return (
    <View style={styles.root} testID="search-screen">
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} testID="search-back" hitSlop={10}>
          <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={22} color={colors.onSurface} />
        </Pressable>
        <View style={styles.searchBox}>
          <Icon name="search" size={16} color={colors.muted} />
          <TextInput
            autoFocus
            value={raw}
            onChangeText={(v) => { setRaw(idMode ? v.replace(/\D/g, "") : v); setIdErr(null); }}
            placeholder={idMode ? (isRTL ? "أدخل معرّف المستخدم" : "Enter User ID") : (isRTL ? "ابحث بالاسم أو المعرف" : "Search by name or ID")}
            placeholderTextColor={colors.muted}
            style={[styles.input, { textAlign: isRTL ? "right" : "left" }]}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType={idMode ? "number-pad" : "default"}
            returnKeyType="search"
            onSubmitEditing={submit}
            testID="search-input"
          />
          {raw.length > 0 && (
            <Pressable onPress={() => setRaw("")} hitSlop={10} testID="search-clear">
              <Icon name="close-circle" size={16} color={colors.muted} />
            </Pressable>
          )}
          {/* Rounded "Search" button at the END of the bar (mirrors in RTL). */}
          <Pressable onPress={submit} style={styles.searchBtn} testID="search-submit" disabled={idBusy}>
            {idBusy ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : (
              <Text style={styles.searchBtnText}>{isRTL ? "بحث" : "Search"}</Text>
            )}
          </Pressable>
        </View>
      </View>

      {idMode ? (
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
          {idErr ? (
            <State iconName="person-remove-outline" testID="search-id-error" title={idErr} body="" />
          ) : (
            <State iconName="id-card-outline" testID="search-id-hint"
              title={isRTL ? "ابحث بمعرّف المستخدم" : "Search by User ID"}
              body={isRTL ? "أدخل المعرّف الرقمي ثم اضغط بحث لفتح الملف الشخصي" : "Enter the numeric ID, then tap Search to open the profile"} />
          )}
        </View>
      ) : (<>
      <View style={styles.tabs}>
        {(["users", "rooms"] as const).map((k) => (
          <Pressable key={k} onPress={() => setTab(k)} style={[styles.tab, tab === k && styles.tabOn]} testID={`search-tab-${k}`}>
            <Text style={[styles.tabText, tab === k && styles.tabTextOn]}>
              {k === "users" ? (isRTL ? "المستخدمون" : "Users") : (isRTL ? "الغرف" : "Rooms")}
            </Text>
          </Pressable>
        ))}
      </View>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}
        keyboardShouldPersistTaps="handled"
      >
        {tab === "rooms" && (
          !debounced ? (
            <State iconName="mic-outline" testID="search-rooms-empty"
              title={isRTL ? "ابحث عن الغرف" : "Search rooms"}
              body={isRTL ? "اكتب اسم غرفة أو اسم/معرّف مستخدم" : "Type a room name, or a user's name / ID"} />
          ) : rq.isLoading ? (
            <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {(rq.data?.rooms || []).map((r: any) => <RoomCard key={r.id} room={r} testID={`search-room-${r.id}`} />)}
              {(rq.data?.users_without_room || []).map((u: any) => (
                <View key={u.id} style={styles.noRoom} testID={`search-no-room-${u.id}`}>
                  <Icon name="mic-off-outline" size={18} color={colors.muted} />
                  <Text style={styles.noRoomText}>
                    <Text style={{ fontWeight: "800" }}>{u.nickname || "User"}{u.numeric_id ? ` (ID ${u.numeric_id})` : ""}: </Text>
                    {isRTL ? "هذا المستخدم لم يفتح غرفة صوتية بعد!" : "This user hasn't opened a voice room yet!"}
                  </Text>
                </View>
              ))}
              {!(rq.data?.rooms || []).length && !(rq.data?.users_without_room || []).length && (
                <State iconName="search-outline" testID="search-rooms-no-results"
                  title={isRTL ? "لا توجد غرف" : "No rooms"} body={isRTL ? `لا توجد نتائج لـ "${debounced}"` : `No rooms found for "${debounced}"`} />
              )}
            </View>
          )
        )}
        {tab === "users" && state === "empty" && (
          <State iconName="search-outline" testID="search-state-empty"
            title={isRTL ? "ابدأ البحث" : "Start searching"}
            body={isRTL ? "اكتب اسمًا أو معرفًا للعثور على المستخدمين" : "Type a name or ID to find users"} />
        )}
        {tab === "users" && state === "typing" && (
          <State iconName="hourglass-outline" testID="search-state-typing"
            title={isRTL ? "جاري الكتابة…" : "Keep typing…"} body="" />
        )}
        {tab === "users" && state === "loading" && (
          <View style={styles.center} testID="search-state-loading">
            <ActivityIndicator color={colors.brandPrimary} />
          </View>
        )}
        {tab === "users" && state === "error" && (
          <State iconName="alert-circle-outline" testID="search-state-error"
            title={isRTL ? "تعذر البحث" : "Could not search"}
            body={isRTL ? "تحقق من اتصالك وحاول مرة أخرى" : "Check your connection and try again"} />
        )}
        {tab === "users" && state === "no-results" && (
          <State iconName="person-remove-outline" testID="search-state-empty-results"
            title={isRTL ? "لا توجد نتائج" : "No results"}
            body={isRTL ? `لم نعثر على نتائج لـ "${debounced}"` : `No users found for "${debounced}"`} />
        )}
        {tab === "users" && state === "results" && (
          <View style={styles.results}>
            {q.data!.items.map((u) => (
              <Pressable
                key={u.id}
                style={styles.card}
                onPress={() => router.push(`/user/${u.id}` as any)}
                testID={`search-result-${u.id}`}
              >
                <View style={styles.avatarWrap}>
                  {u.avatar_url ? (
                    <Image source={{ uri: u.avatar_url }} style={styles.avatar} contentFit="cover" />
                  ) : (
                    <View style={[styles.avatar, styles.avatarEmpty]}>
                      <Icon name="person" size={22} color={colors.muted} />
                    </View>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <VipName
                      name={u.nickname ?? u.username ?? "ORIO user"}
                      color={(u as any).name_color}
                      style={styles.name}
                      numberOfLines={1}
                    />
                    {u.country_flag ? <CountryFlag flag={u.country_flag} size={16} /> : null}
                    <NewUserBadge isNew={(u as any).is_new} />
                  </View>
                  {/* Badges in order: Age · VIP · Wealth · Charm */}
                  <View style={styles.badgeRow} testID={`search-result-badges-${u.id}`}>
                    <AgeBadge age={(u as any).age} gender={(u as any).gender} />
                    {(u.vip_level ?? 0) > 0 && <VipBadge level={u.vip_level!} size="sm" />}
                    <LevelBadgeChip sys="wealth" level={Number((u as any).wealth_level || 0)} size="sm" />
                    <LevelBadgeChip sys="charm" level={Number((u as any).charm_level || 0)} size="sm" />
                  </View>
                  <Text style={styles.subtle} numberOfLines={1}>
                    {u.numeric_id ? `ID: ${u.numeric_id}` : (u.username ? `@${u.username}` : "")}
                  </Text>
                </View>
                {u.is_following ? (
                  <View style={styles.pillFollowing}>
                    <Icon name="checkmark" size={12} color={colors.success} />
                    <Text style={styles.pillFollowingText}>
                      {isRTL ? "متابَع" : "Following"}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
      </>)}
    </View>
  );
}

function State({ iconName, title, body, testID }: { iconName: string; title: string; body: string; testID: string }) {
  return (
    <View style={styles.state} testID={testID}>
      <View style={styles.stateIcon}>
        <Icon name={iconName as any} size={28} color={colors.muted} />
      </View>
      <Text style={styles.stateTitle}>{title}</Text>
      {body ? <Text style={styles.stateBody}>{body}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  searchBtn: { height: 30, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", marginStart: 4 },
  searchBtnText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 13 },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap", marginTop: 3 },
  tabs: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  tab: { flex: 1, height: 36, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  tabOn: { backgroundColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceSecondary, fontWeight: "800", fontSize: 13 },
  tabTextOn: { color: colors.onBrandPrimary },
  noRoom: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  noRoomText: { flex: 1, color: colors.onSurface, fontSize: 13 },
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.brandPrimary + "33",
  },
  input: { flex: 1, color: colors.onSurface, fontSize: 15, paddingVertical: 0 },
  results: { gap: spacing.sm, paddingVertical: spacing.md },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  avatarWrap: { position: "relative" },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarEmpty: { backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  vipBadgeWrap: {
    position: "absolute", right: -4, bottom: -4,
  },
  name: { color: colors.onSurface, fontSize: 15, fontWeight: "800", flexShrink: 1 },
  flag: { fontSize: 14 },
  subtle: { color: colors.muted, fontSize: 11, marginTop: 2 },
  pillFollowing: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.success + "22",
    borderWidth: 1, borderColor: colors.success + "55",
  },
  pillFollowingText: { color: colors.success, fontSize: 11, fontWeight: "800" },
  center: { padding: spacing.xxl, alignItems: "center", justifyContent: "center" },
  state: {
    alignItems: "center",
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  stateIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
  },
  stateTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "900", marginTop: spacing.sm, textAlign: "center" },
  stateBody: { color: colors.muted, fontSize: 12, textAlign: "center", lineHeight: 18 },
});
