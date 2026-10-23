/**
 * Levels help / rules screen — 4 selectable tabs. Selected tab glows, others dim.
 * White text on subtle dark halos. RTL/LTR mirror natively.
 */
import { useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "@/src/i18n";
import { ScreenHeader, cosmeticStyles } from "@/src/cosmetics/ui";
import { levelRules } from "@/src/levels/rulesContent";
import { spacing, radius } from "@/src/theme";

export default function LevelRulesScreen() {
  const { lang, isRTL } = useI18n();
  const insets = useSafeAreaInsets();
  const tabs = levelRules(lang);
  const [active, setActive] = useState(tabs[0].id);
  const tab = tabs.find((x) => x.id === active) ?? tabs[0];
  const align = { textAlign: (isRTL ? "right" : "left") as "right" | "left" };

  return (
    <View style={[cosmeticStyles.container, styles.screen]} testID="level-rules-screen">
      <ScreenHeader testID="level-rules" title={lang === "ar" ? "قواعد المستويات" : "Level Rules"} />
      <View style={styles.tabs}>
        {tabs.map((x) => {
          const on = x.id === active;
          return (
            <Pressable key={x.id} testID={`rules-tab-${x.id}`} onPress={() => setActive(x.id)} style={styles.tab} accessibilityState={{ selected: on }}>
              <Text style={[styles.tabText, on ? styles.tabTextOn : styles.tabTextOff]} numberOfLines={2}>{x.title}</Text>
            </Pressable>
          );
        })}
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl }} testID={`rules-content-${tab.id}`}>
        <Text style={[styles.title, align]}>{tab.title}</Text>
        {tab.sections.map((s, i) => (
          <View key={i} style={styles.card}>
            {!!s.h && <Text style={[styles.h, align]}>{s.h}</Text>}
            {s.p?.map((t, j) => <Text key={j} style={[styles.p, align]}>{t}</Text>)}
            {s.bullets?.map((t, j) => (
              <View key={j} style={styles.li}>
                <Text style={styles.dot}>•</Text>
                <Text style={[styles.p, styles.liText, align]}>{t}</Text>
              </View>
            ))}
            {s.numbered?.map((t, j) => (
              <View key={j} style={styles.li}>
                <Text style={styles.num}>{`${j + 1}.`}</Text>
                <Text style={[styles.p, styles.liText, align]}>{t}</Text>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// Iter-121 — soft-black screen; tabs are plain text: selected = white, inactive = dimmed.
// Only a subtle black halo behind the text (no backgrounds, borders or glow).
const HALO = { textShadowColor: "rgba(0,0,0,0.75)", textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } };
const styles = StyleSheet.create({
  screen: { backgroundColor: "#16141B" },
  tabs: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  tab: { width: "50%", minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 6, paddingVertical: 8 },
  tabText: { fontSize: 14, fontWeight: "800", textAlign: "center", ...HALO },
  tabTextOn: { color: "#FFFFFF" },
  tabTextOff: { color: "rgba(255,255,255,0.38)" },
  title: { color: "#FFFFFF", fontSize: 20, fontWeight: "900", marginBottom: spacing.md, ...HALO },
  card: { backgroundColor: "rgba(0,0,0,0.22)", borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, gap: 6 },
  h: { color: "#FFFFFF", fontSize: 15, fontWeight: "900", ...HALO },
  p: { color: "#FFFFFF", fontSize: 14, lineHeight: 22, opacity: 0.92, ...HALO },
  li: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  liText: { flex: 1 },
  dot: { color: "#FFFFFF", fontSize: 14, lineHeight: 22, fontWeight: "900", ...HALO },
  num: { color: "#FFFFFF", fontSize: 14, lineHeight: 22, fontWeight: "900", minWidth: 18, ...HALO },
});
