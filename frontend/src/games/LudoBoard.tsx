/**
 * Ludo Board — client-side RENDERING ONLY.
 *
 * Every piece of game state (dice, turn, token positions, captures, winner)
 * comes from the backend. The client never computes a result.
 */
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useMemo } from "react";
import { colors } from "@/src/theme";
import type { LudoGame, LudoTokenRender } from "@/src/api";

const COLORS: Record<string, string> = {
  red: "#E53935",
  green: "#43A047",
  yellow: "#FDD835",
  blue: "#1E88E5",
};

const SEAT_COLOR: Record<number, string> = {
  0: COLORS.red,
  1: COLORS.green,
  2: COLORS.yellow,
  3: COLORS.blue,
};

const BOARD = 15; // 15×15 standard Ludo grid

/**
 * Fixed standard-Ludo path cell coordinates. Position 0 = red start, going
 * clockwise. There are 52 track cells.
 */
const TRACK_CELLS: { x: number; y: number }[] = [
  // Starting at seat 0 (red) entry — top center going clockwise.
  // We'll place cells roughly along the standard cross shape.
  // Red arm: top entry down middle
  { x: 6, y: 1 }, { x: 6, y: 2 }, { x: 6, y: 3 }, { x: 6, y: 4 }, { x: 6, y: 5 },
  { x: 5, y: 6 }, { x: 4, y: 6 }, { x: 3, y: 6 }, { x: 2, y: 6 }, { x: 1, y: 6 }, { x: 0, y: 6 },
  { x: 0, y: 7 }, { x: 0, y: 8 },
  { x: 1, y: 8 }, { x: 2, y: 8 }, { x: 3, y: 8 }, { x: 4, y: 8 }, { x: 5, y: 8 },
  { x: 6, y: 9 }, { x: 6, y: 10 }, { x: 6, y: 11 }, { x: 6, y: 12 }, { x: 6, y: 13 }, { x: 6, y: 14 },
  { x: 7, y: 14 }, { x: 8, y: 14 },
  { x: 8, y: 13 }, { x: 8, y: 12 }, { x: 8, y: 11 }, { x: 8, y: 10 }, { x: 8, y: 9 },
  { x: 9, y: 8 }, { x: 10, y: 8 }, { x: 11, y: 8 }, { x: 12, y: 8 }, { x: 13, y: 8 }, { x: 14, y: 8 },
  { x: 14, y: 7 }, { x: 14, y: 6 },
  { x: 13, y: 6 }, { x: 12, y: 6 }, { x: 11, y: 6 }, { x: 10, y: 6 }, { x: 9, y: 6 },
  { x: 8, y: 5 }, { x: 8, y: 4 }, { x: 8, y: 3 }, { x: 8, y: 2 }, { x: 8, y: 1 }, { x: 8, y: 0 },
  { x: 7, y: 0 }, { x: 6, y: 0 },
];

const HOME_CELLS: Record<number, { x: number; y: number }[]> = {
  0: [{ x: 7, y: 1 }, { x: 7, y: 2 }, { x: 7, y: 3 }, { x: 7, y: 4 }, { x: 7, y: 5 }, { x: 7, y: 6 }], // red
  1: [{ x: 1, y: 7 }, { x: 2, y: 7 }, { x: 3, y: 7 }, { x: 4, y: 7 }, { x: 5, y: 7 }, { x: 6, y: 7 }], // green
  2: [{ x: 7, y: 13 }, { x: 7, y: 12 }, { x: 7, y: 11 }, { x: 7, y: 10 }, { x: 7, y: 9 }, { x: 7, y: 8 }], // yellow
  3: [{ x: 13, y: 7 }, { x: 12, y: 7 }, { x: 11, y: 7 }, { x: 10, y: 7 }, { x: 9, y: 7 }, { x: 8, y: 7 }], // blue
};

const BASE_CENTERS: Record<number, { x: number; y: number }> = {
  0: { x: 2, y: 2 },
  1: { x: 2, y: 11 },
  2: { x: 11, y: 11 },
  3: { x: 11, y: 2 },
};

const BASE_SLOTS: Record<number, { x: number; y: number }[]> = {
  0: [{ x: 1.5, y: 1.5 }, { x: 3.5, y: 1.5 }, { x: 1.5, y: 3.5 }, { x: 3.5, y: 3.5 }],
  1: [{ x: 1.5, y: 10.5 }, { x: 3.5, y: 10.5 }, { x: 1.5, y: 12.5 }, { x: 3.5, y: 12.5 }],
  2: [{ x: 10.5, y: 10.5 }, { x: 12.5, y: 10.5 }, { x: 10.5, y: 12.5 }, { x: 12.5, y: 12.5 }],
  3: [{ x: 10.5, y: 1.5 }, { x: 12.5, y: 1.5 }, { x: 10.5, y: 3.5 }, { x: 12.5, y: 3.5 }],
};

export type LudoBoardProps = {
  game: LudoGame;
  cellPx: number;
  mySeat: number | null;
  canMove: boolean;
  onTokenPress?: (seat: number, tokenIndex: number) => void;
};

export function LudoBoard({ game, cellPx, mySeat, canMove, onTokenPress }: LudoBoardProps) {
  const size = cellPx * BOARD;
  const tokenPx = Math.max(16, cellPx * 0.72);

  const tokens = useMemo(() => {
    // Flatten all 4 seats × 4 tokens into render items with cell coords.
    const items: {
      seat: number;
      ti: number;
      cx: number;
      cy: number;
      color: string;
      rawToken: { in_base: boolean; steps: number };
      render: LudoTokenRender;
    }[] = [];
    for (let seat = 0; seat < 4; seat++) {
      const toks = game.state.tokens[String(seat)] || [];
      // Count tokens on each cell to spread duplicates slightly.
      const bySpot: Record<string, number> = {};
      toks.forEach((t, ti) => {
        const r = renderToken(t, seat);
        const cell = cellForRender(r, seat);
        if (!cell) return;
        const key = `${Math.round(cell.x * 2)}:${Math.round(cell.y * 2)}`;
        bySpot[key] = (bySpot[key] || 0) + 1;
        items.push({
          seat, ti,
          cx: cell.x, cy: cell.y,
          color: SEAT_COLOR[seat],
          rawToken: t,
          render: r,
        });
      });
    }
    return items;
  }, [game.state.tokens]);

  const dice = game.state.dice;
  const turnSeat = game.state.current_turn;

  return (
    <View style={[styles.boardWrap, { width: size, height: size }]}>
      <View style={styles.board}>
        {/* Base quadrants (colored squares) */}
        {([0, 1, 2, 3] as const).map((seat) => {
          const c = BASE_CENTERS[seat];
          return (
            <View
              key={`base-${seat}`}
              style={[
                styles.baseQuad,
                {
                  left: (c.x - 2) * cellPx,
                  top: (c.y - 2) * cellPx,
                  width: cellPx * 6,
                  height: cellPx * 6,
                  backgroundColor: SEAT_COLOR[seat] + "33",
                  borderColor: SEAT_COLOR[seat],
                },
              ]}
            >
              {/* Inner white base circle */}
              <View style={styles.baseInner}>
                {BASE_SLOTS[seat].map((_, i) => {
                  const p = BASE_SLOTS[seat][i];
                  return (
                    <View
                      key={i}
                      style={[
                        styles.baseSlot,
                        {
                          left: (p.x - (c.x - 2)) * cellPx - cellPx / 2,
                          top: (p.y - (c.y - 2)) * cellPx - cellPx / 2,
                          width: cellPx,
                          height: cellPx,
                          borderColor: SEAT_COLOR[seat],
                        },
                      ]}
                    />
                  );
                })}
              </View>
            </View>
          );
        })}

        {/* Track cells */}
        {TRACK_CELLS.map((c, idx) => (
          <View
            key={`track-${idx}`}
            style={[
              styles.trackCell,
              {
                left: c.x * cellPx,
                top: c.y * cellPx,
                width: cellPx,
                height: cellPx,
                // highlight starting cells by color
                backgroundColor:
                  idx === 0 ? SEAT_COLOR[0] + "55" :
                  idx === 13 ? SEAT_COLOR[1] + "55" :
                  idx === 26 ? SEAT_COLOR[2] + "55" :
                  idx === 39 ? SEAT_COLOR[3] + "55" :
                  colors.surface,
              },
            ]}
          />
        ))}

        {/* Home columns */}
        {([0, 1, 2, 3] as const).map((seat) =>
          HOME_CELLS[seat].slice(0, 5).map((c, i) => (
            <View
              key={`home-${seat}-${i}`}
              style={[
                styles.trackCell,
                {
                  left: c.x * cellPx,
                  top: c.y * cellPx,
                  width: cellPx,
                  height: cellPx,
                  backgroundColor: SEAT_COLOR[seat] + "55",
                  borderColor: SEAT_COLOR[seat],
                },
              ]}
            />
          )),
        )}

        {/* Center triangles (finish) */}
        <View style={[styles.centerBox, { left: 6 * cellPx, top: 6 * cellPx, width: cellPx * 3, height: cellPx * 3 }]} />

        {/* Tokens */}
        {tokens.map((it) => {
          const myTurn = canMove && mySeat === turnSeat && it.seat === turnSeat && dice !== null;
          const isValid = myTurn && isValidMove(it.rawToken, dice ?? 0);
          return (
            <Pressable
              key={`t-${it.seat}-${it.ti}`}
              onPress={() => isValid && onTokenPress && onTokenPress(it.seat, it.ti)}
              style={[
                styles.token,
                {
                  width: tokenPx,
                  height: tokenPx,
                  borderRadius: tokenPx / 2,
                  backgroundColor: it.color,
                  // Center-anchor the token at the cell centre.
                  left: it.cx * cellPx - tokenPx / 2 + cellPx / 2,
                  top: it.cy * cellPx - tokenPx / 2 + cellPx / 2,
                  borderWidth: isValid ? 3 : 2,
                  borderColor: isValid ? colors.gold : "#000",
                },
              ]}
              testID={`token-${it.seat}-${it.ti}`}
              disabled={!isValid}
            />
          );
        })}
      </View>
    </View>
  );
}

function renderToken(tok: { in_base: boolean; steps: number }, seat: number): LudoTokenRender {
  if (tok.in_base) return { zone: "base", pos: 0 };
  if (tok.steps >= 57) return { zone: "finish", pos: 0 };
  if (tok.steps >= 52) return { zone: "home", pos: tok.steps - 52 };
  const START: Record<number, number> = { 0: 0, 1: 13, 2: 26, 3: 39 };
  return { zone: "track", pos: (START[seat] + tok.steps) % 52 };
}

function cellForRender(r: LudoTokenRender, seat: number): { x: number; y: number } | null {
  if (r.zone === "base") {
    // Use base slot — stable positions.
    const slots = BASE_SLOTS[seat];
    // In base we can't distinguish token indexes here; caller spreads them visually.
    // Return the base center for all; UI accepts overlapping circles.
    const c = BASE_CENTERS[seat];
    return { x: c.x, y: c.y };
  }
  if (r.zone === "finish") {
    return { x: 7, y: 7 }; // center
  }
  if (r.zone === "home") {
    const cells = HOME_CELLS[seat];
    const c = cells[Math.min(5, Math.max(0, r.pos))];
    return c ?? null;
  }
  // track
  const c = TRACK_CELLS[r.pos];
  return c ?? null;
}

function isValidMove(tok: { in_base: boolean; steps: number }, roll: number): boolean {
  if (!tok) return false;
  if (!tok.in_base && tok.steps >= 57) return false;
  if (tok.in_base) return roll === 6;
  return tok.steps + roll <= 57;
}

const styles = StyleSheet.create({
  boardWrap: { backgroundColor: "#F5F5F5", borderRadius: 6, overflow: "hidden" },
  board: { flex: 1 },
  baseQuad: { position: "absolute", borderWidth: 2, alignItems: "center", justifyContent: "center" },
  baseInner: { flex: 1, backgroundColor: "#FFFFFF" },
  baseSlot: { position: "absolute", borderWidth: 2, borderRadius: 999, backgroundColor: "#FFFFFF" },
  trackCell: { position: "absolute", borderWidth: 1, borderColor: "#9E9E9E", backgroundColor: "#FAFAFA" },
  centerBox: { position: "absolute", backgroundColor: "#424242" },
  token: { position: "absolute", borderWidth: 2, borderColor: "#000" },
});

export default LudoBoard;
