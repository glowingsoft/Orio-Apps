import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import {
  apiMyAgency, apiMyInvitations, apiLeaveMyAgency,
  apiAcceptInvitation, apiRejectInvitation, apiAgencyEarnings,
  apiAgencyLookup, apiCreateJoinRequest, apiMyJoinRequests,
  apiCancelMyJoinRequest, ApiError,
  type InvitationRow,
} from "@/src/api";
import { Diamond } from "@/src/components/Diamond";
import { colors, spacing, radius } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { confirmDialog } from "@/src/utils/confirm";

function fmt(n: number) {
  const v = Math.abs(n);
  if (v >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export default function AgencyCenter() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, isRTL } = useI18n();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const my = useQuery({ queryKey: ["me", "agency"], queryFn: apiMyAgency });
  const invs = useQuery({ queryKey: ["me", "invitations"], queryFn: apiMyInvitations });
  const myAgencyId = my.data?.agency?.id;
  const isOwner = my.data?.role === "AGENCY_OWNER";

  // Agency earnings (if the user is in one): hosts can read via owner path
  // only if they are the owner — otherwise this will 403 and we skip.
  const agEarnings = useQuery({
    queryKey: ["agency", myAgencyId, "earnings"],
    queryFn: () => apiAgencyEarnings(myAgencyId!),
    enabled: !!myAgencyId && isOwner,
    retry: false,
  });

  const leave = useMutation({
    mutationFn: apiLeaveMyAgency,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me", "agency"] });
      qc.invalidateQueries({ queryKey: ["me", "invitations"] });
    },
  });

  const accept = useMutation({
    mutationFn: (inv_id: string) => apiAcceptInvitation(inv_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me", "agency"] });
      qc.invalidateQueries({ queryKey: ["me", "invitations"] });
    },
  });

  const reject = useMutation({
    mutationFn: (inv_id: string) => apiRejectInvitation(inv_id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me", "invitations"] }),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([my.refetch(), invs.refetch(), agEarnings.refetch()]);
    setRefreshing(false);
  }, [my, invs, agEarnings]);

  const askLeave = () => {
    confirmDialog(t.leaveAgency, t.confirmLeave, [
      { text: t.cancel, style: "cancel" },
      { text: t.leaveAgency, style: "destructive", onPress: () => leave.mutate() },
    ]);
  };

  return (
    <View style={styles.root} testID="agency-center">
      <Stack.Screen options={{ title: t.agencyCenter, headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.onSurface }} />
      {/* Iter-117 — working back arrow. */}
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm, flexDirection: "row" }]}>
        <Pressable testID="agency-back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/me" as any))} hitSlop={10} style={styles.topBack}>
          <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.topTitle}>{t.agencyCenter}</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView
        contentContainerStyle={{ paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.onSurface} />}
      >
        {my.isLoading ? (
          <ActivityIndicator color={colors.onSurface} style={{ padding: spacing.xxl }} />
        ) : my.data?.agency ? (
          <AgencySummaryCard
            name={my.data.agency.name}
            status={my.data.agency.status}
            role={my.data.role!}
            earnings={my.data.agency.earnings}
            onManage={isOwner ? () => router.push(`/agency/manage/${my.data!.agency!.id}` as any) : undefined}
            onLeave={!isOwner ? askLeave : undefined}
          />
        ) : (
          <FindAgencyPanel />
        )}

        {/* Owner earnings cards */}
        {isOwner && agEarnings.data && (
          <View style={styles.ownerStats}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>{t.agencyEarnings}</Text>
              <View style={styles.statValueRow}>
                <Diamond size={14} />
                <Text style={styles.statValue}>{fmt(agEarnings.data.available.agency)}</Text>
              </View>
              <Text style={styles.statSub}>of {fmt(agEarnings.data.available.gross)} {t.gross}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>{t.pendingEarnings}</Text>
              <View style={styles.statValueRow}>
                <Diamond size={14} />
                <Text style={styles.statValue}>{fmt(agEarnings.data.pending.agency)}</Text>
              </View>
              <Text style={styles.statSub}>{agEarnings.data.pending.entries} entries</Text>
            </View>
          </View>
        )}

        {/* Pending invitations */}
        <Text style={styles.sectionTitle}>{t.pendingInvitations}</Text>
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
          {invs.isLoading ? (
            <ActivityIndicator color={colors.onSurface} style={{ padding: spacing.xl }} />
          ) : (invs.data?.items.length ?? 0) === 0 ? (
            <View style={styles.inlineEmpty} testID="invites-empty">
              <Text style={styles.inlineEmptyText}>{t.noInvitations}</Text>
            </View>
          ) : (
            invs.data!.items.map((inv) => (
              <InvitationCard
                key={inv.id}
                inv={inv}
                onAccept={() => accept.mutate(inv.id)}
                onReject={() => reject.mutate(inv.id)}
                busy={accept.isPending || reject.isPending}
                acceptLabel={t.accept}
                rejectLabel={t.reject}
                fromLabel={t.invitationFrom}
              />
            ))
          )}
        </View>

        <Pressable
          style={styles.ghostLink}
          onPress={() => router.push("/earnings")}
          testID="agency-open-earnings"
        >
          <Icon name="trending-up" size={16} color={colors.gold} />
          <Text style={styles.ghostLinkText}>{t.earnings}</Text>
          <Icon name="chevron-forward" size={16} color={colors.muted} />
        </Pressable>
      </ScrollView>
    </View>
  );
}


function FindAgencyPanel() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [lookup, setLookup] = useState<Awaited<ReturnType<typeof apiAgencyLookup>> | null>(null);

  const myRequests = useQuery({ queryKey: ["me", "join-requests"], queryFn: apiMyJoinRequests });

  const doLookup = useMutation({
    mutationFn: () => apiAgencyLookup(input.trim()),
    onSuccess: (res) => { setLookup(res); setErr(null); },
    onError: (e: Error) => { setLookup(null); setErr(e instanceof ApiError ? e.message : "Lookup failed"); },
  });
  const doJoin = useMutation({
    mutationFn: (agencyId: string) => apiCreateJoinRequest(agencyId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me", "join-requests"] });
      setLookup(null); setInput("");
    },
    onError: (e: Error) => setErr(e instanceof ApiError ? e.message : "Join failed"),
  });
  const doCancel = useMutation({
    mutationFn: (reqId: string) => apiCancelMyJoinRequest(reqId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me", "join-requests"] }),
  });

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} testID="agency-find">
      <View style={styles.findCard}>
        <Icon name="search" size={28} color={colors.gold} />
        <Text style={styles.findTitle}>Find an Agency</Text>
        <Text style={styles.findSub}>Enter the exact Agency ID shared by the agency owner.</Text>
        <View style={styles.findRow}>
          <TextInput
            value={input}
            onChangeText={(v) => { setInput(v); setErr(null); }}
            placeholder="Agency ID"
            placeholderTextColor={colors.muted}
            style={styles.findInput}
            autoCapitalize="none"
            autoCorrect={false}
            testID="agency-id-input"
          />
          <Pressable
            style={[styles.findBtn, (!input.trim() || doLookup.isPending) && { opacity: 0.5 }]}
            onPress={() => doLookup.mutate()}
            disabled={!input.trim() || doLookup.isPending}
            testID="agency-lookup-btn"
          >
            {doLookup.isPending ? <ActivityIndicator color={colors.onBrandPrimary} /> :
              <Text style={styles.findBtnText}>Search</Text>}
          </Pressable>
        </View>
        {err && <Text style={styles.findErr} testID="agency-lookup-err">{err}</Text>}
      </View>

      {lookup && (
        <View style={styles.findResult} testID="agency-lookup-result">
          <View style={styles.summaryIcon}>
            <Icon name="business" size={26} color={colors.gold} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.findResName}>{lookup.agency.name}</Text>
            <Text style={styles.findResId}>ID: {lookup.agency.id}</Text>
            <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
              <View style={styles.pill}><Text style={styles.pillText}>{lookup.agency.status.toUpperCase()}</Text></View>
            </View>
          </View>
          {lookup.my_membership_status === "active" ? (
            <View style={[styles.pill, { backgroundColor: colors.success + "33" }]}>
              <Text style={[styles.pillText, { color: colors.success }]}>MEMBER</Text>
            </View>
          ) : lookup.pending_request_id ? (
            <View style={[styles.pill, { backgroundColor: colors.warning + "33" }]}>
              <Text style={[styles.pillText, { color: colors.warning }]}>PENDING</Text>
            </View>
          ) : (
            <Pressable
              style={[styles.btn, styles.btnPrimary, { flex: 0, paddingHorizontal: 14 }, doJoin.isPending && { opacity: 0.5 }]}
              onPress={() => doJoin.mutate(lookup.agency.id)}
              disabled={doJoin.isPending}
              testID="agency-join-btn"
            >
              {doJoin.isPending ? <ActivityIndicator color={colors.onBrandPrimary} /> :
                <Text style={styles.btnPrimaryText}>Join Agency</Text>}
            </Pressable>
          )}
        </View>
      )}

      {(myRequests.data?.items.length ?? 0) > 0 && (
        <>
          <Text style={styles.sectionTitle}>Join request pending approval</Text>
          {myRequests.data!.items.map((r) => (
            <View key={r.id} style={styles.findResult} testID={`my-join-${r.id}`}>
              <View style={styles.summaryIcon}>
                <Icon name="hourglass" size={20} color={colors.warning} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.findResName}>{r.agency?.name ?? r.agency_id}</Text>
                <Text style={styles.findResId}>Pending owner approval</Text>
              </View>
              <Pressable
                style={[styles.btn, styles.btnDanger, { flex: 0, paddingHorizontal: 10 }]}
                onPress={() => doCancel.mutate(r.id)}
                testID={`my-join-cancel-${r.id}`}
              >
                <Text style={styles.btnDangerText}>Cancel</Text>
              </Pressable>
            </View>
          ))}
        </>
      )}
      <Text style={styles.diamondHint}>{t.noAgencyHint}</Text>
    </KeyboardAvoidingView>
  );
}


function AgencySummaryCard({
  name, status, role, earnings, onManage, onLeave,
}: {
  name: string; status: string; role: "HOST" | "AGENCY_OWNER";
  earnings: number;
  onManage?: () => void; onLeave?: () => void;
}) {
  const { t } = useI18n();
  return (
    <View style={styles.summary} testID="agency-summary">
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View style={styles.summaryIcon}>
          <Icon name="business" size={26} color={colors.gold} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.summaryName} numberOfLines={1}>{name}</Text>
          <View style={{ flexDirection: "row", gap: 6, marginTop: 4, alignItems: "center" }}>
            <View style={styles.pill}>
              <Text style={styles.pillText}>{role === "AGENCY_OWNER" ? "OWNER" : "HOST"}</Text>
            </View>
            <View style={[styles.pill, { backgroundColor: colors.surfaceTertiary }]}>
              <Text style={styles.pillText}>{status.toUpperCase()}</Text>
            </View>
          </View>
        </View>
      </View>
      {role === "AGENCY_OWNER" && (
        <View style={{ marginTop: spacing.md, flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text style={{ color: colors.muted, fontSize: 12 }}>{t.agencyEarnings}:</Text>
          <Diamond size={12} />
          <Text style={{ color: colors.onSurface, fontWeight: "800" }}>{fmt(earnings)}</Text>
        </View>
      )}
      <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg }}>
        {onManage && (
          <Pressable style={[styles.btn, styles.btnPrimary]} onPress={onManage} testID="agency-manage-btn">
            <Icon name="settings" size={16} color={colors.onBrandPrimary} />
            <Text style={styles.btnPrimaryText}>{t.manageAgency}</Text>
          </Pressable>
        )}
        {onLeave && (
          <Pressable style={[styles.btn, styles.btnDanger]} onPress={onLeave} testID="agency-leave-btn">
            <Icon name="log-out" size={16} color={colors.error} />
            <Text style={styles.btnDangerText}>{t.leaveAgency}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function InvitationCard({
  inv, onAccept, onReject, busy, acceptLabel, rejectLabel, fromLabel,
}: {
  inv: InvitationRow;
  onAccept: () => void; onReject: () => void; busy: boolean;
  acceptLabel: string; rejectLabel: string; fromLabel: string;
}) {
  const name = inv.agency?.name ?? "Unknown agency";
  return (
    <View style={styles.invCard} testID={`inv-${inv.id}`}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <View style={styles.invIcon}>
          <Icon name="mail" size={18} color={colors.info} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.invTitle}>{name}</Text>
          <Text style={styles.invSub}>{fromLabel} {inv.invited_by.slice(0, 8)}…</Text>
          {inv.message ? <Text style={styles.invMsg}>&ldquo;{inv.message}&rdquo;</Text> : null}
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
        <Pressable
          style={[styles.btn, styles.btnPrimary]}
          onPress={onAccept}
          disabled={busy}
          testID={`inv-accept-${inv.id}`}
        >
          <Text style={styles.btnPrimaryText}>{acceptLabel}</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.btnGhost]}
          onPress={onReject}
          disabled={busy}
          testID={`inv-reject-${inv.id}`}
        >
          <Text style={styles.btnGhostText}>{rejectLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { alignItems: "center", paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  topBack: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  topTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  root: { flex: 1, backgroundColor: colors.surface },
  empty: {
    marginHorizontal: spacing.lg, padding: spacing.xl, borderRadius: radius.lg,
    backgroundColor: colors.surfaceSecondary, alignItems: "center", gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  emptyTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "800" },
  emptySub: { color: colors.muted, fontSize: 12, textAlign: "center", lineHeight: 18 },
  summary: {
    marginHorizontal: spacing.lg, padding: spacing.lg, borderRadius: radius.lg,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  summaryIcon: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: colors.gold + "22", alignItems: "center", justifyContent: "center",
  },
  summaryName: { color: colors.onSurface, fontSize: 18, fontWeight: "900" },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.gold + "33" },
  pillText: { color: colors.onSurface, fontSize: 10, fontWeight: "800", letterSpacing: 0.4 },
  ownerStats: { flexDirection: "row", gap: spacing.sm, marginHorizontal: spacing.lg, marginTop: spacing.md },
  statCard: {
    flex: 1, padding: spacing.md, borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  statLabel: { color: colors.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  statValueRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  statValue: { color: colors.onSurface, fontSize: 20, fontWeight: "900" },
  statSub: { color: colors.muted, fontSize: 10, marginTop: 2 },
  sectionTitle: { color: colors.onSurface, fontSize: 14, fontWeight: "800", marginHorizontal: spacing.lg, marginTop: spacing.xl, marginBottom: spacing.sm, letterSpacing: 0.4 },
  invCard: {
    backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  invIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.info + "22", alignItems: "center", justifyContent: "center" },
  invTitle: { color: colors.onSurface, fontSize: 14, fontWeight: "800" },
  invSub: { color: colors.muted, fontSize: 11, marginTop: 2 },
  invMsg: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 4, fontStyle: "italic" },
  inlineEmpty: { padding: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, alignItems: "center" },
  inlineEmptyText: { color: colors.muted, fontSize: 12 },
  btn: {
    flex: 1, paddingVertical: 10, paddingHorizontal: spacing.md, borderRadius: radius.md,
    alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6,
  },
  btnPrimary: { backgroundColor: colors.brandPrimary },
  btnPrimaryText: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 13 },
  btnGhost: { backgroundColor: colors.surfaceTertiary },
  btnGhostText: { color: colors.onSurface, fontWeight: "700", fontSize: 13 },
  btnDanger: { backgroundColor: colors.error + "22", borderWidth: 1, borderColor: colors.error + "66" },
  btnDangerText: { color: colors.error, fontWeight: "800", fontSize: 13 },
  ghostLink: {
    marginHorizontal: spacing.lg, marginTop: spacing.xl,
    padding: spacing.md, borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
  },
  ghostLinkText: { flex: 1, color: colors.onSurface, fontWeight: "700", fontSize: 14 },
  // FindAgency panel
  findCard: { marginHorizontal: spacing.lg, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, alignItems: "center", gap: 8 },
  findTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "900" },
  findSub: { color: colors.muted, fontSize: 12, textAlign: "center", lineHeight: 18 },
  findRow: { flexDirection: "row", gap: 8, alignSelf: "stretch", marginTop: spacing.sm },
  findInput: { flex: 1, backgroundColor: colors.surface, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, fontSize: 14 },
  findBtn: { paddingHorizontal: 16, borderRadius: radius.md, backgroundColor: colors.brandPrimary, justifyContent: "center" },
  findBtnText: { color: colors.onBrandPrimary, fontWeight: "900" },
  findErr: { color: colors.error, fontSize: 12, textAlign: "center" },
  findResult: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  findResName: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  findResId: { color: colors.muted, fontSize: 11, marginTop: 2 },
  diamondHint: { color: colors.muted, fontSize: 11, textAlign: "center", marginTop: spacing.lg, paddingHorizontal: spacing.lg, fontStyle: "italic" },
});
