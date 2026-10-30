import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { colors } from "@/src/theme";


export function FamilyLogo({ uri, name, size, radius, style }: {
  uri?: string | null; name?: string | null; size: number; radius: number; style?: StyleProp<ViewStyle>;
}) {
  const box = { width: size, height: size, borderRadius: radius };
  return (
    <View style={[box, styles.tile, style]}>
      <Text style={[styles.letter, { fontSize: size * 0.42 }]}>{(name || "?").trim().charAt(0).toUpperCase()}</Text>
      {!!uri && <Image source={uri} style={[StyleSheet.absoluteFill, { borderRadius: radius }]} contentFit="cover" />}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: "center", justifyContent: "center", overflow: "hidden", backgroundColor: colors.brandPrimary },
  letter: { color: colors.onBrandPrimary, fontWeight: "900" },
});
