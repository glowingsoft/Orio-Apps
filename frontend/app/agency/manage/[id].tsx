import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  RefreshControl, TextInput, Modal, KeyboardAvoidingView, Platform,
} from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import {
  apiAgencyGet, apiAgencyHosts, apiAgencyInvitations, apiAgencyInvite,
  apiAgencyCancelInvite, apiAgencyEarnings, apiAgencyTransactions,
  apiAgencySuspendHost, apiAgencyReactivateHost, apiAgencyRemoveHost,
  type AgencyHostRow, type InvitationRow, type LedgerEntry, ApiError,
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

function fmtDate(iso?: string) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch { return iso; }
}

type Tab = "hosts" | "invites" | "transactions";

export default function AgencyManageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const agencyId = String(id ?? "");
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("hosts");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const agency = useQuery({ queryKey: ["agency", agencyId], queryFn: () => apiAgencyGet(agencyId), enabled: !!agencyId });
  const earnings = useQuery({ queryKey: ["agency", agencyId, "earnings"], queryFn: () => apiAgencyEarnings(agencyId), enabled: !!agencyId });
  const hosts = useQuery({ queryKey: ["agency", agencyId, "hosts"], queryFn: () => apiAgencyHosts(agencyId), enabled: !!agencyId });
  const invites = useQuery({ queryKey: ["agency", agencyId, "invites"], queryFn: () => apiAgencyInvitations(agencyId, "pending"), enabled: !!agencyId });
  const txns = useQuery({ queryKey: ["agency", agencyId, "txns"], queryFn: () => apiAgencyTransactions(agencyId), enabled: !!agencyId });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["agency", agencyId] });
    qc.invalidateQueries({ queryKey: ["me", "agency"] });
  };

  const suspend = useMutation({ mutationFn: (uid: string) => apiAgencySuspendHost(agencyId, uid), onSuccess: invalidateAll });
  const reactivate = useMutation({ mutationFn: (uid: string) => apiAgencyReactivateHost(agencyId, uid), onSuccess: invalidateAll });
  const remove = useMutation({ mutationFn: (uid: string) => apiAgencyRemoveHost(agencyId, uid), onSuccess: invalidateAll });
  const cancelInv = useMutation({ mutationFn: (inv_id: string) => apiAgencyCancelInvite(agencyId, inv_id), onSuccess: invalidateAll });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([agency.refetch(), earnings.refetch(), hosts.refetch(), invites.refetch(), txns.refetch()]);
    setRefreshing(false);
  }, [agency, earnings, hosts, invites, txns]);

  if (!agencyId) {
    return <View style={styles.root}><Text style={styles.err}>Missing agency id</Text></View>;
  }

  return (
    <View style={styles.root} testID="agency-manage">
      <Stack.Screen options={{
        title: agency.data?.name ?? t.manageAgency,
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.onSurface,
      }} />
      <ScrollView
        contentContainerStyle={{ paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.onSurface} />}
      >
        {/* HEADER */}
        {agency.isLoading ? (
          <ActivityIndicator color={colors.onSurface} style={{ padding: spacing.xxl }} />
        ) : agency.data ? (
          <View style={styles.header}>
            <View style={styles.headerIcon}><Icon name="business" size={28} color={colors.gold} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerName}>{agency.data.name}</Text>
              <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
                <View style={styles.pill}><Text style={styles.pillText}>{agency.data.status.toUpperCase()}</Text></View>
                <View style={[styles.pill, { backgroundColor: colors.surfaceTertiary }]}>
                  <Text style={styles.pillText}>{hosts.data?.items.filter((h) => h.status === "active").length ?? 0} {t.activeHosts}</Text>
                </View>
              </View>
            </View>
          </View>
        ) : null}

        {/* EARNINGS SNAPSHOT */}
        {earnings.data && (
          <View style={styles.statRow}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>{t.availableEarnings}</Text>
              <View style={styles.statValueRow}>
                <Diamond size={14} />
                <Text style={styles.statValue}>{fmt(earnings.data.available.agency)}</Text>
              </View>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>{t.gross}</Text>
              <View style={styles.statValueRow}>
                <Diamond size={14} />
                <Text style={styles.statValue}>{fmt(earnings.data.available.gross)}</Text>
              </View>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>{t.pendingEarnings}</Text>
              <View style={styles.statValueRow}>
                <Diamond size={14} />
                <Text style={styles.statValue}>{fmt(earnings.data.pending.agency)}</Text>
              </View>
            </View>
          </View>
        )}

        {/* TABS */}
        <View style={styles.tabs}>
          {([
            ["hosts", t.hostsLabel],
            ["invites", t.pendingInvitations],
            ["transactions", t.transactionHistory],
          ] as [Tab, string][]).map(([k, l]) => (
            <Pressable
              key={k}
              onPress={() => setTab(k)}
              style={[styles.tabBtn, tab === k && styles.tabBtnActive]}
              testID={`tab-${k}`}
            >
              <Text style={[styles.tabText, tab === k && styles.tabTextActive]}>{l}</Text>
            </Pressable>
          ))}
        </View>

        {/* INVITE BUTTON (hosts & invites tabs) */}
        {tab !== "transactions" && (
          <Pressable
            style={styles.inviteBtn}
            onPress={() => setInviteOpen(true)}
            testID="open-invite"
          >
            <Icon name="person-add" size={18} color={colors.onBrandPrimary} />
            <Text style={styles.inviteBtnText}>{t.inviteHost}</Text>
          </Pressable>
        )}

        {/* TAB CONTENT */}
        <View style={{ paddingHorizontal: spacing.lg, marginTop: spacing.md, gap: spacing.sm }}>
          {tab === "hosts" && (
            hosts.isLoading ? <ActivityIndicator color={colors.onSurface} /> :
            (hosts.data?.items.length ?? 0) === 0 ? <EmptyRow text={t.noHosts} /> :
            hosts.data!.items.map((h) => (
              <HostRow
                key={h.id}
                host={h}
                onSuspend={() => suspend.mutate(h.user_id)}
                onReactivate={() => reactivate.mutate(h.user_id)}
                onRemove={() => confirmDialog(t.remove, `Remove this host?`, [
                  { text: t.cancel, style: "cancel" },
                  { text: t.remove, style: "destructive", onPress: () => remove.mutate(h.user_id) },
                ])}
              />
            ))
          )}
          {tab === "invites" && (
            invites.isLoading ? <ActivityIndicator color={colors.onSurface} /> :
            (invites.data?.items.length ?? 0) === 0 ? <EmptyRow text={t.noInvitations} /> :
            invites.data!.items.map((inv) => (
              <PendingInviteRow
                key={inv.id}
                inv={inv}
                cancelLabel={t.cancelInvite}
                onCancel={() => cancelInv.mutate(inv.id)}
              />
            ))
          )}
          {tab === "transactions" && (
            txns.isLoading ? <ActivityIndicator color={colors.onSurface} /> :
            (txns.data?.items.length ?? 0) === 0 ? <EmptyRow text={t.noTransactions} /> :
            txns.data!.items.map((it) => <TxRow key={it.transaction_id} it={it} />)
          )}
        </View>
      </ScrollView>

      <InviteModal
        visible={inviteOpen}
        onClose={() => setInviteOpen(false)}
        agencyId={agencyId}
        onDone={() => { setInviteOpen(false); invalidateAll(); }}
      />
    </View>
  );
}

function HostRow({
  host, onSuspend, onReactivate, onRemove,
}: {
  host: AgencyHostRow;
  onSuspend: () => void; onReactivate: () => void; onRemove: () => void;
}) {
  const isOwner = host.role === "AGENCY_OWNER";
  const canAct = !isOwner;
  const statusCol =
    host.status === "active" ? colors.success :
    host.status === "suspended" ? colors.warning : colors.muted;
  return (
    <View style={styles.listRow} testID={`host-${host.user_id}`}>
      <View style={styles.avatarCircle}>
        <Icon name="person" size={16} color={colors.onSurface} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.listName} numberOfLines={1}>
          {host.user?.nickname ?? host.user_id.slice(0, 10)}
        </Text>
        <View style={{ flexDirection: "row", gap: 6, marginTop: 2, alignItems: "center" }}>
          {isOwner && <View style={styles.rolePill}><Text style={styles.rolePillText}>OWNER</Text></View>}
          <View style={[styles.statusDot, { backgroundColor: statusCol }]} />
          <Text style={styles.listSub}>{host.status}</Text>
          {host.host_earnings != null && (
            <>
              <Text style={styles.listSub}>·</Text>
              <Diamond size={10} />
              <Text style={styles.listSub}>{fmt(host.host_earnings)}</Text>
            </>
          )}
        </View>
      </View>
      {canAct && (
        <View style={{ flexDirection: "row", gap: 4 }}>
          {host.status === "active" ? (
            <Pressable style={styles.iconBtn} onPress={onSuspend} testID={`suspend-${host.user_id}`}>
              <Icon name="pause" size={16} color={colors.warning} />
            </Pressable>
          ) : host.status === "suspended" ? (
            <Pressable style={styles.iconBtn} onPress={onReactivate} testID={`reactivate-${host.user_id}`}>
              <Icon name="play" size={16} color={colors.success} />
            </Pressable>
          ) : null}
          {host.status !== "removed" && (
            <Pressable style={styles.iconBtn} onPress={onRemove} testID={`remove-${host.user_id}`}>
              <Icon name="trash" size={16} color={colors.error} />
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

function PendingInviteRow({
  inv, cancelLabel, onCancel,
}: {
  inv: InvitationRow; cancelLabel: string; onCancel: () => void;
}) {
  return (
    <View style={styles.listRow} testID={`invite-${inv.id}`}>
      <View style={[styles.avatarCircle, { backgroundColor: colors.info + "22" }]}>
        <Icon name="mail" size={16} color={colors.info} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.listName} numberOfLines={1}>
          {inv.user?.nickname ?? inv.user?.username ?? inv.user_id.slice(0, 10)}
        </Text>
        <Text style={styles.listSub}>#{inv.user?.numeric_id ?? inv.user_id.slice(0, 6)} · {fmtDate(inv.created_at)}</Text>
      </View>
      <Pressable style={styles.iconBtn} onPress={onCancel} testID={`cancel-${inv.id}`}>
        <Icon name="close" size={16} color={colors.error} />
      </Pressable>
    </View>
  );
}

function TxRow({ it }: { it: LedgerEntry }) {
  const isReversal = it.type === "reversal";
  return (
    <View style={styles.listRow} testID={`agency-tx-${it.transaction_id}`}>
      <View style={[styles.avatarCircle, { backgroundColor: (isReversal ? colors.error : colors.success) + "22" }]}>
        <Icon name={isReversal ? "arrow-undo" : "gift"} size={16} color={isReversal ? colors.error : colors.success} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.listName} numberOfLines={1}>{it.source} · {it.status}</Text>
        <Text style={styles.listSub}>{fmtDate(it.created_at)}</Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          <Text style={{ color: isReversal ? colors.error : colors.success, fontWeight: "900" }}>
            {isReversal ? "−" : "+"}{fmt(Math.abs(it.agency_amount))}
          </Text>
          <Diamond size={10} />
        </View>
        <Text style={styles.listSub}>of {fmt(Math.abs(it.gross_amount))}</Text>
      </View>
    </View>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <View style={styles.empty}><Text style={styles.emptyText}>{text}</Text></View>
  );
}

function InviteModal({
  visible, onClose, agencyId, onDone,
}: {
  visible: boolean; onClose: () => void; agencyId: string; onDone: () => void;
}) {
  const { t } = useI18n();
  const [ident, setIdent] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const invite = useMutation({
    mutationFn: () => apiAgencyInvite(agencyId, ident.trim(), msg.trim() || undefined),
    onSuccess: () => { setIdent(""); setMsg(""); setErr(null); onDone(); },
    onError: (e: Error) => setErr(e instanceof ApiError ? e.message : "Failed"),
  });
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.modalSheet} testID="invite-modal">
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={styles.modalTitle}>{t.inviteHost}</Text>
              <View style={{ flex: 1 }} />
              <Pressable onPress={onClose} testID="invite-close"><Icon name="close" size={22} color={colors.muted} /></Pressable>
            </View>
            <Text style={styles.modalHint}>{t.inviteHint}</Text>
            <TextInput
              value={ident}
              onChangeText={setIdent}
              placeholder="12345678 / username / email"
              placeholderTextColor={colors.muted}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              testID="invite-input"
            />
            <TextInput
              value={msg}
              onChangeText={setMsg}
              placeholder={t.optionalMessage}
              placeholderTextColor={colors.muted}
              style={[styles.input, { height: 80, textAlignVertical: "top" }]}
              multiline
              testID="invite-msg"
            />
            {err && <Text style={styles.err}>{err}</Text>}
            <Pressable
              style={[styles.sendBtn, (!ident.trim() || invite.isPending) && { opacity: 0.5 }]}
              onPress={() => { setErr(null); invite.mutate(); }}
              disabled={!ident.trim() || invite.isPending}
              testID="invite-submit"
            >
              {invite.isPending ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
                <>
                  <Icon name="paper-plane" size={16} color={colors.onBrandPrimary} />
                  <Text style={styles.sendBtnText}>{t.sendInvite}</Text>
                </>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  err: { color: colors.error, fontSize: 12, textAlign: "center" },
  header: {
    marginHorizontal: spacing.lg, padding: spacing.lg, borderRadius: radius.lg,
    backgroundColor: colors.surfaceSecondary, flexDirection: "row", alignItems: "center", gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  headerIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.gold + "22", alignItems: "center", justifyContent: "center" },
  headerName: { color: colors.onSurface, fontSize: 20, fontWeight: "900" },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.gold + "33" },
  pillText: { color: colors.onSurface, fontSize: 10, fontWeight: "800", letterSpacing: 0.4 },
  statRow: { flexDirection: "row", gap: spacing.sm, marginHorizontal: spacing.lg, marginTop: spacing.md },
  statCard: {
    flex: 1, padding: spacing.md, borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  statLabel: { color: colors.muted, fontSize: 10, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  statValueRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  statValue: { color: colors.onSurface, fontSize: 16, fontWeight: "900" },
  tabs: { flexDirection: "row", marginHorizontal: spacing.lg, marginTop: spacing.xl, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, padding: 4 },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: radius.sm, alignItems: "center" },
  tabBtnActive: { backgroundColor: colors.surfaceElevated },
  tabText: { color: colors.muted, fontWeight: "700", fontSize: 12 },
  tabTextActive: { color: colors.onSurface },
  inviteBtn: {
    marginHorizontal: spacing.lg, marginTop: spacing.md,
    backgroundColor: colors.brandPrimary, padding: spacing.md, borderRadius: radius.md,
    flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8,
  },
  inviteBtnText: { color: colors.onBrandPrimary, fontWeight: "900" },
  listRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  avatarCircle: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },
  listName: { color: colors.onSurface, fontSize: 14, fontWeight: "800" },
  listSub: { color: colors.muted, fontSize: 11 },
  rolePill: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: colors.gold + "33" },
  rolePillText: { color: colors.gold, fontSize: 9, fontWeight: "900" },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  iconBtn: { padding: 8, borderRadius: 10, backgroundColor: colors.surfaceTertiary },
  empty: { padding: spacing.xl, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, alignItems: "center" },
  emptyText: { color: colors.muted, fontSize: 12 },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.overlay },
  modalSheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.lg, gap: spacing.md,
  },
  modalTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "900" },
  modalHint: { color: colors.muted, fontSize: 12 },
  input: {
    backgroundColor: colors.surfaceSecondary, color: colors.onSurface,
    paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, fontSize: 14,
  },
  sendBtn: {
    backgroundColor: colors.brandPrimary, padding: spacing.md, borderRadius: radius.md,
    alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8,
  },
  sendBtnText: { color: colors.onBrandPrimary, fontWeight: "900" },
});
