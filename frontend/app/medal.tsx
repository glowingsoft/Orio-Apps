import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Image } from "react-native";
import { useQuery } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/ionicons";
import { apiMyMedals } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { colors, spacing, radius } from "@/src/theme";
import { ScreenHeader, TabBar, EmptyState, cosmeticStyles } from "@/src/cosmetics/ui";

type Tab = "my_badges" | "activity_badges";

export default function MedalScreen() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [tab, setTab] = useState<Tab>("my_badges");
  const { data, isLoading } = useQuery({ queryKey: ["medals"], queryFn: apiMyMedals });
  const badges = (data?.[tab] ?? []) as any[];

  return (
    <View style={cosmeticStyles.container} testID="medal-screen">
      <ScreenHeader testID="medal" title={ar ? "ميدالية" : "Medal"} />
      <TabBar
        tabs={[
          { id: "my_badges" as Tab, icon: "medal-outline", label: ar ? "شاراتي" : "My Badges" },
          { id: "activity_badges" as Tab, icon: "trophy-outline", label: ar ? "شارات الأنشطة" : "Activity Badges" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {isLoading ? (
        <ActivityIndicator color={colors.gold} style={{ marginTop: spacing.xl }} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }}>
          {/* All badges are shown in this top badge section. */}
          <View style={styles.badgeSection} testID="medal-badge-section">
            {badges.length === 0 ? (
              <EmptyState icon="medal-outline" text={ar ? "لا توجد شارات بعد" : "No badges yet"} />
            ) : (
              <View style={styles.badgeGrid}>
                {badges.map((b) => (
                  <View key={b.id} style={[styles.badge, !b.earned && { opacity: 0.45 }]} testID={`badge-${b.id}`}>
                    {b.image_url ? (
                      <Image source={{ uri: b.image_url }} style={styles.badgeImg} />
                    ) : (
                      <View style={[styles.badgeImg, styles.badgeImgEmpty]}><Icon name="medal" size={26} color={colors.gold} /></View>
                    )}
                    <Text style={styles.badgeName} numberOfLines={2}>{ar ? b.name_ar || b.name_en : b.name_en || b.name_ar}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badgeSection: { margin: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  badgeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  badge: { width: "29%", alignItems: "center", gap: 6 },
  badgeImg: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.surfaceTertiary },
  badgeImgEmpty: { alignItems: "center", justifyContent: "center" },
  badgeName: { color: colors.onSurface, fontSize: 11, fontWeight: "700", textAlign: "center" },
});
