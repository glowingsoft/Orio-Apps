import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter, Stack, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiCreateLudo, apiGetActiveGameForRoom, apiGamesXp } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { useI18n } from "@/src/i18n";

export default function GamesIndexScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useI18n();
  const qc = useQueryClient();
  // Entry point from a room. Rooms will push to `/games?room_id=...`.
  const { room_id } = useLocalSearchParams<{ room_id?: string }>();

  const xp = useQuery({ queryKey: ["games-xp"], queryFn: apiGamesXp });
  const active = useQuery({
    queryKey: ["active-game", room_id],
    queryFn: () => apiGetActiveGameForRoom(room_id!),
    enabled: !!room_id,
    refetchInterval: 4000,
  });

  const createLudo = useMutation({
    mutationFn: () => apiCreateLudo(room_id!),
    onSuccess: (g) => {
      qc.invalidateQueries({ queryKey: ["active-game", room_id] });
      router.push(`/games/ludo/${g.game_id}` as any);
    },
  });

  return (
    <View style={styles.root} testID="games-screen">
      <Stack.Screen options={{ title: "Games", headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.onSurface }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl, gap: spacing.md }}>
        {/* XP badge */}
        <View style={styles.xpBadge}>
          <Icon name="trophy" size={18} color={colors.gold} />
          <Text style={styles.xpText}>{(xp.data?.games_xp ?? 0).toLocaleString()} XP</Text>
        </View>

        {/* Ludo card */}
        <View style={styles.gameCard}>
          <View style={styles.gameHeader}>
            <View style={styles.ludoBadge}>
              <View style={[styles.ludoCorner, { backgroundColor: "#E53935" }]} />
              <View style={[styles.ludoCorner, { backgroundColor: "#43A047" }]} />
              <View style={[styles.ludoCorner, { backgroundColor: "#FDD835" }]} />
              <View style={[styles.ludoCorner, { backgroundColor: "#1E88E5" }]} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.gameTitle}>{t.gamesLudoTitle}</Text>
              <Text style={styles.gameSub}>{t.gamesLudoSub}</Text>
            </View>
          </View>

          {!room_id ? (
            <View style={styles.notice}>
              <Icon name="information-circle" size={14} color={colors.warning} />
              <Text style={styles.noticeText}>Open from inside a voice room to create or join a game.</Text>
            </View>
          ) : active.isLoading ? (
            <ActivityIndicator color={colors.onSurface} style={{ padding: spacing.md }} />
          ) : active.data?.game ? (
            <Pressable
              style={[styles.btn, { backgroundColor: colors.brandSecondary }]}
              onPress={() => router.push(`/games/ludo/${active.data!.game!.game_id}` as any)}
              testID="open-active-game"
            >
              <Icon name="log-in" size={18} color={colors.onBrandSecondary} />
              <Text style={styles.btnText}>Open Active Game ({active.data.game.players.length}/4)</Text>
            </Pressable>
          ) : (
            <Pressable
              style={styles.btn}
              onPress={() => createLudo.mutate()}
              disabled={createLudo.isPending}
              testID="create-ludo-btn"
            >
              {createLudo.isPending ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
                <>
                  <Icon name="add-circle" size={18} color={colors.onBrandPrimary} />
                  <Text style={styles.btnText}>{t.createGame}</Text>
                </>
              )}
            </Pressable>
          )}
        </View>

        {/* Placeholder for other games (reusable architecture) */}
        <View style={[styles.gameCard, { opacity: 0.4 }]}>
          <Text style={styles.gameTitle}>Dominoes · UNO · Carrom · Team Battle · Dice</Text>
          <Text style={styles.gameSub}>Coming next — same server architecture.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  xpBadge: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.gold + "22",
    borderWidth: 1, borderColor: colors.gold + "66",
  },
  xpText: { color: colors.gold, fontSize: 13, fontWeight: "900" },
  gameCard: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: spacing.md,
  },
  gameHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  ludoBadge: {
    width: 56, height: 56, borderRadius: 12, backgroundColor: colors.surface,
    flexDirection: "row", flexWrap: "wrap", padding: 2, gap: 2,
  },
  ludoCorner: { width: 24, height: 24, borderRadius: 4 },
  gameTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "900" },
  gameSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  btn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.brandPrimary,
  },
  btnText: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 14 },
  notice: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, backgroundColor: colors.warning + "15", borderRadius: radius.md },
  noticeText: { color: colors.onSurface, fontSize: 11, flex: 1 },
});
