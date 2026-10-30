/**
 * Iter-118 — Admin: complete user management page.
 * Every control calls a permission-gated backend endpoint; sections the admin
 * lacks permission for are hidden (and rejected server-side anyway).
 */
import { CountryFlag } from "@/src/components/CountryFlag";
import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator, Image, Alert, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { safeBack } from "@/src/navigation/safeBack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminShell, adminStyles, useAdminCan } from "@/src/components/AdminShell";
import { adminP1 } from "@/src/api";
import { colors, spacing } from "@/src/theme";

const fmt = (s?: string | null) => (s ? new Date(s).toLocaleString() : "—");
const notify = (title: string, msg: string) => (Platform.OS === "web" ? window.alert(`${title}\n${msg}`) : Alert.alert(title, msg));

function Section({ title, children, testID }: { title: string; children: React.ReactNode; testID?: string }) {
  return (
    <View style={[adminStyles.card, { marginBottom: spacing.md }]} testID={testID}>
      <Text style={adminStyles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function KV({ k, v }: { k: string; v: any }) {
  return (
    <View style={styles.kv}><Text style={styles.k}>{k}</Text><Text style={styles.v} selectable>{v == null || v === "" ? "—" : String(v)}</Text></View>
  );
}

function Btn({ label, onPress, danger, testID, disabled }: { label: string; onPress: () => void; danger?: boolean; testID?: string; disabled?: boolean }) {
  return (
    <Pressable testID={testID} disabled={disabled} onPress={onPress} style={[danger ? adminStyles.dangerBtn : adminStyles.primaryBtn, disabled && { opacity: 0.5 }]}>
      <Text style={danger ? adminStyles.dangerBtnText : adminStyles.primaryBtnText}>{label}</Text>
    </Pressable>
  );
}

export default function AdminUserDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const can = useAdminCan();
  const d = useQuery({ queryKey: ["admin", "user", id], queryFn: () => adminP1.detail(id!), enabled: !!id, refetchInterval: 15_000 });
  const [relKind, setRelKind] = useState("followers");
  const rel = useQuery({ queryKey: ["admin", "rel", id, relKind], queryFn: () => adminP1.relations(id!, relKind), enabled: !!id && can("users.view") });
  const txs = useQuery({ queryKey: ["admin", "txs", id], queryFn: () => adminP1.txs(id!), enabled: !!id && can("wallet.view") });
  const lh = useQuery({ queryKey: ["admin", "lh", id], queryFn: () => adminP1.levelHistory(id!), enabled: !!id });
  const bans = useQuery({ queryKey: ["admin", "ubans", id], queryFn: () => adminP1.userBans(id!), enabled: !!id && can("bans.view") });

  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"coins" | "diamonds">("coins");
  const [lvSys, setLvSys] = useState<"wealth" | "charm" | "vip">("wealth");
  const [lvVal, setLvVal] = useState("");
  const [banType, setBanType] = useState<"account" | "device" | "both">("account");
  const [customH, setCustomH] = useState("");
  const [nick, setNick] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshAll = () => qc.invalidateQueries({ queryKey: ["admin"] });
  const run = async (fn: () => Promise<any>, okMsg: string) => {
    if (reason.trim().length < 2) { notify("Reason required", "Enter a reason (it is recorded in the audit log)."); return; }
    setBusy(true);
    try { await fn(); notify("Done", okMsg); refreshAll(); } catch (e: any) { notify("Error", e?.message || "Failed"); } finally { setBusy(false); }
  };

  const u = d.data;
  return (
    <AdminShell title="User Management">
      <Pressable onPress={() => safeBack(router)} testID="admin-user-back" style={[adminStyles.ghostBtn, { alignSelf: "flex-start", marginBottom: spacing.md }]}>
        <Text style={adminStyles.ghostBtnText}>← Back</Text>
      </Pressable>
      {d.isLoading ? <ActivityIndicator color={colors.brandPrimary} /> : !u ? (
        <Text style={{ color: colors.error }}>{(d.error as any)?.message || "Not found"}</Text>
      ) : (
        <View>
          <Section title="Profile" testID="admin-user-profile">
            <View style={{ flexDirection: "row", gap: spacing.md, alignItems: "center", marginBottom: spacing.md }}>
              {u.animated_avatar_url || u.avatar_url ? <Image source={{ uri: u.animated_avatar_url || u.avatar_url }} style={styles.avatar} /> : <View style={[styles.avatar, { backgroundColor: colors.brandPrimary }]} />}
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Text style={styles.name}>{u.nickname}</Text><CountryFlag code={u.country_code} flag={u.country_flag} size={18} /></View>
                <Text style={styles.sub}>@{u.username} · ID {u.numeric_id} · {u.email}</Text>
                {u.active_ban && <Text style={{ color: colors.error, fontWeight: "800" }} testID="admin-user-banned">BANNED ({u.active_ban.type}) until {u.active_ban.expires_at ? fmt(u.active_ban.expires_at) : "PERMANENT"}</Text>}
              </View>
            </View>
            <KV k="Age / Gender" v={`${u.age ?? "—"} / ${u.gender ?? "—"}`} />
            <KV k="Country" v={u.country_code} />
            <KV k="Registered" v={fmt(u.created_at)} />
            <KV k="Last activity" v={fmt(u.last_active_at)} />
            <KV k="Login providers" v={(u.providers || []).join(", ")} />
            <KV k="Known devices" v={(u.device_ids || []).length} />
            <KV k="Followers / Following / Friends" v={`${u.counts.followers} / ${u.counts.following} / ${u.counts.friends}`} />
            <KV k="Blocked / Blocked by" v={`${u.counts.blocked} / ${u.counts.blocked_by}`} />
          </Section>

          <Section title="Action reason (required, audited)">
            <TextInput testID="admin-reason" value={reason} onChangeText={setReason} placeholder="Reason for any action below" placeholderTextColor={colors.muted} style={adminStyles.input} />
          </Section>

          {can("users.edit_profile") && (
            <Section title="Edit profile" testID="admin-user-edit">
              <View style={styles.row}>
                <TextInput testID="admin-edit-nickname" value={nick} onChangeText={setNick} placeholder={`Nickname (${u.nickname})`} placeholderTextColor={colors.muted} style={[adminStyles.input, { flex: 1 }]} />
                <Btn testID="admin-save-nickname" label="Save" disabled={busy || !nick.trim()} onPress={() => run(() => adminP1.editProfile(u.id, { nickname: nick.trim(), reason }), "Nickname updated")} />
                <Btn testID="admin-reset-avatar" label="Reset avatar" danger disabled={busy} onPress={() => run(() => adminP1.editProfile(u.id, { reset_avatar: true, reason }), "Avatar removed")} />
              </View>
            </Section>
          )}

          {can("wallet.view") && (
            <Section title={`Wallet — 🪙 ${u.coins.toLocaleString()} · 💎 ${u.diamonds.toLocaleString()}`} testID="admin-user-wallet">
              {can("wallet.adjust") && (
                <View style={styles.row}>
                  {(["coins", "diamonds"] as const).map((c) => (
                    <Pressable key={c} onPress={() => setCurrency(c)} style={[adminStyles.ghostBtn, currency === c && { borderColor: colors.brandPrimary }]}><Text style={adminStyles.ghostBtnText}>{c}</Text></Pressable>
                  ))}
                  <TextInput testID="admin-wallet-amount" value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="Amount" placeholderTextColor={colors.muted} style={[adminStyles.input, { width: 140 }]} />
                  <Btn testID="admin-wallet-credit" label="Recharge +" disabled={busy || !Number(amount)} onPress={() => run(() => adminP1.wallet(u.id, { currency, delta: Math.abs(parseInt(amount, 10)), reason }), "Credited")} />
                  <Btn testID="admin-wallet-debit" label="Deduct −" danger disabled={busy || !Number(amount)} onPress={() => run(() => adminP1.wallet(u.id, { currency, delta: -Math.abs(parseInt(amount, 10)), reason }), "Deducted")} />
                </View>
              )}
              <Text style={styles.small}>Ledger entries are immutable; corrections are recorded as new entries.</Text>
              {(txs.data?.items || []).slice(0, 50).map((x: any) => (
                <Text key={x.id} style={styles.line}>{fmt(x.created_at)} · {x.type} · {x.amount > 0 ? "+" : ""}{x.amount} {x.currency} → {x.balance_after ?? "—"} · {x.description || ""}</Text>
              ))}
            </Section>
          )}

          <Section title={`Levels — VIP ${u.vip_level} · Wealth LV${u.wealth_level} (${u.wealth_points.toLocaleString()}) · Charm LV${u.charm_level} (${u.charm_points.toLocaleString()})`} testID="admin-user-levels">
            {can("users.levels") && (
              <View style={styles.row}>
                {(["wealth", "charm", "vip"] as const).map((s) => (
                  <Pressable key={s} testID={`admin-lv-sys-${s}`} onPress={() => setLvSys(s)} style={[adminStyles.ghostBtn, lvSys === s && { borderColor: colors.brandPrimary }]}><Text style={adminStyles.ghostBtnText}>{s}</Text></Pressable>
                ))}
                <TextInput testID="admin-lv-value" value={lvVal} onChangeText={setLvVal} keyboardType="numeric" placeholder={lvSys === "vip" ? "0–10" : "0–51"} placeholderTextColor={colors.muted} style={[adminStyles.input, { width: 100 }]} />
                <Btn testID="admin-lv-apply" label="Set level" disabled={busy || lvVal === ""} onPress={() => run(() => adminP1.setLevel(u.id, { system: lvSys, level: parseInt(lvVal, 10), reason }), "Level updated")} />
              </View>
            )}
            {(lh.data?.items || []).map((h: any, i: number) => (
              <Text key={i} style={styles.line}>{fmt(h.created_at)} · {h.system} LV{h.from} → LV{h.to} · {h.source}{h.admin_email ? ` by ${h.admin_email}` : ""}{h.reason ? ` · “${h.reason}”` : ""}</Text>
            ))}
          </Section>

          {can("bans.view") && (
            <Section title="Bans" testID="admin-user-bans">
              {can("bans.manage") && (
                <>
                  <View style={styles.row}>
                    {(["account", "device", "both"] as const).map((t) => (
                      <Pressable key={t} testID={`admin-ban-type-${t}`} onPress={() => setBanType(t)} style={[adminStyles.ghostBtn, banType === t && { borderColor: colors.error }]}><Text style={adminStyles.ghostBtnText}>{t}</Text></Pressable>
                    ))}
                  </View>
                  <View style={styles.row}>
                    {([["24h", 24], ["3 days", 72], ["7 days", 168]] as const).map(([l, h]) => (
                      <Btn key={l} testID={`admin-ban-${h}`} danger label={`Ban ${l}`} disabled={busy} onPress={() => run(() => adminP1.ban(u.id, { type: banType, hours: h, reason }), `Banned for ${l}`)} />
                    ))}
                    <TextInput testID="admin-ban-custom-hours" value={customH} onChangeText={setCustomH} keyboardType="numeric" placeholder="Custom hours" placeholderTextColor={colors.muted} style={[adminStyles.input, { width: 130 }]} />
                    <Btn testID="admin-ban-custom" danger label="Ban custom" disabled={busy || !Number(customH)} onPress={() => run(() => adminP1.ban(u.id, { type: banType, hours: Number(customH), reason }), "Banned")} />
                    <Btn testID="admin-ban-permanent" danger label="Permanent" disabled={busy} onPress={() => run(() => adminP1.ban(u.id, { type: banType, permanent: true, reason }), "Permanently banned")} />
                    {u.active_ban && <Btn testID="admin-unban" label="Remove ban" disabled={busy} onPress={() => run(() => adminP1.unban(u.id, reason), "Ban removed")} />}
                  </View>
                  <Text style={styles.small}>Device bans use a per-install device id; reinstalling the app or clearing browser data creates a new id (hardware ids are not available to apps).</Text>
                </>
              )}
              {(bans.data?.items || []).map((b: any) => (
                <Text key={b.id} style={styles.line}>{fmt(b.created_at)} · {b.type} · until {b.expires_at ? fmt(b.expires_at) : "permanent"} · {b.active ? "ACTIVE" : b.ended_reason} · by {b.created_by} · “{b.reason}”</Text>
              ))}
            </Section>
          )}

          {can("users.sessions") && (
            <Section title="Sessions">
              <Btn testID="admin-revoke-sessions" danger label="Sign out all devices" disabled={busy} onPress={() => run(() => adminP1.revokeSessions(u.id), "All sessions revoked")} />
            </Section>
          )}

          <Section title="Relationships" testID="admin-user-relations">
            <View style={styles.row}>
              {["followers", "following", "friends", "blocked", "blocked_by"].map((k) => (
                <Pressable key={k} testID={`admin-rel-${k}`} onPress={() => setRelKind(k)} style={[adminStyles.ghostBtn, relKind === k && { borderColor: colors.brandPrimary }]}><Text style={adminStyles.ghostBtnText}>{k}</Text></Pressable>
              ))}
            </View>
            {rel.isLoading ? <ActivityIndicator color={colors.brandPrimary} /> : (rel.data?.items || []).length === 0 ? <Text style={styles.small}>None</Text> : (rel.data?.items || []).map((r: any) => (
              <Pressable key={r.user_id} onPress={() => router.push(`/admin/user/${r.user_id}` as any)}>
                <Text style={[styles.line, { color: colors.brandPrimary }]}>{r.nickname || r.user_id} · ID {r.numeric_id || "—"} · {fmt(r.at)}</Text>
              </Pressable>
            ))}
          </Section>
        </View>
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 64, height: 64, borderRadius: 32 },
  name: { color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  sub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  kv: { flexDirection: "row", paddingVertical: 4, gap: spacing.md },
  k: { color: colors.muted, width: 220, fontSize: 13 },
  v: { color: colors.onSurface, flex: 1, fontSize: 13, fontWeight: "600" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: spacing.sm },
  small: { color: colors.muted, fontSize: 11, marginVertical: 4 },
  line: { color: colors.onSurfaceSecondary, fontSize: 12, paddingVertical: 3 },
});
