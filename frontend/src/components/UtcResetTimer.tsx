/**
 * UtcResetTimer — Iter-62.
 *
 * Live countdown to the next period reset based on real UTC time.
 *
 *   - daily    → next 00:00:00 UTC
 *   - weekly   → next Monday 00:00:00 UTC (ISO weeks)
 *   - monthly  → first day of the next UTC month at 00:00:00
 *   - all      → no reset; component renders nothing
 *
 * Updates once per second via setInterval. Automatically re-computes the
 * next boundary when the previous one elapses so the countdown rolls over
 * without a page refresh.
 */
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import Icon from "@react-native-vector-icons/ionicons";
import { colors } from "@/src/theme";

export type ResetPeriod = "daily" | "weekly" | "monthly" | "all";

type Props = {
  period: ResetPeriod;
  compact?: boolean;
  labelAr?: string;
  labelEn?: string;
  isRTL?: boolean;
};

function nextResetMs(period: ResetPeriod, now: Date): number {
  const n = now.getTime();
  if (period === "daily") {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0)
    );
    return d.getTime() - n;
  }
  if (period === "weekly") {
    // ISO week: Monday as start of week.
    const dow = now.getUTCDay(); // 0=Sun..6=Sat
    const daysUntilMonday = (8 - (dow === 0 ? 7 : dow)) % 7 || 7;
    const d = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + daysUntilMonday,
        0, 0, 0, 0
      )
    );
    return d.getTime() - n;
  }
  if (period === "monthly") {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0)
    );
    return d.getTime() - n;
  }
  return 0;
}

function fmt(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const two = (n: number) => (n < 10 ? `0${n}` : String(n));
  if (days > 0) return `${days}d ${two(hours)}:${two(mins)}:${two(secs)}`;
  return `${two(hours)}:${two(mins)}:${two(secs)}`;
}

export function UtcResetTimer({ period, compact, labelAr, labelEn, isRTL }: Props) {
  const [remaining, setRemaining] = useState<number>(() => nextResetMs(period, new Date()));

  useEffect(() => {
    // Reset immediately when period switches (daily ↔ weekly ↔ monthly).
    setRemaining(nextResetMs(period, new Date()));
    if (period === "all") return;
    const id = setInterval(() => {
      const now = new Date();
      let r = nextResetMs(period, now);
      if (r <= 0) r = nextResetMs(period, new Date(now.getTime() + 1000));
      setRemaining(r);
    }, 1000);
    return () => clearInterval(id);
  }, [period]);

  const label = useMemo(() => {
    if (isRTL) return labelAr ?? "إعادة التعيين خلال";
    return labelEn ?? "Resets in";
  }, [isRTL, labelAr, labelEn]);

  if (period === "all") return null;

  return (
    <View
      testID="utc-reset-timer"
      style={[
        styles.wrap,
        compact && styles.wrapCompact,
        { flexDirection: "row" },
      ]}
    >
      <Icon name="time-outline" size={compact ? 12 : 14} color={colors.gold} />
      {!compact && <Text style={styles.label}>{label}</Text>}
      <Text style={[styles.value, compact && styles.valueCompact]}>{fmt(remaining)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,214,10,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,214,10,0.35)",
  },
  wrapCompact: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    gap: 4,
  },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
  },
  value: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.5,
  },
  valueCompact: {
    fontSize: 11,
  },
});
