import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiMyBag, apiBagEquip } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { colors, spacing } from "@/src/theme";
import { COSMETIC_TABS, ScreenHeader, TabBar, EmptyState, ItemCard, ItemModal, cosmeticStyles } from "@/src/cosmetics/ui";
import { ENTRANCE_EFFECTS } from "@/src/entrance/effects";
import { EntranceRewardModal } from "@/src/entrance/EntranceRewardModal";

type Cat = (typeof COSMETIC_TABS)[number]["id"];

export default function BagScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [cat, setCat] = useState<Cat>("frames");
  const [sel, setSel] = useState<any | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["bag", cat], queryFn: () => apiMyBag(cat) });
  const items = data?.items ?? [];

  const equip = useMutation({
    mutationFn: (it: any) => apiBagEquip({ category: cat, item_id: it.id, source: it.source }, !it.equipped),
    onSuccess: async () => {
      setSel(null);
      await qc.invalidateQueries({ queryKey: ["bag"] });
      qc.invalidateQueries({ queryKey: ["store"] });
    },
    onError: (e: any) => {
      const msg = String(e?.message || "");
      Alert.alert(ar ? "خطأ" : "Error", msg.includes("ROOM_REQUIRED") ? (ar ? "يجب أن تمتلك غرفة أولاً" : "You need to own a room first") : msg);
    },
  });

  return (
    <View style={cosmeticStyles.container} testID="bag-screen">
      <ScreenHeader
        testID="bag"
        title={ar ? "حقيبتي" : "My Bag"}
        sideIcon="storefront-outline"
        sideTestID="bag-open-store"
        onSide={() => router.push("/store" as any)}
      />
      <TabBar scroll tabs={COSMETIC_TABS.map((c) => ({ id: c.id, icon: c.icon, label: ar ? c.ar : c.en }))} value={cat} onChange={setCat} />
      {isLoading ? (
        <ActivityIndicator color={colors.gold} style={{ marginTop: spacing.xl }} />
      ) : items.length === 0 ? (
        <EmptyState text={ar ? "لا توجد عناصر بعد" : "No items yet"} />
      ) : (
        <ScrollView contentContainerStyle={cosmeticStyles.grid}>
          {items.map((it: any) => (
            <ItemCard
              key={`${it.source}-${it.id}`}
              item={it}
              testID={`bag-item-${it.id}`}
              onPress={() => setSel(it)}
              imageSource={it.effect_key ? ENTRANCE_EFFECTS[it.effect_key]?.thumb : undefined}
              footer={it.source === "vip" ? (
                <Text style={[styles.sub, it.expired && styles.expired]} testID={`bag-item-${it.id}-status`}>
                  {it.expired ? (ar ? "منتهي" : "Expired") : `VIP${it.vip_min}`}
                </Text>
              ) : it.expires_at ? (
                <Text style={styles.sub}>{`${ar ? "ينتهي" : "Expires"} ${new Date(it.expires_at).toLocaleDateString()}`}</Text>
              ) : (
                <Text style={styles.sub}>{ar ? "دائم" : "Permanent"}</Text>
              )}
            />
          ))}
        </ScrollView>
      )}
      <EntranceRewardModal
        item={sel?.effect_key ? sel : null}
        onClose={() => setSel(null)}
        busy={equip.isPending}
        onToggle={() => equip.mutate(sel)}
      />
      <ItemModal
        item={sel?.effect_key ? null : sel}
        onClose={() => setSel(null)}
        actions={sel?.can_wear ? [{
          key: sel.equipped ? "unequip" : "wear",
          icon: sel.equipped ? "remove-circle-outline" : "shirt-outline",
          label: sel.equipped ? (ar ? "إزالة" : "Unequip") : (ar ? "ارتداء" : "Wear"),
          tone: sel.equipped ? "ghost" : "solid",
          busy: equip.isPending,
          onPress: () => equip.mutate(sel),
        }] : []}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sub: { color: colors.muted, fontSize: 11, textAlign: "center", fontWeight: "600" },
  expired: { color: colors.error, fontWeight: "800" },
});
