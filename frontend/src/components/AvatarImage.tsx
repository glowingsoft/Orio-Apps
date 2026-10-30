
import { View, Text, StyleSheet, type StyleProp, type ImageStyle } from "react-native";
import { Image } from "expo-image";
import { colors } from "@/src/theme";

export function AvatarImage({ uri, name, style, transition }: {
  uri?: string | null;
  name?: string | null;
  style: StyleProp<ImageStyle>;
  transition?: number;
}) {
  const flat = StyleSheet.flatten(style) || {};
  const size = Number(flat.width) || 48;
  return (
    <View style={[style as any, styles.tile, { overflow: "hidden" }]}>
      <Text style={[styles.letter, { fontSize: Math.round(size * 0.42) }]}>
        {(name || "?").trim().charAt(0).toUpperCase()}
      </Text>
      {!!uri && (
        <Image source={uri} style={StyleSheet.absoluteFill} contentFit="cover" transition={transition} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: "center", justifyContent: "center", backgroundColor: colors.brandPrimary },
  letter: { color: colors.onBrandPrimary, fontWeight: "900" },
});
