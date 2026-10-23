/** Iter-134 — private chat gift sheet using the real gift system (diamonds, Wealth/Charm). */
import React, { useMemo, useState } from "react";
import { Modal, View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { apiDmGift, apiGifts, apiListMyCustomGifts } from "@/src/api";
import { GiftCard } from "@/src/room/GiftCard";
import { useAuth } from "@/src/auth-context";
import { Diamond } from "@/src/components/Diamond";
import { colors, spacing, radius } from "@/src/theme";

// Same catalog, order, categories and card design as the room gift panel.
const QTYS = [1, 7, 77];
export const GIFT_CATEGORIES: { key: string; en: string; ar: string }[] = [
  { key: "gift", en: "Gift", ar: "هدية" },
  { key: "lucky", en: "Lucky", ar: "محظوظ" },
  { key: "privilege", en: "Privilege", ar: "امتيازات" },
  { key: "custom", en: "Custom", ar: "مخصص" },
  { key: "relationship", en: "Relationship", ar: "علاقة" },
  { key: "fashion", en: "Fashion", ar: "أزياء" },
  { key: "countries", en: "Countries", ar: "الدول" },
];

export function ChatGiftSheet({ recipientId, ar, onClose, onSent }: { recipientId: string; ar: boolean; onClose: () => void; onSent: () => void }) {
  const insets = useSafeAreaInsets();
  const { user, refresh } = useAuth();
  const { data: gifts = [], isLoading } = useQuery({ queryKey: ["gifts", "v2"], queryFn: apiGifts, staleTime: 0, refetchOnMount: "always" });
  const { data: customData } = useQuery({ queryKey: ["custom-gifts-mine"], queryFn: apiListMyCustomGifts });
  const [cat, setCat] = useState("gift");
  const [sel, setSel] = useState<any>(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const list = useMemo(() => {
    if (cat === "custom") return (customData?.items ?? []).filter((g: any) => g.status === "approved").map((g: any) => ({ ...g, id: g.gift_id }));
    const all = (gifts as any[]).filter((g) => g.active !== false);
    if (cat === "gift") return all.filter((g) => !g.category || g.category === "gift");
    return all.filter((g) => g.category === cat);
  }, [gifts, customData, cat]);
  const cost = (sel?.price || 0) * qty;

  const send = async () => {
    if (!sel) return;
    setBusy(true); setErr(null);
    try {
      await apiDmGift(recipientId, sel.id, qty, `dm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
      await refresh();
      onSent();
      onClose();
    } catch (e: any) {
      const m = String(e?.message || "");
      setErr(m.toLowerCase().includes("insufficient") ? (ar ? "رصيد الماس غير كافٍ" : "Not enough Diamonds") : (ar ? "تعذّر إرسال الهدية" : "Could not send the gift"));
    } finally { setBusy(false); }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]} testID="chat-gift-sheet">
        <View style={styles.head}>
          <Text style={styles.title}>{ar ? "إرسال هدية" : "Send a gift"}</Text>
          <View style={styles.bal}><Diamond size={14} /><Text style={styles.balText}>{Number(user?.coins ?? 0).toLocaleString("en-US")}</Text></View>
        </View>
        {isLoading ? <ActivityIndicator color={colors.gold} style={{ margin: spacing.xl }} /> : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catRow} style={{ flexGrow: 0 }}>
              {GIFT_CATEGORIES.map((c) => (
                <Pressable key={c.key} testID={`chat-gift-cat-${c.key}`} onPress={() => { setCat(c.key); setSel(null); }} style={[styles.catChip, cat === c.key && styles.catChipOn]}>
                  <Text style={[styles.catText, cat === c.key && { color: colors.brandPrimary }]}>{ar ? c.ar : c.en}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={styles.grid}>
              {list.length === 0 && <Text style={styles.empty}>{ar ? "لا توجد هدايا في هذه الفئة" : "No gifts in this category yet."}</Text>}
              {list.map((g: any) => (
                <GiftCard key={g.id} gift={g} selected={sel?.id === g.id} onSelect={() => setSel(g)} />
              ))}
            </ScrollView>
          </>
        )}
        {!!err && <Text style={styles.err} testID="chat-gift-error">{err}</Text>}
        <View style={styles.foot}>
          <View style={styles.qtys}>
            {QTYS.map((q) => (
              <Pressable key={q} onPress={() => setQty(q)} style={[styles.qty, qty === q && styles.qtyOn]} testID={`chat-gift-qty-${q}`}>
                <Text style={[styles.qtyText, qty === q && { color: colors.onBrandPrimary }]}>{`x${q}`}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable testID="chat-gift-send" disabled={!sel || busy} onPress={send} style={[styles.send, (!sel || busy) && { opacity: 0.5 }]}>
            {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
              <>
                <Icon name="gift" size={16} color={colors.onBrandPrimary} />
                <Text style={styles.sendText}>{sel ? cost.toLocaleString("en-US") : (ar ? "إرسال" : "Send")}</Text>
              </>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  sheet: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: spacing.md },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  title: { color: colors.onSurface, fontSize: 16, fontWeight: "800" },
  bal: { flexDirection: "row", alignItems: "center", gap: 4 },
  balText: { color: colors.onSurface, fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: spacing.md, gap: spacing.sm, paddingBottom: spacing.md },
  catRow: { paddingHorizontal: spacing.md, gap: 6, paddingBottom: 8 },
  catChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  catChipOn: { borderColor: colors.brandPrimary },
  catText: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  empty: { color: colors.muted, fontSize: 12, textAlign: "center", width: "100%", padding: spacing.lg, fontStyle: "italic" },
  cell: { width: "23%", alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: "transparent" },
  cellOn: { borderColor: colors.gold, backgroundColor: colors.surfaceTertiary },
  img: { width: 44, height: 44 },
  gname: { color: colors.onSurface, fontSize: 11, marginTop: 4, maxWidth: "90%" },
  price: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 2 },
  priceText: { color: colors.muted, fontSize: 10, fontWeight: "700" },
  err: { color: colors.error, textAlign: "center", marginTop: spacing.sm, fontWeight: "700" },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, marginTop: spacing.md, gap: spacing.sm },
  qtys: { flexDirection: "row", gap: 6 },
  qty: { paddingHorizontal: 10, height: 32, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  qtyOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  qtyText: { color: colors.onSurface, fontWeight: "800", fontSize: 12 },
  send: { flexDirection: "row", alignItems: "center", gap: 6, height: 44, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.gold },
  sendText: { color: colors.onBrandPrimary, fontWeight: "800" },
});
