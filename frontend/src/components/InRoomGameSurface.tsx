/**
 * In-Room Game Surface
 * ----------------------------------------------------------------------------
 * A ~50 % height overlay rendered INSIDE the room screen. The room stays
 * mounted above (so Agora voice continues, seats remain, chat state is
 * preserved). When closed, the room returns to normal — nothing in the room
 * component is unmounted.
 *
 * The surface itself is a self-contained block that:
 *   - creates (or fetches) a game session anchored to the room,
 *   - subscribes to the game WebSocket for real-time state,
 *   - shows the appropriate game board (Ludo or Billiards),
 *   - exposes a close button that just unmounts the surface.
 */
import { VipName } from "@/src/components/VipName";
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, Alert,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  API_BASE, getAccessToken,
  apiCreateLudo, apiGetGame, apiJoinGame, apiLeaveGame, apiRollDice,
  apiMoveToken, apiStartGame,
  apiCreateBilliards, apiJoinBilliards, apiLeaveBilliards, apiBilliardsShot,
  type LudoGame, type BilliardsGame,
} from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { useI18n } from "@/src/i18n";
import { colors, spacing, radius } from "@/src/theme";
import { LudoBoard } from "@/src/games/LudoBoard";
import { BilliardsBoard } from "@/src/games/BilliardsBoard";

export type InRoomGameType = "ludo" | "billiards";

export type InRoomGameSurfaceProps = {
  roomId: string;
  gameType: InRoomGameType;
  onClose: () => void;
};

export function InRoomGameSurface({ roomId, gameType, onClose }: InRoomGameSurfaceProps) {
  if (gameType === "ludo") return <LudoSurface roomId={roomId} onClose={onClose} />;
  return <BilliardsSurface roomId={roomId} onClose={onClose} />;
}


function SurfaceShell({
  title, icon, children, onClose, testID,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
  onClose: () => void;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  // Target 50% of screen height; subtract safe-area bottom so the pill clears
  // the home indicator on iOS.
  const h = Math.max(320, Math.min(height * 0.52, height - 180));
  return (
    <View
      style={[
        styles.shell,
        { height: h, paddingBottom: insets.bottom + spacing.sm },
      ]}
      testID={testID ?? "in-room-game-surface"}
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Icon name={icon as any} size={16} color={colors.gold} />
          <Text style={styles.title}>{title}</Text>
        </View>
        <Pressable
          style={styles.closeBtn}
          onPress={onClose}
          testID="close-game-surface"
          hitSlop={10}
        >
          <Icon name="close" size={18} color={colors.onSurface} />
        </Pressable>
      </View>
      <View style={styles.body}>{children}</View>
    </View>
  );
}


// ============================================================================
// LUDO (reuses the existing server-authoritative state machine)
// ============================================================================

function LudoSurface({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [gameId, setGameId] = useState<string | null>(null);

  // Create-or-attach the session for this room.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const g = await apiCreateLudo(roomId);
        if (!cancelled) setGameId(g.game_id);
      } catch {
        if (!cancelled) {
          Alert.alert("Game error", "Could not start Ludo in this room.");
          onClose();
        }
      }
    })();
    return () => { cancelled = true; };
  }, [roomId, onClose]);

  const q = useQuery({
    queryKey: ["in-room-ludo", gameId],
    queryFn: () => apiGetGame(gameId!),
    enabled: !!gameId,
    refetchInterval: 2500,
  });

  // Game WebSocket for real-time state.
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
            qc.setQueryData(["in-room-ludo", gameId], msg.game as LudoGame);
          }
        } catch {}
      };
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

  const joinMut = useMutation({ mutationFn: () => apiJoinGame(gameId!), onSuccess: () => qc.invalidateQueries({ queryKey: ["in-room-ludo", gameId] }) });
  const leaveMut = useMutation({ mutationFn: () => apiLeaveGame(gameId!), onSuccess: () => qc.invalidateQueries({ queryKey: ["in-room-ludo", gameId] }) });
  const startMut = useMutation({ mutationFn: () => apiStartGame(gameId!), onSuccess: () => qc.invalidateQueries({ queryKey: ["in-room-ludo", gameId] }), onError: (e: Error) => Alert.alert("", e.message) });
  const rollMut = useMutation({ mutationFn: () => apiRollDice(gameId!), onSuccess: () => qc.invalidateQueries({ queryKey: ["in-room-ludo", gameId] }), onError: (e: Error) => Alert.alert("", e.message) });
  const moveMut = useMutation({ mutationFn: (ti: number) => apiMoveToken(gameId!, ti), onSuccess: () => qc.invalidateQueries({ queryKey: ["in-room-ludo", gameId] }), onError: (e: Error) => Alert.alert("", e.message) });

  const onTokenPress = useCallback((seat: number, ti: number) => {
    if (!canMove || seat !== mySeat) return;
    moveMut.mutate(ti);
  }, [canMove, mySeat, moveMut]);

  // Sizing: fit board inside the available body area.
  const { width } = useWindowDimensions();
  const cellPx = Math.max(12, Math.floor(Math.min(width - spacing.lg * 2, 320) / 15));

  return (
    <SurfaceShell
      title={t.gamesLudoTitle}
      icon="dice-outline"
      onClose={onClose}
      testID="ludo-surface"
    >
      {q.isLoading || !g ? (
        <View style={styles.loading}><ActivityIndicator color={colors.onSurface} /></View>
      ) : (
        <View style={{ flex: 1, alignItems: "center" }}>
          {/* Compact players strip */}
          <View style={styles.playerStrip}>
            {[0, 1, 2, 3].map((seat) => {
              const p = g.players.find((pp) => pp.seat === seat);
              const active = g.status === "active" && g.state.current_turn === seat;
              return (
                <View key={seat} style={[styles.playerChip, active && styles.playerChipActive, { borderColor: ["#E53935", "#43A047", "#FDD835", "#1E88E5"][seat] }]}>
                  <View style={[styles.seatDot, { backgroundColor: ["#E53935", "#43A047", "#FDD835", "#1E88E5"][seat] }]} />
                  <View style={{ flex: 1 }}><VipName style={styles.playerName} numberOfLines={1} name={p?.nickname ?? "—"} vipLevel={(p as any)?.vip_level ?? 0} /></View>
                </View>
              );
            })}
          </View>

          <LudoBoard
            game={g}
            cellPx={cellPx}
            mySeat={mySeat}
            canMove={!!canMove}
            onTokenPress={onTokenPress}
          />

          {/* Controls */}
          <View style={styles.controlsRow}>
            {g.status === "active" && (
              <View style={styles.diceWrap}>
                <View style={styles.diceSmall}><Text style={styles.diceSmallText}>{g.state.dice ?? "—"}</Text></View>
                {canRoll && (
                  <Pressable style={styles.primaryBtn} onPress={() => rollMut.mutate()} disabled={rollMut.isPending} testID="roll-dice-btn">
                    {rollMut.isPending ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryBtnText}>{t.rollDice}</Text>}
                  </Pressable>
                )}
                {canMove && !canRoll && <Text style={styles.hint}>{t.tapTokenToMove}</Text>}
              </View>
            )}
            {g.status === "waiting" && !myPlayer && g.players.length < 4 && (
              <Pressable style={styles.primaryBtn} onPress={() => joinMut.mutate()} testID="join-game-btn" disabled={joinMut.isPending}>
                <Text style={styles.primaryBtnText}>{t.joinGame}</Text>
              </Pressable>
            )}
            {g.status === "waiting" && isHost && g.players.length >= 2 && (
              <Pressable style={[styles.primaryBtn, { backgroundColor: colors.success }]} onPress={() => startMut.mutate()} testID="start-game-btn" disabled={startMut.isPending}>
                <Text style={[styles.primaryBtnText, { color: colors.onSuccess }]}>{t.startGame}</Text>
              </Pressable>
            )}
            {myPlayer && g.status !== "finished" && g.status !== "abandoned" && (
              <Pressable style={styles.secondaryBtn} onPress={() => leaveMut.mutate()} testID="leave-game-btn">
                <Text style={styles.secondaryBtnText}>{t.leaveGame}</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
    </SurfaceShell>
  );
}


// ============================================================================
// BILLIARDS
// ============================================================================

function BilliardsSurface({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [gameId, setGameId] = useState<string | null>(null);
  const [aim, setAim] = useState<number>(0);     // degrees
  const [power, setPower] = useState<number>(60);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const g = await apiCreateBilliards(roomId);
        if (!cancelled) setGameId(g.game_id);
      } catch {
        if (!cancelled) {
          Alert.alert("Game error", "Could not start Billiards in this room.");
          onClose();
        }
      }
    })();
    return () => { cancelled = true; };
  }, [roomId, onClose]);

  const q = useQuery({
    queryKey: ["in-room-billiards", gameId],
    queryFn: async () => {
      if (!gameId) throw new Error("no game");
      // Reuse the generic /api/games/{id} endpoint not available for billiards;
      // instead keep polling via the active lookup — but we have the game_id so
      // the dedicated room active endpoint is simplest.
      const r = await fetch(`${API_BASE}/rooms/${roomId}/games/billiards/active`, {
        headers: { Authorization: `Bearer ${getAccessToken()}` },
      });
      const j = await r.json();
      return j.game as BilliardsGame | null;
    },
    enabled: !!gameId,
    refetchInterval: 2500,
  });

  // WebSocket for real-time state.
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
            qc.setQueryData(["in-room-billiards", gameId], msg.game as BilliardsGame);
          }
        } catch {}
      };
    } catch {}
    return () => { try { ws?.close(); } catch {} };
  }, [gameId, qc]);

  const g = q.data;
  const myUid = user?.id;
  const myPlayer = useMemo(() => g?.players.find((p) => p.user_id === myUid) ?? null, [g, myUid]);
  const mySeat = myPlayer?.seat ?? null;
  const myTurn = g?.status === "active" && g.state.current_turn === mySeat && !myPlayer?.forfeited;

  const joinMut = useMutation({ mutationFn: () => apiJoinBilliards(gameId!), onSuccess: () => qc.invalidateQueries({ queryKey: ["in-room-billiards", gameId] }) });
  const leaveMut = useMutation({ mutationFn: () => apiLeaveBilliards(gameId!), onSuccess: () => qc.invalidateQueries({ queryKey: ["in-room-billiards", gameId] }) });
  const shotMut = useMutation({
    mutationFn: () => apiBilliardsShot(gameId!, aim, power),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["in-room-billiards", gameId] }),
    onError: (e: Error) => Alert.alert("", e.message),
  });

  const { width } = useWindowDimensions();
  const boardW = Math.min(width - spacing.lg * 2, 420);

  const onTapTable = useCallback((x: number, y: number) => {
    if (!g) return;
    const cue = g.state.balls.find((b) => b.is_cue && !b.pocketed);
    if (!cue) return;
    const dx = x - cue.x;
    const dy = y - cue.y;
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    setAim(deg);
  }, [g]);

  return (
    <SurfaceShell title="Billiards" icon="ellipse-outline" onClose={onClose} testID="billiards-surface">
      {q.isLoading || !g ? (
        <View style={styles.loading}><ActivityIndicator color={colors.onSurface} /></View>
      ) : (
        <View style={{ flex: 1, alignItems: "center", gap: spacing.sm }}>
          {/* Scores strip */}
          <View style={styles.playerStrip}>
            {[0, 1].map((seat) => {
              const p = g.players.find((pp) => pp.seat === seat);
              const active = g.status === "active" && g.state.current_turn === seat;
              return (
                <View key={seat} style={[styles.playerChip, active && styles.playerChipActive, { borderColor: seat === 0 ? "#FFFFFF" : "#FDD835", flex: 1 }]}>
                  <View style={[styles.seatDot, { backgroundColor: seat === 0 ? "#FFFFFF" : "#FDD835" }]} />
                  <View style={{ flex: 1 }}><VipName style={styles.playerName} numberOfLines={1} name={p?.nickname ?? "—"} vipLevel={(p as any)?.vip_level ?? 0} /></View>
                  <Text style={styles.scoreText}>{p?.score ?? 0}</Text>
                </View>
              );
            })}
          </View>

          <BilliardsBoard
            game={g}
            width={boardW}
            myTurn={!!myTurn}
            aimAngle={aim}
            onTapTable={onTapTable}
          />

          {/* Controls */}
          {g.status === "active" && myTurn && (
            <View style={styles.billiardsControls}>
              <View style={styles.row}>
                <Text style={styles.ctrlLabel}>Aim</Text>
                <Pressable style={styles.dirBtn} onPress={() => setAim((a) => a - 5)} testID="aim-left"><Icon name="chevron-back" size={16} color={colors.onSurface} /></Pressable>
                <Text style={styles.ctrlValue}>{Math.round(aim)}°</Text>
                <Pressable style={styles.dirBtn} onPress={() => setAim((a) => a + 5)} testID="aim-right"><Icon name="chevron-forward" size={16} color={colors.onSurface} /></Pressable>
              </View>
              <View style={styles.row}>
                <Text style={styles.ctrlLabel}>Power</Text>
                <Pressable style={styles.dirBtn} onPress={() => setPower((p) => Math.max(10, p - 10))} testID="power-down"><Icon name="remove" size={16} color={colors.onSurface} /></Pressable>
                <Text style={styles.ctrlValue}>{Math.round(power)}</Text>
                <Pressable style={styles.dirBtn} onPress={() => setPower((p) => Math.min(100, p + 10))} testID="power-up"><Icon name="add" size={16} color={colors.onSurface} /></Pressable>
              </View>
              <Pressable
                style={[styles.primaryBtn, { minWidth: 110 }]}
                onPress={() => shotMut.mutate()}
                disabled={shotMut.isPending}
                testID="billiards-shoot-btn"
              >
                {shotMut.isPending ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
                  <>
                    <Icon name="flash" size={14} color={colors.onBrandPrimary} />
                    <Text style={styles.primaryBtnText}>Shoot</Text>
                  </>
                )}
              </Pressable>
            </View>
          )}

          {g.status === "waiting" && !myPlayer && g.players.length < 2 && (
            <Pressable style={styles.primaryBtn} onPress={() => joinMut.mutate()} testID="join-billiards-btn" disabled={joinMut.isPending}>
              <Text style={styles.primaryBtnText}>{t.joinGame}</Text>
            </Pressable>
          )}
          {myPlayer && g.status !== "finished" && g.status !== "abandoned" && (
            <Pressable style={styles.secondaryBtn} onPress={() => leaveMut.mutate()} testID="leave-billiards-btn">
              <Text style={styles.secondaryBtnText}>{t.leaveGame}</Text>
            </Pressable>
          )}
          {g.status === "finished" && (
            <Text style={styles.hint}>
              {typeof t.gameWinner === "function"
                ? t.gameWinner(g.players.find((p) => p.user_id === g.winner_user_id)?.nickname ?? "—")
                : t.gameFinished}
            </Text>
          )}
        </View>
      )}
    </SurfaceShell>
  );
}

const styles = StyleSheet.create({
  shell: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: colors.gold + "55",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 20,
    zIndex: 1000,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.sm },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { color: colors.onSurface, fontSize: 15, fontWeight: "900" },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
  },
  body: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  playerStrip: { flexDirection: "row", gap: spacing.xs, width: "100%", marginBottom: spacing.sm },
  playerChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 2,
    backgroundColor: colors.surfaceSecondary,
  },
  playerChipActive: { backgroundColor: colors.gold + "22" },
  seatDot: { width: 8, height: 8, borderRadius: 4 },
  playerName: { color: colors.onSurface, fontSize: 11, fontWeight: "800", flex: 1 },
  scoreText: { color: colors.gold, fontSize: 12, fontWeight: "900" },
  controlsRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm, alignItems: "center" },
  diceWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  diceSmall: { width: 44, height: 44, borderRadius: 10, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.gold },
  diceSmallText: { color: "#121212", fontSize: 22, fontWeight: "900" },
  primaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
  },
  primaryBtnText: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 13 },
  secondaryBtn: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.error + "22",
    borderWidth: 1, borderColor: colors.error + "66",
  },
  secondaryBtnText: { color: colors.error, fontWeight: "900", fontSize: 12 },
  hint: { color: colors.muted, fontSize: 12 },
  billiardsControls: { gap: spacing.sm, alignItems: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  ctrlLabel: { color: colors.muted, fontSize: 11, fontWeight: "700", width: 48 },
  dirBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  ctrlValue: { color: colors.onSurface, fontSize: 13, fontWeight: "900", minWidth: 40, textAlign: "center" },
});

export default InRoomGameSurface;
