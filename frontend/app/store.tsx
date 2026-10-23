import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiCosmeticsStore, apiCosmeticPurchase, apiBagEquip } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { useAuth } from "@/src/auth-context";
import { colors, spacing, radius } from "@/src/theme";
import { COSMETIC_TABS, ScreenHeader, TabBar, EmptyState, ItemCard, ItemModal, PriceTag, cosmeticStyles } from "@/src/cosmetics/ui";

type Cat = (typeof COSMETIC_TABS)[number]["id"];

export default function StoreScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { refresh } = useAuth();
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [cat, setCat] = useState<Cat>("frames");
  const [sel, setSel] = useState<any | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["store", cat], queryFn: () => apiCosmeticsStore(cat) });
  const items = data?.items ?? [];

  const equip = useMutation({
    mutationFn: (it: any) => apiBagEquip({ category: cat, item_id: it.id, source: "store" }, !it.equipped),
    onSuccess: async () => {
      setSel(null);
      await qc.invalidateQueries({ queryKey: ["store"] });
      qc.invalidateQueries({ queryKey: ["bag"] });
    },
    onError: (e: any) => Alert.alert(ar ? "خطأ" : "Error", e?.message || "Failed"),
  });

  const buy = useMutation({
    mutationFn: (id: string) => apiCosmeticPurchase(id),
    onSuccess: async () => {
      setSel(null);
      Alert.alert(ar ? "تم الشراء" : "Purchased", ar ? "أُضيف العنصر إلى حقيبتك" : "Item added to your bag");
      await refresh();
      await qc.invalidateQueries({ queryKey: ["store"] });
      await qc.invalidateQueries({ queryKey: ["bag"] });
    },
    onError: (e: any) => Alert.alert(ar ? "خطأ" : "Error", e?.message || "Failed"),
  });

  return (
    <View style={cosmeticStyles.container} testID="store-screen">
      <ScreenHeader
        testID="store"
        title={ar ? "المتجر" : "Store"}
        sideIcon="briefcase-outline"
        sideTestID="store-open-bag"
        onSide={() => router.push("/bag" as any)}
      />
      <TabBar scroll tabs={COSMETIC_TABS.map((c) => ({ id: c.id, icon: c.icon, label: ar ? c.ar : c.en }))} value={cat} onChange={setCat} />
      {isLoading ? (
        <ActivityIndicator color={colors.gold} style={{ marginTop: spacing.xl }} />
      ) : items.length === 0 ? (
        <EmptyState icon="storefront-outline" text={ar ? "لا توجد عناصر بعد" : "No items yet"} />
      ) : (
        <ScrollView contentContainerStyle={cosmeticStyles.grid}>
          {items.map((it: any) => (
            <ItemCard
              key={it.id}
              item={it}
              testID={`store-item-${it.id}`}
              onPress={() => setSel(it)}
              footer={
                <>
                  <PriceTag price={it.price} />
                  <Pressable
                    testID={`store-buy-${it.id}`}
                    disabled={buy.isPending || (it.owned && !it.duration_days)}
                    onPress={() => buy.mutate(it.id)}
                    style={[styles.buyBtn, it.owned && !it.duration_days && styles.ownedBtn]}
                  >
                    <Text style={styles.buyText}>
                      {it.owned && !it.duration_days ? (ar ? "مملوك" : "Owned") : (ar ? "شراء" : "Buy")}
                    </Text>
                  </Pressable>
                </>
              }
            />
          ))}
        </ScrollView>
      )}
      <ItemModal
        item={sel}
        onClose={() => setSel(null)}
        actions={!sel ? [] : sel.owned ? [{
          key: sel.equipped ? "unequip" : "wear",
          icon: sel.equipped ? "remove-circle-outline" : "shirt-outline",
          label: sel.equipped ? (ar ? "إزالة" : "Unequip") : (ar ? "ارتداء" : "Wear"),
          tone: sel.equipped ? "ghost" : "solid",
          busy: equip.isPending,
          onPress: () => equip.mutate(sel),
        }] : [{
          key: "buy",
          icon: "cart-outline",
          label: `${ar ? "شراء" : "Buy"} · ${Number(sel.price).toLocaleString()}`,
          busy: buy.isPending,
          onPress: () => buy.mutate(sel.id),
        }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  buyBtn: { backgroundColor: colors.gold, borderRadius: radius.pill, paddingVertical: 6, alignItems: "center" },
  ownedBtn: { backgroundColor: colors.surfaceTertiary },
  buyText: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 12 },
});
