/** Batch B — emoji reaction picker (bottom sheet, categories, cooldown-aware). */
import React, { useMemo, useState } from "react";
import { Modal, View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { REACTIONS, REACTION_CATS, ReactionCat, reactionStill, isMirrored } from "./emojis";
import { colors, spacing, radius } from "@/src/theme";

export function EmojiPicker({ visible, isRTL, onPick, onClose }: {
  visible: boolean; isRTL: boolean; onPick: (key: string) => void; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [cat, setCat] = useState<ReactionCat | "all">("all");
  const list = useMemo(() => (cat === "all" ? REACTIONS : REACTIONS.filter((r) => r.cat === cat)), [cat]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]} onPress={(e) => e.stopPropagation()} testID="emoji-picker">
          <View style={styles.handle} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cats}>
            {[{ key: "all" as const, en: "All", ar: "الكل" }, ...REACTION_CATS].map((c) => {
              const active = cat === c.key;
              return (
                <Pressable key={c.key} onPress={() => setCat(c.key)} style={[styles.cat, active && styles.catActive]} testID={`emoji-cat-${c.key}`}>
                  <Text style={[styles.catText, active && { color: colors.brandPrimary }]}>{isRTL ? c.ar : c.en}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.grid}>
            {list.map((r) => (
              <Pressable key={r.key} style={styles.cell} onPress={() => onPick(r.key)} testID={`emoji-${r.key}`}>
                <Image source={{ uri: reactionStill(r.key) }} style={[styles.img, isMirrored(r.key) && { transform: [{ scaleX: -1 }] }]} contentFit="contain" />
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: spacing.sm },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.sm },
  cats: { paddingHorizontal: spacing.md, gap: 6, paddingBottom: spacing.sm },
  cat: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  catActive: { borderColor: colors.brandPrimary },
  catText: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: spacing.sm },
  cell: { width: "20%", aspectRatio: 1, alignItems: "center", justifyContent: "center" },
  img: { width: 44, height: 44 },
});
