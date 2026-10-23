/**
 * ORIO Room Ranking — same premium layout as Global Ranking (shared
 * RankingView). Contribution = senders, Charm = recipients, in THIS room;
 * points = diamonds × 10 (server-side). Viewer's real row pinned at bottom.
 */
import { useState, useMemo, useCallback } from "react";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { apiRoomRanking, type RankMetric, type RankPeriod } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { RankingView, type RankEntry } from "@/src/rankings/RankingView";

const toEntry = (it: any): RankEntry => ({ rank: it.rank ?? 0, score: Number(it.amount ?? 0), kind: "user", user: it.user });

export default function RoomRankingScreen() {
  const { isRTL } = useI18n();
  const params = useLocalSearchParams<{ id?: string }>();
  const roomId = typeof params.id === "string" ? params.id : "";
  const [metric, setMetric] = useState<RankMetric>("contribution");
  const [period, setPeriod] = useState<RankPeriod>("daily");
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["room-ranking", roomId, metric, period],
    queryFn: () => apiRoomRanking(roomId, metric, period),
    enabled: !!roomId,
    staleTime: 15_000,
  });
  useFocusEffect(useCallback(() => { if (roomId) refetch(); }, [roomId, refetch]));
  const items = useMemo(() => ((data as any)?.items ?? []).map(toEntry), [data]);
  const me = (data as any)?.me ? toEntry((data as any).me) : null;
  return (
    <RankingView
      title={isRTL ? "ترتيب الغرفة" : "Room Ranking"}
      isRTL={isRTL}
      tabs={[
        { id: "contribution", label: isRTL ? "المساهمة" : "Contribution" },
        { id: "charm", label: isRTL ? "الجاذبية" : "Charm" },
      ]}
      tab={metric}
      onTab={(m) => setMetric(m as RankMetric)}
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
