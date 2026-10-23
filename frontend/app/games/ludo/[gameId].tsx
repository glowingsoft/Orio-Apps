import { VipName } from "@/src/components/VipName";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert,
  useWindowDimensions,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  apiGetGame, apiJoinGame, apiLeaveGame, apiMoveToken, apiRollDice, apiStartGame,
  API_BASE, getAccessToken, type LudoGame,
} from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { colors, spacing, radius } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { LudoBoard } from "@/src/games/LudoBoard";

const SEAT_COLORS: Record<number, string> = {
  0: "#E53935", 1: "#43A047", 2: "#FDD835", 3: "#1E88E5",
};
const SEAT_LABELS = ["Red", "Green", "Yellow", "Blue"];

export default function LudoGameScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const { t } = useI18n();
  const { user } = useAuth();
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const { width } = useWindowDimensions();

  const q = useQuery({
    queryKey: ["game", gameId],
    queryFn: () => apiGetGame(gameId!),
    enabled: !!gameId,
    refetchInterval: 2500,  // polling fallback alongside WS
  });

  // WebSocket real-time stream.
  const wsRef = useRef<WebSocket | null>(null);
  useEffect(() => {
    if (!gameId) return;
    const token = getAccessToken();
    if (!token) return;
    const wsBase = API_BASE.replace(/^http/, "ws").replace(/\/api$/, "");
    const url = `${wsBase}/api/ws/games/${gameId}?token=${encodeURIComponent(token)}`;
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg?.type === "game_state" && msg.game) {
            qc.setQueryData(["game", gameId], msg.game as LudoGame);
          }
        } catch {}
      };
      ws.onerror = () => {};
      ws.onclose = () => {};
    } catch {}
    return () => { try { ws?.close(); } catch {} };
  }, [gameId, qc]);

  const g = q.data;
  const myUid = user?.id;
  const myPlayer = useMemo(() => g?.players.find((p) => p.user_id === myUid) ?? null, [g, myUid]);
  const mySeat = myPlayer?.seat ?? null;
  const isHost = g?.owner_id === myUid;
  const myTurn = g?.status === "active" && g?.state.current_turn === mySeat && !myPlayer?.forfeited;
  const canRoll = myTurn && g?.state.dice == null;
  const canMove = myTurn && g?.state.dice != null;

  const joinMut = useMutation({ mutationFn: () => apiJoinGame(gameId!), onSuccess: () => qc.invalidateQueries({ queryKey: ["game", gameId] }) });
  const leaveMut = useMutation({ mutationFn: () => apiLeaveGame(gameId!), onSuccess: () => qc.invalidateQueries({ queryKey: ["game", gameId] }) });
  const startMut = useMutation({ mutationFn: () => apiStartGame(gameId!), onSuccess: () => qc.invalidateQueries({ queryKey: ["game", gameId] }), onError: (e: Error) => Alert.alert("", e.message) });
  const rollMut = useMutation({ mutationFn: () => apiRollDice(gameId!), onSuccess: () => qc.invalidateQueries({ queryKey: ["game", gameId] }), onError: (e: Error) => Alert.alert("", e.message) });
  const moveMut = useMutation({
    mutationFn: (ti: number) => apiMoveToken(gameId!, ti),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["game", gameId] }),
    onError: (e: Error) => Alert.alert("", e.message),
  });

  const onTokenPress = useCallback((seat: number, ti: number) => {
    if (!canMove || seat !== mySeat) return;
    moveMut.mutate(ti);
  }, [canMove, mySeat, moveMut]);

  // Board sizing: fits the screen width minus some padding.
  const boardSize = Math.min(width - spacing.lg * 2, 380);
  const cellPx = Math.floor(boardSize / 15);

  if (q.isLoading || !g) {
    return (
      <View style={styles.loading}>
        <Stack.Screen options={{ title: "Ludo", headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.onSurface }} />
        <ActivityIndicator color={colors.onSurface} />
      </View>
    );
  }

  const turnPlayer = g.players.find((p) => p.seat === g.state.current_turn);

  return (
    <View style={styles.root} testID="ludo-screen">
      <Stack.Screen options={{ title: `Ludo · ${g.game_id}`, headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.onSurface }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl, gap: spacing.md }}>
        {/* Players strip */}
        <View style={styles.playersRow}>
          {[0, 1, 2, 3].map((seat) => {
            const p = g.players.find((pp) => pp.seat === seat);
            const isTurn = g.status === "active" && g.state.current_turn === seat;
            return (
              <View key={seat} style={[styles.playerSlot, isTurn && styles.playerSlotActive, { borderColor: SEAT_COLORS[seat] }]}>
                <View style={[styles.seatDot, { backgroundColor: SEAT_COLORS[seat] }]} />
                {p ? (
                  <>
                    <VipName style={styles.playerName} numberOfLines={1} name={p?.nickname} color={(p as any)?.name_color} vipLevel={(p as any)?.vip_level} />
                    {p.forfeited && <Text style={styles.forfeited}>Forfeited</Text>}
                  </>
                ) : (
                  <Text style={styles.empty}>{SEAT_LABELS[seat]}</Text>
                )}
              </View>
            );
          })}
        </View>

        {/* Status pill */}
        <View style={styles.statusPill}>
          <Icon
            name={
              g.status === "waiting" ? "people" :
              g.status === "active" ? "radio" :
              g.status === "finished" ? "trophy" : "close-circle"
            }
            size={14}
            color={colors.gold}
          />
          <Text style={styles.statusText}>
            {g.status === "waiting" ? t.waitingForPlayers :
             g.status === "active" ? (myTurn ? t.yourTurn : (typeof t.waitingForTurn === "function" ? t.waitingForTurn(turnPlayer?.nickname ?? "—") : "")) :
             g.status === "finished" ? (typeof t.gameWinner === "function" ? t.gameWinner(g.players.find((p) => p.user_id === g.winner_user_id)?.nickname ?? "—") : t.gameFinished) :
             "Abandoned"}
          </Text>
        </View>

        {/* Board */}
        <View style={{ alignItems: "center" }}>
          <LudoBoard
            game={g}
            cellPx={cellPx}
            mySeat={mySeat}
            canMove={!!canMove}
            onTokenPress={onTokenPress}
          />
        </View>

        {/* Dice & actions */}
        {g.status === "active" && (
          <View style={styles.diceRow}>
            <View style={styles.diceBox}>
              <Text style={styles.diceText}>{g.state.dice ?? "—"}</Text>
            </View>
            {canRoll ? (
              <Pressable style={styles.rollBtn} onPress={() => rollMut.mutate()} disabled={rollMut.isPending} testID="roll-dice-btn">
                {rollMut.isPending ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.rollText}>{t.rollDice}</Text>}
              </Pressable>
            ) : canMove ? (
              <View style={styles.hintBox}>
                <Icon name="hand-left" size={14} color={colors.gold} />
                <Text style={styles.hintText}>{t.tapTokenToMove}</Text>
              </View>
            ) : (
              <View style={styles.hintBox}>
                <Icon name="time" size={14} color={colors.muted} />
                <Text style={styles.hintText}>Waiting…</Text>
              </View>
            )}
          </View>
        )}

        {/* Buttons */}
        <View style={styles.actionsRow}>
          {g.status === "waiting" && !myPlayer && g.players.length < 4 && (
            <Pressable style={styles.actionBtn} onPress={() => joinMut.mutate()} testID="join-game-btn" disabled={joinMut.isPending}>
              <Icon name="log-in" size={16} color={colors.onBrandPrimary} />
              <Text style={styles.actionText}>{t.joinGame}</Text>
            </Pressable>
          )}
          {g.status === "waiting" && isHost && g.players.length >= 2 && (
            <Pressable style={[styles.actionBtn, { backgroundColor: colors.success }]} onPress={() => startMut.mutate()} testID="start-game-btn" disabled={startMut.isPending}>
              <Icon name="play" size={16} color={colors.onSuccess} />
              <Text style={[styles.actionText, { color: colors.onSuccess }]}>{t.startGame}</Text>
            </Pressable>
          )}
          {myPlayer && g.status !== "finished" && g.status !== "abandoned" && (
            <Pressable
              style={[styles.actionBtn, { backgroundColor: colors.error }]}
              onPress={() => Alert.alert(t.leaveGame, "You will forfeit this game.", [
                { text: t.cancel, style: "cancel" },
                { text: t.leaveGame, style: "destructive", onPress: () => leaveMut.mutate() },
              ])}
              testID="leave-game-btn"
            >
              <Icon name="log-out" size={16} color={colors.onError} />
              <Text style={[styles.actionText, { color: colors.onError }]}>{t.leaveGame}</Text>
            </Pressable>
          )}
          {(g.status === "finished" || g.status === "abandoned") && (
            <Pressable style={styles.actionBtn} onPress={() => router.back()} testID="back-btn">
              <Icon name="arrow-back" size={16} color={colors.onBrandPrimary} />
              <Text style={styles.actionText}>Back</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  loading: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  playersRow: { flexDirection: "row", gap: spacing.sm },
  playerSlot: {
    flex: 1,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 2,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    gap: 4,
  },
  playerSlotActive: { backgroundColor: colors.gold + "22" },
  seatDot: { width: 10, height: 10, borderRadius: 5 },
  playerName: { color: colors.onSurface, fontSize: 11, fontWeight: "800" },
  forfeited: { color: colors.error, fontSize: 9, fontWeight: "900" },
  empty: { color: colors.muted, fontSize: 11 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: spacing.sm, alignSelf: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.gold + "33" },
  statusText: { color: colors.onSurface, fontSize: 12, fontWeight: "800" },
  diceRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, justifyContent: "center" },
  diceBox: { width: 60, height: 60, borderRadius: 12, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.gold },
  diceText: { color: "#121212", fontSize: 30, fontWeight: "900" },
  rollBtn: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.pill, backgroundColor: colors.brandPrimary },
  rollText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "900" },
  hintBox: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary },
  hintText: { color: colors.onSurface, fontSize: 12 },
  actionsRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", justifyContent: "center" },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  actionText: { color: colors.onBrandPrimary, fontSize: 14, fontWeight: "900" },
});
