/** Batch B — gift tile with a short shake on selection (selection never sends). */
import React, { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, Text, View, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { Diamond } from "@/src/components/Diamond";
import { mediaUrl } from "@/src/media/upload";
import { colors, spacing, radius } from "@/src/theme";

export function GiftCard({ gift, selected, onSelect }: { gift: any; selected: boolean; onSelect: () => void }) {
  const rot = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!selected) return;
    rot.setValue(0);
    Animated.sequence(
      [1, -1, 0.7, -0.7, 0.3, 0].map((v) =>
        Animated.timing(rot, { toValue: v, duration: 55, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ),
    ).start();
  }, [selected, rot]);
  const rotate = rot.interpolate({ inputRange: [-1, 1], outputRange: ["-9deg", "9deg"] });
  return (
    <Pressable testID={`gift-${gift.id}`} onPress={onSelect} style={[styles.card, selected && styles.cardSel]}>
      <Animated.View style={{ transform: [{ rotate }] }}>
        <Image source={{ uri: mediaUrl(gift.image_url) }} style={styles.img} contentFit="contain" />
      </Animated.View>
      <Text style={styles.name} numberOfLines={1}>{gift.name}</Text>
      <View style={styles.priceRow}>
        <Diamond size={11} />
        <Text style={styles.price}>{Number(gift.price).toLocaleString()}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "23%", maxWidth: 96, aspectRatio: 0.82,
    borderRadius: radius.md, padding: spacing.xs ?? 4,
    alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "transparent",
  },
  cardSel: { borderColor: colors.brandPrimary },
  img: { width: 46, height: 46 },
  name: { color: colors.onSurface, fontSize: 10.5, fontWeight: "600", marginTop: 4 },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 2 },
  price: { color: colors.muted, fontSize: 10.5, fontWeight: "700" },
});
