/**
 * Billiards Board — CLIENT-SIDE RENDERING ONLY.
 *
 * Every ball position comes from the backend. When the backend returns a shot
 * trajectory ("last_shot.frames"), the client plays the frames back for
 * animation. The client never computes a result.
 */
import { View, StyleSheet, Pressable, Text } from "react-native";
import { useEffect, useRef, useState } from "react";
import type { BilliardsGame, BilliardsBall, BilliardsShotFrame } from "@/src/api";

const BALL_COLORS: Record<string, string> = {
  white: "#FFFFFF",
  red: "#E53935",
  yellow: "#FDD835",
  blue: "#1E88E5",
  green: "#43A047",
  purple: "#8E24AA",
  orange: "#FB8C00",
};

export type BilliardsBoardProps = {
  game: BilliardsGame;
  width: number;        // pixels
  myTurn: boolean;
  aimAngle: number;      // degrees — client aiming hint
  onTapTable?: (x: number, y: number) => void;  // target in TABLE units
};

export function BilliardsBoard({ game, width, myTurn, aimAngle, onTapTable }: BilliardsBoardProps) {
  const T = game.table;
  const scale = width / T.w;
  const height = T.h * scale;

  // Animated ball positions. We lerp through frames whenever last_shot changes.
  const [renderBalls, setRenderBalls] = useState<BilliardsBall[]>(game.state.balls);
  const lastShotSeqRef = useRef<number>(game.state.last_shot?.seq ?? -1);

  useEffect(() => {
    const shot = game.state.last_shot;
    // If no new shot — snap to current server state.
    if (!shot || shot.seq === lastShotSeqRef.current) {
      setRenderBalls(game.state.balls);
      return;
    }
    lastShotSeqRef.current = shot.seq;
    // Replay frames at ~30fps.
    const frames = shot.frames;
    if (!frames || frames.length === 0) {
      setRenderBalls(game.state.balls);
      return;
    }
    let i = 0;
    let cancelled = false;
    const step = () => {
      if (cancelled) return;
      const frame: BilliardsShotFrame = frames[i];
      // Merge frame positions with authoritative color/is_cue data.
      setRenderBalls((prev) => prev.map((b) => {
        const f = frame.find((fb) => fb.id === b.id);
        if (!f) return b;
        return { ...b, x: f.x, y: f.y, pocketed: f.pocketed };
      }));
      i++;
      if (i < frames.length) {
        requestAnimationFrame(step);
      } else {
        // Snap to final server state after animation.
        setRenderBalls(game.state.balls);
      }
    };
    requestAnimationFrame(step);
    return () => { cancelled = true; };
  }, [game.state.last_shot?.seq, game.state.balls]);

  const cue = renderBalls.find((b) => b.is_cue && !b.pocketed);

  return (
    <View
      style={[styles.wrap, { width, height }]}
      onStartShouldSetResponder={() => !!onTapTable && myTurn}
      onResponderRelease={(e) => {
        if (!onTapTable) return;
        const { locationX, locationY } = e.nativeEvent;
        const tx = locationX / scale;
        const ty = locationY / scale;
        onTapTable(tx, ty);
      }}
      testID="billiards-board"
    >
      {/* Felt */}
      <View style={styles.felt} />

      {/* Pockets */}
      {T.pockets.map(([px, py], i) => (
        <View
          key={`p-${i}`}
          style={[styles.pocket, {
            left: px * scale - T.pocket_r * scale,
            top: py * scale - T.pocket_r * scale,
            width: T.pocket_r * 2 * scale,
            height: T.pocket_r * 2 * scale,
            borderRadius: T.pocket_r * scale,
          }]}
        />
      ))}

      {/* Aim line from cue (if my turn) */}
      {myTurn && cue && (
        <AimLine
          cx={cue.x * scale}
          cy={cue.y * scale}
          angleDeg={aimAngle}
          length={Math.min(width, height) * 0.5}
        />
      )}

      {/* Balls */}
      {renderBalls.map((b) => (
        !b.pocketed ? (
          <View
            key={b.id}
            style={[styles.ball, {
              left: b.x * scale - T.ball_r * scale,
              top: b.y * scale - T.ball_r * scale,
              width: T.ball_r * 2 * scale,
              height: T.ball_r * 2 * scale,
              borderRadius: T.ball_r * scale,
              backgroundColor: BALL_COLORS[b.color] ?? "#FFFFFF",
              borderWidth: b.is_cue ? 0 : 1,
              borderColor: "#1A1A1A",
            }]}
            pointerEvents="none"
          />
        ) : null
      ))}
    </View>
  );
}

function AimLine({ cx, cy, angleDeg, length }: { cx: number; cy: number; angleDeg: number; length: number }) {
  // Draw a thin dashed line from (cx,cy) along angleDeg. Use absolute-positioned
  // dots for a dependency-free dashed effect.
  const rad = (angleDeg * Math.PI) / 180;
  const dots: Array<{ x: number; y: number }> = [];
  const n = 14;
  for (let i = 1; i <= n; i++) {
    const t = (i * length) / n;
    dots.push({ x: cx + Math.cos(rad) * t, y: cy + Math.sin(rad) * t });
  }
  return (
    <>
      {dots.map((d, i) => (
        <View key={i} style={[styles.aimDot, { left: d.x - 2, top: d.y - 2 }]} />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative", borderRadius: 10, overflow: "hidden" },
  felt: { ...StyleSheet.absoluteFill, backgroundColor: "#0E6B3A" },
  pocket: { position: "absolute", backgroundColor: "#000000" },
  ball: { position: "absolute" },
  aimDot: { position: "absolute", width: 4, height: 4, borderRadius: 2, backgroundColor: "#FFFFFFBB" },
});

export default BilliardsBoard;
