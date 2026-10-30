import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { safeBack } from "@/src/navigation/safeBack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useQuery } from "@tanstack/react-query";
import { apiSystemNotifications, SystemNotification } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { colors, spacing, radius } from "@/src/theme";
import { RowSeparator } from "@/src/components/RowSeparator";

export default function Notifications() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isRTL, t, lang } = useI18n();
  const { data, isLoading } = useQuery({
    queryKey: ["notifications-system"],
    queryFn: apiSystemNotifications,
  });
  const items = data?.items ?? [];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="notifications-screen">
      <View style={[styles.header, { flexDirection: "row" }]}>
        <Pressable onPress={() => safeBack(router)} style={styles.iconBtn} testID="back-btn">
          <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{t.systemNotifications}</Text>
        <View style={{ width: 40 }} />
      </View>
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Icon name="notifications-off-outline" size={56} color={colors.muted} />
          <Text style={styles.emptyText}>{t.systemNotificationsSub}</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          ItemSeparatorComponent={() => <RowSeparator gap={spacing.md} />}
          renderItem={({ item }) => {
            const text = notifText(item, lang === "ar");
            const go = notifHref(item);
            return (
              <View style={styles.card} testID={`notif-${item.id}`}>
                <View style={styles.iconDot}>
                  <Icon name={NOTIF_ICON[item.kind || ""] || "megaphone"} size={16} color={colors.gold} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{text}</Text>
                  {!item.kind && item.body ? <Text style={styles.cardBody}>{item.body}</Text> : null}
                  <Text style={styles.cardTime}>{new Date(item.created_at).toLocaleString()}</Text>
                  {go ? (
                    <Pressable testID={`notif-view-${item.id}`} onPress={() => router.push(go as any)} style={styles.viewNow} hitSlop={8}>
                      <Text style={styles.viewNowText}>{lang === "ar" ? "عرض الآن" : "View Now"}</Text>
                      <Icon name={isRTL ? "chevron-back" : "chevron-forward"} size={14} color={colors.gold} />
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, alignItems: "center", justifyContent: "space-between" },
  title: { color: colors.onSurface, fontSize: 20, fontWeight: "800" },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, paddingHorizontal: spacing.xl },
  emptyText: { color: colors.muted, fontSize: 14, textAlign: "center" },
  card: {
    flexDirection: "row",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconDot: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.gold + "22",
    alignItems: "center", justifyContent: "center",
  },
  cardTitle: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  cardBody: { color: colors.muted, fontSize: 13, marginTop: 4 },
  cardTime: { color: colors.muted, fontSize: 11, marginTop: 6 },
  viewNow: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start", marginTop: spacing.sm, minHeight: 28 },
  viewNowText: { color: colors.gold, fontSize: 13, fontWeight: "800" },
});

// Iter-98 — localized rendering of persisted system notifications.
// User-generated values (usernames, room names, activity names) are inserted verbatim.
const NOTIF_ICON: Record<string, any> = {
  vip_warning: "star", room_kick: "exit-outline", report_received: "shield-checkmark",
  gif_approved: "checkmark-circle", activity_approved: "calendar", activity_rejected: "calendar-outline",
  level_up: "trophy", vip_up: "star", referral_reward: "gift",
};

function notifText(n: SystemNotification, ar: boolean): string {
  const p = n.params || {};
  switch (n.kind) {
    case "level_up": {
      const s = p.system === "charm" ? (ar ? "الجاذبية" : "Charm") : (ar ? "الثروة" : "Wealth");
      return ar ? `تهانينا لوصولك إلى مستوى ${s} LV ${p.level}` : `Congratulations on reaching ${s} LV ${p.level}`;
    }
    case "vip_up":
      return ar ? `تهانينا لوصولك إلى VIP${p.level}` : `Congratulations on reaching VIP${p.level}`;
    case "referral_reward":
      return ar ? `استخدم ${p.username} رمز دعوتك. +${p.amount} ألماسة` : `${p.username} used your referral code. +${p.amount} diamonds`;
    case "vip_warning":
      return ar
        ? `لم تزدد نقاط النمو الحالية لديك. تحتاج إلى ${Number(p.points).toLocaleString()} نقطة إضافية للحفاظ على VIP${p.vip_level}.`
        : `Your current growth points have not increased. You need ${Number(p.points).toLocaleString()} more points to maintain VIP${p.vip_level}.`;
    case "room_kick":
      return ar
        ? `قام ${p.username} (VIP${p.vip_level}) بطردك من ${p.room_name}.`
        : `${p.username} (VIP${p.vip_level}) kicked you from ${p.room_name}.`;
    case "report_received":
      return ar
        ? "لقد استلمنا بلاغك وسنبذل قصارى جهدنا لمعالجته. شكراً لك. فريق يازين."
        : "We received your report and will do our best to handle it. Thank you. Yazeen Team.";
    case "gif_approved":
      return ar ? "تمت الموافقة على صورة GIF الخاصة بك بنجاح." : "Your GIF was successfully approved.";
    case "activity_approved":
      return ar ? `تمت الموافقة على نشاطك "${p.name}".` : `Your activity "${p.name}" was approved.`;
    case "activity_rejected":
      return ar ? `لم تتم الموافقة على نشاطك "${p.name}".` : `Your activity "${p.name}" was not approved.`;
    default:
      return n.title;
  }
}

function notifHref(n: SystemNotification): string | null {
  const a = n.action;
  if (!a) return null;
  if (a.type === "vip") return "/vip";
  if (a.type === "level" && a.id) return `/level?sys=${a.id}`;
  if (a.type === "profile" && a.id) return `/user/${a.id}`;
  if (a.type === "room" && a.id) return `/room/${a.id}`;
  return null;
}
