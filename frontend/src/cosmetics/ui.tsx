/**
 * Iter-97 — Shared UI for Level / My Bag / Store / Medal screens.
 * Uses ORIO theme tokens; RTL handled natively by I18nManager.
 */
import React from "react";
import { Platform, View, Text, StyleSheet, Pressable, ScrollView, Image, Modal, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useI18n } from "@/src/i18n";
import { Diamond } from "@/src/components/Diamond";
import { colors, spacing, radius } from "@/src/theme";

export const COSMETIC_TABS = [
  { id: "frames", icon: "scan-circle-outline", en: "Frames", ar: "الإطارات" },
  { id: "entrance_effects", icon: "sparkles-outline", en: "Entrance Effects", ar: "تأثيرات الدخول" },
  { id: "room_backgrounds", icon: "image-outline", en: "Room Backgrounds", ar: "خلفيات الغرف" },
  { id: "entry_badges", icon: "ribbon-outline", en: "Entry Badges", ar: "شارات الدخول" },
  { id: "voice_waves", icon: "pulse-outline", en: "Voice Waves", ar: "موجات الصوت" },
  { id: "profile_covers", icon: "albums-outline", en: "Profile Covers", ar: "أغلفة الملف" },
  { id: "chat_bubbles", icon: "chatbubble-ellipses-outline", en: "Chat Bubbles", ar: "فقاعات الدردشة" },
] as const;

export function ScreenHeader({ title, sideIcon, onSide, sideTestID, testID }: {
  title: string; sideIcon?: string; onSide?: () => void; sideTestID?: string; testID?: string;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isRTL, t } = useI18n();
  const goBack = () => {
    // On web a reload/deep link can leave canGoBack() true with no history to pop.
    const hasHistory = Platform.OS !== "web" || (typeof window !== "undefined" && window.history.length > 1);
    if (hasHistory && router.canGoBack()) router.back();
    else router.replace("/(tabs)/me" as any);
  };
  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable testID={testID ? `${testID}-back` : undefined} onPress={goBack} hitSlop={10} style={styles.iconBtn} accessibilityLabel={t.backLabel}>
        <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={22} color={colors.onSurface} />
      </Pressable>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      {sideIcon ? (
        <Pressable testID={sideTestID} onPress={onSide} hitSlop={10} style={styles.iconBtn}>
          <Icon name={sideIcon as any} size={20} color={colors.gold} />
        </Pressable>
      ) : <View style={{ width: 40 }} />}
    </View>
  );
}

export function TabBar<T extends string>({ tabs, value, onChange, scroll, plain }: {
  tabs: { id: T; label: string; icon?: string }[]; value: T; onChange: (v: T) => void; scroll?: boolean;
  /** Iter-101 — no filled pill: white labels, selected = bright glow, unselected = dim. */
  plain?: boolean;
}) {
  const items = tabs.map((tb) => {
    const active = tb.id === value;
    return (
      <Pressable
        key={tb.id}
        testID={`tab-${tb.id}`}
        onPress={() => onChange(tb.id)}
        style={[styles.tab, !scroll && { flex: 1 }, plain ? styles.tabPlain : active && styles.tabActive]}
      >
        {tb.icon ? <Icon name={tb.icon as any} size={14} color={active ? colors.onBrandPrimary : colors.muted} /> : null}
        <Text
          style={plain ? [styles.tabText, active ? styles.tabTextPlainActive : styles.tabTextPlain] : [styles.tabText, active && styles.tabTextActive]}
          numberOfLines={1}
        >{tb.label}</Text>
      </Pressable>
    );
  });
  if (scroll) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={styles.scrollTabs}>
        {items}
      </ScrollView>
    );
  }
  return <View style={[styles.fixedTabs, plain && styles.fixedTabsPlain]}>{items}</View>;
}

export function EmptyState({ icon = "cube-outline", text }: { icon?: string; text: string }) {
  return (
    <View style={styles.empty} testID="empty-state">
      <Icon name={icon as any} size={42} color={colors.muted} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

export function ItemCard({ item, footer, testID, onPress, imageSource }: { item: any; footer?: React.ReactNode; testID?: string; onPress?: () => void; imageSource?: number }) {
  const { lang } = useI18n();
  const name = lang === "ar" ? item.name_ar || item.name_en : item.name_en || item.name_ar;
  return (
    <Pressable style={[styles.card, item.equipped && styles.cardEquipped]} testID={testID} onPress={onPress}>
      {imageSource ? (
        <View style={[styles.cardImg, styles.cardImgEmpty]}>
          <Image source={imageSource} style={styles.cardImgFill} resizeMode="contain" />
        </View>
      ) : item.image_url ? (
        <Image source={{ uri: item.image_url }} style={styles.cardImg} resizeMode="cover" />
      ) : (
        <View style={[styles.cardImg, styles.cardImgEmpty]}><Icon name="cube-outline" size={28} color={colors.muted} /></View>
      )}
      {item.equipped ? (
        <View style={styles.equippedTag}><Icon name="checkmark" size={11} color={colors.onBrandPrimary} /></View>
      ) : null}
      <Text style={styles.cardName} numberOfLines={1}>{name}</Text>
      {footer}
    </Pressable>
  );
}

/** Iter-99 — centered item details modal with real, supported actions only. */
export function ItemModal({ item, onClose, actions }: {
  item: any | null; onClose: () => void;
  actions: { key: string; icon: string; label: string; onPress: () => void; busy?: boolean; tone?: "solid" | "ghost" }[];
}) {
  const { lang } = useI18n();
  if (!item) return null;
  const name = lang === "ar" ? item.name_ar || item.name_en : item.name_en || item.name_ar;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="item-modal-backdrop">
        <Pressable style={styles.modal} onPress={() => {}} testID="item-modal">
          <Pressable onPress={onClose} hitSlop={10} style={styles.modalClose} testID="item-modal-close">
            <Icon name="close" size={18} color={colors.muted} />
          </Pressable>
          {item.image_url ? (
            <Image source={{ uri: item.image_url }} style={styles.modalImg} resizeMode="cover" />
          ) : (
            <View style={[styles.modalImg, styles.cardImgEmpty]}><Icon name="cube-outline" size={36} color={colors.muted} /></View>
          )}
          {name ? <Text style={styles.modalName} testID="item-modal-name">{name}</Text> : null}
          <View style={{ alignSelf: "stretch", gap: spacing.sm }}>
            {actions.map((a) => (
              <Pressable
                key={a.key}
                testID={`item-action-${a.key}`}
                disabled={a.busy}
                onPress={a.onPress}
                style={[styles.modalBtn, a.tone === "ghost" && styles.modalBtnGhost]}
              >
                {a.busy ? <ActivityIndicator color={a.tone === "ghost" ? colors.onSurface : colors.onBrandPrimary} /> : (
                  <>
                    <Icon name={a.icon as any} size={16} color={a.tone === "ghost" ? colors.onSurface : colors.onBrandPrimary} />
                    <Text style={[styles.modalBtnText, a.tone === "ghost" && { color: colors.onSurface }]}>{a.label}</Text>
                  </>
                )}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function PriceTag({ price }: { price: number }) {
  return (
    <View style={styles.price}>
      <Diamond size={12} />
      <Text style={styles.priceText}>{price.toLocaleString()}</Text>
    </View>
  );
}

export const cosmeticStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, padding: spacing.lg },
});

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm, flexShrink: 0 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  fixedTabs: { flexDirection: "row", marginHorizontal: spacing.lg, marginTop: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, padding: 4, flexShrink: 0 },
  scrollTabs: { gap: 8, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  tab: { flexDirection: "row", gap: 6, height: 38, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, flexShrink: 0 },
  tabActive: { backgroundColor: colors.gold },
  tabText: { color: colors.muted, fontWeight: "800", fontSize: 13 },
  tabTextActive: { color: colors.onBrandPrimary },
  // White text on photo backgrounds, so these stay white in both themes.
  fixedTabsPlain: { backgroundColor: "transparent" },
  tabPlain: { backgroundColor: "transparent" },
  tabTextPlain: { color: "rgba(255,255,255,0.55)", backgroundColor: "rgba(0,0,0,0.35)", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3, overflow: "hidden" },
  tabTextPlainActive: {
    color: "#FFFFFF", fontWeight: "900",
    backgroundColor: "rgba(0,0,0,0.35)", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3, overflow: "hidden",
    textShadowColor: "rgba(255,255,255,0.9)", textShadowRadius: 10, textShadowOffset: { width: 0, height: 0 },
  },
  empty: { alignItems: "center", justifyContent: "center", paddingVertical: spacing.xxl, gap: spacing.md },
  emptyText: { color: colors.muted, fontSize: 14, fontWeight: "600" },
  card: { width: "47%", backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.sm, gap: 6, borderWidth: 1, borderColor: colors.border },
  cardImg: { width: "100%", aspectRatio: 1, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  cardImgEmpty: { alignItems: "center", justifyContent: "center" },
  cardImgFill: { position: "absolute", top: "6%", left: "6%", width: "88%", height: "88%" },
  cardName: { color: colors.onSurface, fontSize: 13, fontWeight: "700", textAlign: "center" },
  price: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
  priceText: { color: colors.gold, fontWeight: "900", fontSize: 12 },
  cardEquipped: { borderColor: colors.gold },
  equippedTag: { position: "absolute", top: spacing.sm + 4, right: spacing.sm + 4, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: spacing.xl },
  modal: { width: "100%", maxWidth: 320, backgroundColor: colors.surfaceSecondary, borderRadius: radius.xl, padding: spacing.lg, alignItems: "center", gap: spacing.md, borderWidth: 1, borderColor: colors.border },
  modalClose: { position: "absolute", top: spacing.sm, right: spacing.sm, width: 32, height: 32, alignItems: "center", justifyContent: "center", zIndex: 2 },
  modalImg: { width: 120, height: 120, borderRadius: radius.lg, backgroundColor: colors.surfaceTertiary, marginTop: spacing.md },
  modalName: { color: colors.onSurface, fontSize: 16, fontWeight: "800", textAlign: "center" },
  modalBtn: { flexDirection: "row", gap: 8, height: 46, borderRadius: radius.pill, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center" },
  modalBtnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.border },
  modalBtnText: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 14 },
});
