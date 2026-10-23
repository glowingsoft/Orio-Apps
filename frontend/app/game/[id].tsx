import { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput, Alert } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { apiPlayGame } from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { colors, spacing, radius } from "@/src/theme";
import { FoluCoin, FoluCoinAmount } from "@/src/components/FoluCoin";
import { Diamond, DiamondAmount } from "@/src/components/Diamond";

const CFG: Record<string, { name: string; icon: string; picks?: { key: string; label: string }[]; needsPick: boolean; description: string }> = {
  slots:    { name: "777 Slots",          icon: "🎰", needsPick: false, description: "Match 3 symbols. Three 7s pays 50x!" },
  lucky77:  { name: "Lucky 77",           icon: "🎲", needsPick: true,  picks: [{ key: "under", label: "Under 7 (2x)" }, { key: "7", label: "Exactly 7 (5x)" }, { key: "over", label: "Over 7 (2x)" }], description: "Bet on the sum of two dice." },
  dice:     { name: "Dice",               icon: "🎯", needsPick: true,  picks: [1, 2, 3, 4, 5, 6].map((n) => ({ key: String(n), label: String(n) })), description: "Pick a number 1-6. Match = 5x." },
  coinflip: { name: "Coin Flip",          icon: "🪙", needsPick: true,  picks: [{ key: "heads", label: "Heads" }, { key: "tails", label: "Tails" }], description: "50/50 win. Payout 2x." },
  cards:    { name: "Lucky Cards",        icon: "🃏", needsPick: true,  picks: [0, 1, 2, 3].map((n) => ({ key: String(n), label: `Card ${n + 1}` })), description: "Pick 1 of 4 cards. 3.5x on win." },
  guess:    { name: "Number Guess",       icon: "🔢", needsPick: true,  picks: Array.from({ length: 10 }, (_, i) => ({ key: String(i + 1), label: String(i + 1) })), description: "Guess 1-10. Match = 8x." },
  rps:      { name: "Rock Paper Scissors", icon: "✂️", needsPick: true, picks: [{ key: "rock", label: "🪨 Rock" }, { key: "paper", label: "📄 Paper" }, { key: "scissors", label: "✂️ Scissors" }], description: "Beat the computer. Win = 2x, Tie = refund." },
  scratch:  { name: "Scratch Card",       icon: "🎫", needsPick: false, description: "Match 3 symbols on a 3x3 grid. Up to 20x." },
  treasure: { name: "Treasure Boxes",     icon: "🎁", needsPick: true,  picks: [0, 1, 2, 3, 4].map((n) => ({ key: String(n), label: `Box ${n + 1}` })), description: "Open a box. Contents: 0x, 1x, 2x, 5x, 10x." },
  wheel:    { name: "Lucky Wheel",        icon: "🎡", needsPick: false, description: "Spin the wheel. 8 segments, up to 10x." },
};

export default function GameScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, refresh } = useAuth();
  const cfg = CFG[id!];
  const [bet, setBet] = useState("50");
  const [pick, setPick] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const play = async () => {
    setErr(null); setResult(null);
    const b = parseInt(bet, 10);
    if (!b || b < 10) { setErr("Minimum bet is 10 Diamonds"); return; }
    if (cfg.needsPick && !pick) { setErr("Please make a selection"); return; }
    setLoading(true);
    try {
      const r = await apiPlayGame(id!, b, pick || undefined);
      setResult(r);
      await refresh();
    } catch (e: any) { setErr(e.message || "Failed to play"); }
    finally { setLoading(false); }
  };

  if (!cfg) return null;

  return (
    <View style={styles.container} testID={`game-${id}-screen`}>
      <LinearGradient colors={[colors.purple, colors.purpleDeep, colors.surface]} style={StyleSheet.absoluteFill} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-btn" onPress={() => router.back()} style={styles.iconBtn}>
          <Icon name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{cfg.name}</Text>
        <View style={styles.balanceChip}>
          <DiamondAmount value={user?.coins ?? 0} size={14} />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl }}>
        {/* Icon showcase */}
        <View style={styles.showcase}>
          <Text style={styles.bigIcon}>{cfg.icon}</Text>
          <Text style={styles.desc}>{cfg.description}</Text>
        </View>

        {/* Result panel */}
        {result && (
          <View style={[styles.resultCard, { borderColor: result.win ? colors.success : result.net === 0 ? colors.gold : colors.error }]} testID="game-result">
            <ResultView game={id!} result={result} />
            <Text style={[styles.resultLabel, { color: result.win ? colors.success : result.net === 0 ? colors.gold : colors.error }]}>
              {result.win ? "🎉 YOU WON!" : result.net === 0 ? "🤝 REFUND" : "😞 TRY AGAIN"}
            </Text>
            <View style={styles.resultAmount}>
              <Diamond size={22} />
              <Text style={[styles.resultAmountText, { color: result.net > 0 ? colors.success : result.net < 0 ? colors.error : colors.muted }]}>
                {result.net > 0 ? "+" : ""}{result.net}
              </Text>
            </View>
          </View>
        )}

        {/* Pick selector */}
        {cfg.needsPick && cfg.picks && (
          <>
            <Text style={styles.label}>Choose your pick</Text>
            <View style={styles.picks}>
              {cfg.picks.map((p) => (
                <Pressable
                  key={p.key}
                  testID={`pick-${p.key}`}
                  onPress={() => setPick(p.key)}
                  style={[styles.pick, pick === p.key && styles.pickActive]}
                >
                  <Text style={[styles.pickText, pick === p.key && styles.pickTextActive]}>{p.label}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        {/* Bet */}
        <Text style={styles.label}>Your bet</Text>
        <View style={styles.betRow}>
          <Diamond size={22} />
          <TextInput
            testID="bet-input"
            value={bet}
            onChangeText={setBet}
            keyboardType="number-pad"
            style={styles.betInput}
            placeholder="10"
            placeholderTextColor={colors.muted}
          />
        </View>
        <View style={styles.quickBets}>
          {[10, 50, 100, 500, 1000].map((v) => (
            <Pressable key={v} testID={`quick-${v}`} onPress={() => setBet(String(v))} style={styles.quickBet}>
              <Text style={styles.quickBetText}>{v}</Text>
            </Pressable>
          ))}
        </View>

        {err && <Text style={styles.err}>{err}</Text>}

        <Pressable
          testID="play-btn"
          onPress={play}
          disabled={loading}
          style={({ pressed }) => [styles.playBtn, pressed && { opacity: 0.85 }, loading && { opacity: 0.6 }]}
        >
          {loading ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.playText}>Play — {bet} Diamonds</Text>}
        </Pressable>
      </ScrollView>
    </View>
  );
}

function ResultView({ game, result }: { game: string; result: any }) {
  const d = result.detail || {};
  const styles = resultStyles;
  if (game === "slots") return (
    <View style={styles.row}>
      {d.reels?.map((r: string, i: number) => (
        <View key={i} style={styles.slot}><Text style={styles.slotText}>{r}</Text></View>
      ))}
    </View>
  );
  if (game === "lucky77") return (
    <View style={styles.row}>
      <View style={styles.slot}><Text style={styles.slotText}>{"⚀⚁⚂⚃⚄⚅"[d.dice?.[0] - 1] || d.dice?.[0]}</Text></View>
      <View style={styles.slot}><Text style={styles.slotText}>{"⚀⚁⚂⚃⚄⚅"[d.dice?.[1] - 1] || d.dice?.[1]}</Text></View>
      <View style={styles.slot}><Text style={styles.slotText}>= {d.total}</Text></View>
    </View>
  );
  if (game === "dice") return (
    <View style={styles.row}>
      <View style={styles.slot}><Text style={styles.slotText}>{d.rolled}</Text></View>
      <Text style={{ color: colors.muted, fontSize: 13 }}>you picked {d.picked}</Text>
    </View>
  );
  if (game === "coinflip") return (
    <View style={styles.row}>
      <View style={styles.slot}><Text style={styles.slotText}>{d.result === "heads" ? "👑" : "🌟"}</Text></View>
      <Text style={{ color: colors.muted, fontSize: 13 }}>{d.result}</Text>
    </View>
  );
  if (game === "cards") return (
    <View style={styles.row}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={[styles.slot, i === d.winning ? { backgroundColor: colors.success } : i === d.picked ? { backgroundColor: colors.error } : null]}>
          <Text style={styles.slotText}>{i === d.winning ? "★" : "?"}</Text>
        </View>
      ))}
    </View>
  );
  if (game === "guess") return (
    <View style={styles.row}>
      <View style={styles.slot}><Text style={styles.slotText}>{d.winning}</Text></View>
      <Text style={{ color: colors.muted, fontSize: 13 }}>you picked {d.picked}</Text>
    </View>
  );
  if (game === "rps") return (
    <View style={styles.row}>
      <View style={styles.slot}><Text style={styles.slotText}>{d.picked === "rock" ? "🪨" : d.picked === "paper" ? "📄" : "✂️"}</Text></View>
      <Text style={{ color: colors.muted }}>vs</Text>
      <View style={styles.slot}><Text style={styles.slotText}>{d.comp === "rock" ? "🪨" : d.comp === "paper" ? "📄" : "✂️"}</Text></View>
    </View>
  );
  if (game === "scratch") return (
    <View style={{ alignItems: "center", gap: 4 }}>
      {[0, 3, 6].map((r) => (
        <View key={r} style={styles.row}>
          {d.cells?.slice(r, r + 3).map((c: string, i: number) => (
            <View key={i} style={styles.slot}><Text style={styles.slotText}>{c}</Text></View>
          ))}
        </View>
      ))}
    </View>
  );
  if (game === "treasure") return (
    <View style={styles.row}>
      {d.contents?.map((v: number, i: number) => (
        <View key={i} style={[styles.slot, i === d.picked ? { borderColor: colors.gold, borderWidth: 2 } : null]}>
          <Text style={styles.slotText}>{v > 0 ? `${v}x` : "❌"}</Text>
        </View>
      ))}
    </View>
  );
  if (game === "wheel") return (
    <View style={styles.row}>
      <View style={[styles.slot, { backgroundColor: colors.gold, width: 100, height: 100, borderRadius: 50 }]}>
        <Text style={[styles.slotText, { color: colors.onBrandPrimary, fontSize: 24 }]}>{d.mult}x</Text>
      </View>
    </View>
  );
  return null;
}

const resultStyles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" },
  slot: { width: 56, height: 56, borderRadius: 10, backgroundColor: colors.surfaceElevated, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  slotText: { color: colors.onSurface, fontSize: 26, fontWeight: "800" },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  balanceChip: { backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill },
  showcase: { alignItems: "center", padding: spacing.lg, backgroundColor: "rgba(0,0,0,0.35)", borderRadius: radius.lg, marginBottom: spacing.lg },
  bigIcon: { fontSize: 80 },
  desc: { color: "#EBEBF5", textAlign: "center", marginTop: spacing.md, fontSize: 13 },
  label: { color: colors.muted, fontSize: 12, marginTop: spacing.lg, marginBottom: spacing.sm, textTransform: "uppercase", letterSpacing: 1, fontWeight: "700" },
  picks: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  pick: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, minWidth: 60, alignItems: "center" },
  pickActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  pickText: { color: colors.onSurfaceSecondary, fontWeight: "700", fontSize: 13 },
  pickTextActive: { color: colors.onBrandPrimary },
  betRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg, height: 54 },
  betInput: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: "800" },
  quickBets: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  quickBet: { flex: 1, height: 36, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  quickBetText: { color: colors.onSurfaceSecondary, fontWeight: "700" },
  err: { color: colors.error, textAlign: "center", marginTop: spacing.md },
  playBtn: { marginTop: spacing.xl, backgroundColor: colors.gold, height: 56, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  playText: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 16 },
  resultCard: { marginBottom: spacing.lg, padding: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, alignItems: "center", borderWidth: 2, gap: spacing.md },
  resultLabel: { fontSize: 18, fontWeight: "900" },
  resultAmount: { flexDirection: "row", alignItems: "center", gap: 6 },
  resultAmountText: { fontSize: 24, fontWeight: "900" },
});
