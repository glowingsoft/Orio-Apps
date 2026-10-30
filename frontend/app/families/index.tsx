import { useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, ActivityIndicator, Modal, Alert } from "react-native";
import { useRouter } from "expo-router";
import { safeBack } from "@/src/navigation/safeBack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/ionicons";
import { apiFamilies, apiFamiliesMine, apiFamilyCreate, apiFamilyJoin } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { FoluCoin } from "@/src/components/FoluCoin";
import { Diamond } from "@/src/components/Diamond";
import { useAuth } from "@/src/auth-context";
import { FamilyLogo } from "@/src/families/FamilyLogo";

export default function FamiliesList() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { refresh } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"all" | "mine">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const { data: all = [] } = useQuery({ queryKey: ["families"], queryFn: apiFamilies });
  const { data: mine = [] } = useQuery({ queryKey: ["families-mine"], queryFn: apiFamiliesMine });

  const list = tab === "all" ? all : mine;
  const myIds = new Set((mine as any[]).map((f) => f.id));

  const create = useMutation({
    mutationFn: () => apiFamilyCreate({ name: name.trim(), description: desc.trim() }),
    onSuccess: async (fam) => { setCreateOpen(false); setName(""); setDesc(""); await refresh(); qc.invalidateQueries({ queryKey: ["families"] }); qc.invalidateQueries({ queryKey: ["families-mine"] }); router.push(`/families/${fam.id}`); },
    onError: (e: any) => setErr(e.message),
  });
  const join = useMutation({
    mutationFn: (id: string) => apiFamilyJoin(id),
    onSuccess: (_r, id) => {
      qc.invalidateQueries({ queryKey: ["families-mine"] });
      qc.invalidateQueries({ queryKey: ["families"] });
      qc.invalidateQueries({ queryKey: ["family", id] });
    },
    onError: (e: any) => Alert.alert("Couldn't join", e?.message || "Please try again"),
  });

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="families-screen">
      <View style={styles.header}>
        <Pressable onPress={() => safeBack(router)} style={styles.iconBtn} testID="back-btn">
          <Icon name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Families</Text>
        <Pressable testID="create-family-btn" onPress={() => setCreateOpen(true)} style={styles.iconBtnGold}>
          <Icon name="add" size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>
      <View style={styles.tabs}>
        <Pressable testID="tab-all" onPress={() => setTab("all")} style={[styles.tab, tab === "all" && styles.tabActive]}>
          <Text style={[styles.tabText, tab === "all" && styles.tabTextActive]}>Explore</Text>
        </Pressable>
        <Pressable testID="tab-mine" onPress={() => setTab("mine")} style={[styles.tab, tab === "mine" && styles.tabActive]}>
          <Text style={[styles.tabText, tab === "mine" && styles.tabTextActive]}>My Families</Text>
        </Pressable>
      </View>
      <FlatList
        data={list}
        keyExtractor={(f) => f.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
        ListEmptyComponent={() => (
          <View style={styles.center}>
            <Icon name="home-outline" size={64} color={colors.muted} />
            <Text style={styles.empty}>{tab === "mine" ? "You haven't joined a family" : "No families yet"}</Text>
            <Pressable onPress={() => setCreateOpen(true)} style={styles.emptyCta}>
              <Text style={styles.emptyCtaText}>Create your family</Text>
            </Pressable>
          </View>
        )}
        renderItem={({ item }) => (
          <Pressable testID={`family-${item.id}`} onPress={() => router.push(`/families/${item.id}`)} style={styles.row}>
            <FamilyLogo uri={item.logo_url} name={item.name} size={56} radius={12} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.sub} numberOfLines={1}>{item.description || "No description"}</Text>
              <View style={styles.metaRow}>
                <Icon name="people" size={12} color={colors.muted} />
                <Text style={styles.meta}>{item.members_count} members</Text>
              </View>
            </View>
            {tab === "all" && (myIds.has(item.id) ? (
              <View testID={`joined-${item.id}`} style={styles.joinedBadge}>
                <Icon name="checkmark" size={12} color={colors.brandPrimary} />
                <Text style={styles.joinedText}>Joined</Text>
              </View>
            ) : (
              <Pressable
                testID={`join-${item.id}`}
                onPress={() => join.mutate(item.id)}
                disabled={join.isPending}
                style={[styles.joinBtn, join.isPending && join.variables === item.id && { opacity: 0.6 }]}
              >
                {join.isPending && join.variables === item.id
                  ? <ActivityIndicator size="small" color={colors.onBrandPrimary} />
                  : <Text style={styles.joinText}>Join</Text>}
              </Pressable>
            ))}
          </Pressable>
        )}
      />

      <Modal visible={createOpen} transparent animationType="slide" onRequestClose={() => setCreateOpen(false)}>
        <Pressable onPress={() => setCreateOpen(false)} style={styles.modalOverlay}>
          <Pressable onPress={() => {}} style={[styles.modal, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.dragHandle} />
            <Text style={styles.modalTitle}>Create Family</Text>
            <View style={styles.costRow}>
              <Diamond size={16} /><Text style={styles.costText}>10,000 Diamonds</Text>
            </View>
            <TextInput testID="family-name-input" value={name} onChangeText={setName} placeholder="Family name" placeholderTextColor={colors.muted} style={styles.input} maxLength={30} />
            <TextInput testID="family-desc-input" value={desc} onChangeText={setDesc} placeholder="Description (optional)" placeholderTextColor={colors.muted} style={[styles.input, { height: 80 }]} multiline maxLength={200} />
            {err && <Text style={styles.err}>{err}</Text>}
            <Pressable testID="submit-family-btn" onPress={() => name.trim() && create.mutate()} disabled={!name.trim() || create.isPending} style={[styles.submitBtn, (!name.trim() || create.isPending) && { opacity: 0.5 }]}>
              {create.isPending ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.submitText}>Create</Text>}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  iconBtnGold: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  tabs: { flexDirection: "row", marginHorizontal: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, padding: 4 },
  tab: { flex: 1, height: 36, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  tabActive: { backgroundColor: colors.gold },
  tabText: { color: colors.muted, fontWeight: "700" },
  tabTextActive: { color: colors.onBrandPrimary },
  center: { alignItems: "center", padding: spacing.xxl, gap: spacing.md },
  empty: { color: colors.muted, fontSize: 15 },
  emptyCta: { backgroundColor: colors.gold, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.pill },
  emptyCtaText: { color: colors.onBrandPrimary, fontWeight: "800" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md },
  logo: { width: 56, height: 56, borderRadius: 12 },
  name: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  sub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  meta: { color: colors.muted, fontSize: 11 },
  joinBtn: { backgroundColor: colors.purple, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill },
  joinText: { color: "#FFF", fontWeight: "800", fontSize: 12 },
  joinedBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.brandPrimary },
  joinedText: { color: colors.brandPrimary, fontWeight: "800", fontSize: 12 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modal: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg },
  dragHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.md },
  modalTitle: { color: colors.onSurface, fontSize: 20, fontWeight: "800", marginBottom: spacing.md },
  costRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.md },
  costText: { color: colors.gold, fontWeight: "800" },
  input: { backgroundColor: colors.surfaceTertiary, color: colors.onSurface, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, marginBottom: spacing.md, fontSize: 15 },
  err: { color: colors.error, textAlign: "center", marginBottom: spacing.sm },
  submitBtn: { backgroundColor: colors.gold, height: 50, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  submitText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 16 },
});
