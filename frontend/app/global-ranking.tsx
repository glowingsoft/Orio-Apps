/**
 * ORIO Global Ranking — points = diamonds spent on gifts × 10 (server-side).
 * Shared RankingView layout; viewer's real row pinned on every tab.
 */
import { useState, useMemo, useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { apiRankingsV3, type RankPeriod } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { RankingView, type RankEntry } from "@/src/rankings/RankingView";

const CATEGORIES = [
  { id: "wealth", en: "Wealth", ar: "الثروة" },
  { id: "charm", en: "Charm", ar: "الجاذبية" },
  { id: "cp", en: "CP", ar: "الشريك" },
  { id: "friendship", en: "Friends", ar: "الأصدقاء" },
  { id: "custom_gifts", en: "Custom Gifts", ar: "هدايا مخصصة" },
  { id: "rooms", en: "Rooms", ar: "الغرف" },
  { id: "family", en: "Family", ar: "العائلة" },
];

function toEntry(row: any): RankEntry {
  if (!row) return row;
  if (row.kind === "room") return { rank: row.rank, score: row.score, kind: "room", room: row.room };
  if (Array.isArray(row.pair)) return { rank: row.rank ?? 0, score: Number(row.score ?? 0), kind: "pair", pair: row.pair };
  return { rank: row.rank ?? 0, score: Number(row.score ?? 0), kind: row.kind ?? "user", user: row };
}

export default function GlobalRankingScreen() {
  const { isRTL } = useI18n();
  const [period, setPeriod] = useState<RankPeriod>("daily");
  const [category, setCategory] = useState("wealth");
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["rankings-v3", category, period],
    queryFn: () => apiRankingsV3(category, period),
    staleTime: 15_000,
  });
  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));
  const items = useMemo(() => (data?.items ?? []).map(toEntry), [data]);
  const me = data?.me ? toEntry(data.me) : null;
  return (
    <RankingView
      title={isRTL ? "ترتيب الداعمين" : "Global Ranking"}
      isRTL={isRTL}
      tabs={CATEGORIES.map((c) => ({ id: c.id, label: isRTL ? c.ar : c.en }))}
      tab={category}
      onTab={setCategory}
      periods={[
        { id: "daily", label: isRTL ? "يومي" : "Daily" },
        { id: "weekly", label: isRTL ? "أسبوعي" : "Weekly" },
        { id: "monthly", label: isRTL ? "شهري" : "Monthly" },
        { id: "all", label: isRTL ? "كل الوقت" : "All Time" },
      ]}
      period={period}
      onPeriod={(p) => setPeriod(p as RankPeriod)}
      items={items}
      me={me}
      loading={isLoading}
      refreshing={isFetching && !isLoading}
      onRefresh={refetch}
    />
  );
}
