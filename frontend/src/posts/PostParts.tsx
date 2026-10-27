
import React, { useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, useWindowDimensions, Modal, FlatList } from "react-native";
import Icon from "@react-native-vector-icons/ionicons";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { POST_HASHTAGS } from "@/src/api";
import { mediaUrl } from "@/src/media/upload";
import { colors, spacing, radius } from "@/src/theme";

/** Compact chips; multi=false → single filter selection (tap again to clear). */
export function HashtagChips({ selected, onToggle, maxHeight = 76, testIDPrefix = "hashtag", horizontal = false }: {
  selected: string[]; onToggle: (tag: string) => void; maxHeight?: number; testIDPrefix?: string;
  /** Iter-122 — single horizontally scrollable row; every hashtag always stays visible. */
  horizontal?: boolean;
}) {
  return (
    <ScrollView
      horizontal={horizontal}
      style={horizontal ? { flexGrow: 0, flexShrink: 0, minHeight: 36 } : { maxHeight, flexGrow: 0 }}
      contentContainerStyle={horizontal ? styles.row : styles.wrap}
      nestedScrollEnabled
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
    >
      {POST_HASHTAGS.map((tag) => {
        const on = selected.includes(tag);
        return (
          <Pressable key={tag} testID={`${testIDPrefix}-${tag}`} onPress={() => onToggle(tag)} style={[styles.chip, on && styles.chipOn]}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>#{tag}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function FullVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = false; p.play(); });
  return <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls contentFit="contain" testID="post-viewer-video" />;
}

/** Single photo: original aspect ratio, never larger than the approved box. */
function SingleImage({ uri, maxW, maxH, onPress, testID }: { uri: string; maxW: number; maxH: number; onPress: () => void; testID?: string }) {
  const [ratio, setRatio] = useState(1);
  let w = maxW, h = Math.round(maxW / ratio);
  if (h > maxH) { h = maxH; w = Math.round(maxH * ratio); }
  return (
    <Pressable onPress={onPress} testID={testID}>
      <Image
        source={uri}
        style={[styles.single, { width: w, height: h }]}
        contentFit="cover"
        onLoad={(e: any) => { const s = e?.source; if (s?.width && s?.height) setRatio(s.width / s.height); }}
      />
    </Pressable>
  );
}

/** Compact previews; tap → full-screen viewer (images: swipe pager, video: player). */
export function PostMedia({ images, video, testID }: { images?: string[]; video?: string | null; testID?: string }) {
  const { width, height } = useWindowDimensions();
  const [open, setOpen] = useState<number | null>(null);
  const list = (images || []).filter(Boolean);
  if (!video && !list.length) return null;
  const inner = Math.min(width, 600) - spacing.lg * 2;
  // Compact, progressive sizing: 1 item small; 2 & 4 → 2 columns; others → 3 columns (9 → 3×3).
  const cols = list.length === 2 || list.length === 4 ? 2 : 3;
  const gridW = cols === 2 ? inner * 0.62 : inner * 0.82;
  const cell = Math.floor((gridW - 4 * (cols - 1)) / cols);
  return (
    <>
      {video ? (
        <Pressable onPress={() => setOpen(0)} style={[styles.videoThumb, { width: Math.round(inner * 0.48), height: Math.round(inner * 0.48 * 4 / 3) }]} testID={testID ? `${testID}-video` : undefined}>
          <Icon name="play-circle" size={52} color="#FFFFFF" />
        </Pressable>
      ) : list.length === 1 ? (
        <SingleImage uri={mediaUrl(list[0])!} maxW={Math.round(inner * 0.55)} maxH={Math.round(inner * 0.7)} onPress={() => setOpen(0)} testID={testID ? `${testID}-img-0` : undefined} />
      ) : (
        // ≥2 photos: fixed 3-column grid of equal squares (9 photos → exactly 3×3).
        <View style={[styles.grid, { width: cell * cols + 4 * (cols - 1) }]}>
          {list.slice(0, 9).map((u, i) => (
            <Pressable key={u + i} onPress={() => setOpen(i)} testID={testID ? `${testID}-img-${i}` : undefined}>
              <Image source={mediaUrl(u)} style={{ width: cell, height: cell, borderRadius: radius.sm }} contentFit="cover" />
            </Pressable>
          ))}
        </View>
      )}
      <Modal visible={open !== null} transparent animationType="fade" onRequestClose={() => setOpen(null)} statusBarTranslucent>
        <View style={styles.viewer} testID="post-media-viewer">
          {video ? (open !== null && <FullVideo uri={mediaUrl(video)!} />) : (
            open !== null && (
              // Opens on the exact tapped photo (initialScrollIndex), then swipe.
              <FlatList
                key={`viewer-${open}`}
                data={list}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                initialScrollIndex={open}
                getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
                keyExtractor={(u, i) => u + i}
                style={StyleSheet.absoluteFill}
                renderItem={({ item: u, index: i }) => (
                  <Image source={mediaUrl(u)} style={{ width, height }} contentFit="contain" testID={`post-media-viewer-img-${i}`} />
                )}
              />
            )
          )}
          <Pressable onPress={() => setOpen(null)} hitSlop={10} style={styles.viewerClose} testID="post-media-viewer-close">
            <Icon name="close" size={26} color="#FFFFFF" />
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: spacing.lg, paddingBottom: 6 },
  row: { flexDirection: "row", gap: 6, paddingHorizontal: spacing.lg, paddingBottom: 6, alignItems: "center" },
  chip: { paddingHorizontal: 10, height: 28, borderRadius: radius.pill, justifyContent: "center", backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.brandPrimary + "33", borderColor: colors.brandPrimary },
  chipText: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  chipTextOn: { color: colors.onSurface },
  single: { borderRadius: radius.md, marginTop: spacing.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: spacing.sm },
  videoThumb: { borderRadius: radius.md, marginTop: spacing.sm, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  viewer: { flex: 1, backgroundColor: "#000" },
  viewerClose: { position: "absolute", top: 48, end: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
});
