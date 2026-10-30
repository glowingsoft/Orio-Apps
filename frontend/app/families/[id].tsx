import { useState, useEffect, useRef } from "react";
import { VipName } from "@/src/components/VipName";
import { View, Text, StyleSheet, FlatList, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { safeBack } from "@/src/navigation/safeBack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/ionicons";
import { apiFamilyGet, apiFamilyJoin, apiFamilyLeave, apiFamilyMessages, apiFamilySendMessage } from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { colors, spacing, radius } from "@/src/theme";
import { VipBadge } from "@/src/components/VipBadge";
import { FamilyLogo } from "@/src/families/FamilyLogo";

export default function FamilyDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"chat" | "members">("chat");
  const [text, setText] = useState("");
  const listRef = useRef<FlatList>(null);

  const { data: fam, isLoading, refetch } = useQuery({ queryKey: ["family", id], queryFn: () => apiFamilyGet(id!), enabled: !!id });
  const { data: msgs = [], refetch: refetchMsgs } = useQuery({
    queryKey: ["family-msgs", id],
    queryFn: () => apiFamilyMessages(id!),
    enabled: !!id && !!fam?.is_member,
    refetchInterval: 3000,
  });

  // Keep the Families list (Join / Joined) in sync with membership changes here.
  const syncLists = () => { refetch(); qc.invalidateQueries({ queryKey: ["families-mine"] }); qc.invalidateQueries({ queryKey: ["families"] }); };
  const join = useMutation({ mutationFn: () => apiFamilyJoin(id!), onSuccess: syncLists });
  const leave = useMutation({ mutationFn: () => apiFamilyLeave(id!), onSuccess: syncLists });
  const send = useMutation({
    mutationFn: (t: string) => apiFamilySendMessage(id!, t),
    onSuccess: () => refetchMsgs(),
  });

  useEffect(() => { setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 200); }, [msgs]);

  const doSend = () => {
    if (!text.trim()) return;
    const t = text.trim(); setText("");
    send.mutate(t);
  };

  if (isLoading || !fam) {
    return <View style={[styles.container, styles.center]}><ActivityIndicator color={colors.gold} /></View>;
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: colors.surface }}>
      {/* Hero */}
      <View style={{ paddingTop: insets.top }}>
        <LinearGradient colors={[colors.purple, colors.purpleDeep]} style={styles.hero}>
          <View style={styles.headerBar}>
            <Pressable onPress={() => safeBack(router)} style={styles.iconBtn} testID="back-btn">
              <Icon name="chevron-back" size={22} color="#FFF" />
            </Pressable>
            <View style={{ width: 40 }} />
          </View>
          <View style={styles.heroContent}>
            <FamilyLogo uri={fam.logo_url} name={fam.name} size={80} radius={20} style={styles.logo} />
            <Text style={styles.famName}>{fam.name}</Text>
            {fam.description && <Text style={styles.famDesc}>{fam.description}</Text>}
            <View style={styles.stats}>
              <View style={styles.stat}><Text style={styles.statVal}>{fam.members_count}</Text><Text style={styles.statLabel}>Members</Text></View>
              <View style={styles.stat}><Text style={styles.statVal}>{fam.points}</Text><Text style={styles.statLabel}>Points</Text></View>
            </View>
            {!fam.is_member ? (
              <Pressable testID="join-btn" onPress={() => join.mutate()} style={styles.actionBtn}>
                <Text style={styles.actionBtnText}>Join Family</Text>
              </Pressable>
            ) : !fam.is_owner ? (
              <Pressable testID="leave-btn" onPress={() => leave.mutate()} style={[styles.actionBtn, { backgroundColor: colors.error }]}>
                <Text style={styles.actionBtnText}>Leave</Text>
              </Pressable>
            ) : (
              <View style={styles.ownerChip}>
                <Icon name="star" size={14} color={colors.gold} />
                <Text style={{ color: colors.gold, fontWeight: "800", fontSize: 12 }}>Owner</Text>
              </View>
            )}
          </View>
        </LinearGradient>
      </View>

      {fam.is_member && (
        <View style={styles.tabs}>
          <Pressable testID="tab-chat" onPress={() => setTab("chat")} style={[styles.tab, tab === "chat" && styles.tabActive]}>
            <Text style={[styles.tabText, tab === "chat" && styles.tabTextActive]}>Family Chat</Text>
          </Pressable>
          <Pressable testID="tab-members" onPress={() => setTab("members")} style={[styles.tab, tab === "members" && styles.tabActive]}>
            <Text style={[styles.tabText, tab === "members" && styles.tabTextActive]}>Members</Text>
          </Pressable>
        </View>
      )}

      {!fam.is_member ? (
        <View style={styles.locked}>
          <Icon name="lock-closed" size={48} color={colors.muted} />
          <Text style={styles.lockedText}>Join to access private family chat</Text>
        </View>
      ) : tab === "chat" ? (
        <>
          <FlatList
            ref={listRef}
            data={msgs}
            keyExtractor={(_, i) => i.toString()}
            contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}
            renderItem={({ item }) => {
              const mine = item.sender_id === user?.id;
              return (
                <View style={[styles.msgRow, mine && { flexDirection: "row-reverse" }]}>
                  {!mine && <Image source={item.sender_pub?.avatar_url} style={styles.msgAvatar} />}
                  <View style={[styles.msgBubble, mine ? styles.mine : styles.theirs]}>
                    {!mine && <VipName style={styles.msgSender} name={item.sender_pub?.nickname} color={(item.sender_pub as any)?.name_color} vipLevel={(item.sender_pub as any)?.vip_level} />}
                    <Text style={[styles.msgText, mine && { color: colors.onBrandPrimary }]}>{item.text}</Text>
                  </View>
                </View>
              );
            }}
            ListEmptyComponent={() => (
              <View style={{ alignItems: "center", padding: spacing.xl }}>
                <Text style={{ color: colors.muted }}>No messages yet — say hi 👋</Text>
              </View>
            )}
          />
          <View style={[styles.inputRow, { paddingBottom: insets.bottom + spacing.sm }]}>
            <TextInput testID="family-msg-input" value={text} onChangeText={setText} placeholder="Type..." placeholderTextColor={colors.muted} style={styles.input} onSubmitEditing={doSend} />
            <Pressable testID="family-send-btn" onPress={doSend} style={styles.sendBtn}>
              <Icon name="send" size={18} color={colors.onBrandPrimary} />
            </Pressable>
          </View>
        </>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, paddingBottom: insets.bottom + spacing.xl }}>
          {fam.members?.map((m: any, i: number) => (
            <View key={i} style={styles.memberRow} testID={`member-${m.id}`}>
              <Image source={m.avatar_url} style={styles.memberAvatar} />
              <View style={{ flex: 1 }}>
                <VipName style={styles.memberName} name={m?.nickname} color={(m as any)?.name_color} vipLevel={(m as any)?.vip_level} />
                <Text style={styles.memberRole}>{m.role}</Text>
              </View>
              {m.vip_level > 0 && <VipBadge level={m.vip_level} />}
            </View>
          ))}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { alignItems: "center", justifyContent: "center" },
  hero: { paddingBottom: spacing.lg },
  headerBar: { flexDirection: "row", padding: spacing.md },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.3)", alignItems: "center", justifyContent: "center" },
  heroContent: { alignItems: "center", paddingHorizontal: spacing.lg },
  logo: { width: 80, height: 80, borderRadius: 20 },
  famName: { color: "#FFF", fontSize: 22, fontWeight: "900", marginTop: spacing.md },
  famDesc: { color: "rgba(255,255,255,0.7)", fontSize: 13, marginTop: 4, textAlign: "center" },
  stats: { flexDirection: "row", gap: spacing.xxl, marginTop: spacing.md },
  stat: { alignItems: "center" },
  statVal: { color: "#FFF", fontSize: 20, fontWeight: "800" },
  statLabel: { color: "rgba(255,255,255,0.7)", fontSize: 11 },
  actionBtn: { marginTop: spacing.md, backgroundColor: colors.gold, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, borderRadius: radius.pill },
  actionBtnText: { color: colors.onBrandPrimary, fontWeight: "800" },
  ownerChip: { marginTop: spacing.md, backgroundColor: "rgba(0,0,0,0.4)", paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, flexDirection: "row", gap: 4, alignItems: "center" },
  tabs: { flexDirection: "row", marginHorizontal: spacing.lg, marginTop: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, padding: 4 },
  tab: { flex: 1, height: 36, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  tabActive: { backgroundColor: colors.gold },
  tabText: { color: colors.muted, fontWeight: "700" },
  tabTextActive: { color: colors.onBrandPrimary },
  locked: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xxl },
  lockedText: { color: colors.muted, fontSize: 14, textAlign: "center" },
  msgRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-end" },
  msgAvatar: { width: 32, height: 32, borderRadius: 16 },
  msgBubble: { maxWidth: "70%", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg },
  mine: { backgroundColor: colors.gold, borderBottomRightRadius: 4 },
  theirs: { backgroundColor: colors.surfaceSecondary, borderBottomLeftRadius: 4 },
  msgSender: { color: colors.gold, fontSize: 11, fontWeight: "800", marginBottom: 2 },
  msgText: { color: colors.onSurface, fontSize: 14 },
  inputRow: { flexDirection: "row", padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderTopWidth: 0.5, borderTopColor: colors.border },
  input: { flex: 1, backgroundColor: colors.surfaceTertiary, color: colors.onSurface, borderRadius: radius.pill, paddingHorizontal: spacing.lg, height: 44 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center" },
  memberRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md },
  memberAvatar: { width: 44, height: 44, borderRadius: 22 },
  memberName: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  memberRole: { color: colors.muted, fontSize: 11, marginTop: 2, textTransform: "uppercase" },
});
