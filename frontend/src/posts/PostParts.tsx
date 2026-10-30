import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  Modal,
  FlatList,
  ActivityIndicator,
  Platform,
  Linking,
} from "react-native";
import Icon from "@react-native-vector-icons/ionicons";
import { Image } from "expo-image";
import { useEvent, useEventListener } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { POST_HASHTAGS } from "@/src/api";
import { mediaUrl } from "@/src/media/upload";
import { colors, spacing, radius } from "@/src/theme";

/** Compact chips; multi=false → single filter selection (tap again to clear). */
export function HashtagChips({
  selected,
  onToggle,
  maxHeight = 76,
  testIDPrefix = "hashtag",
  horizontal = false,
}: {
  selected: string[];
  onToggle: (tag: string) => void;
  maxHeight?: number;
  testIDPrefix?: string;
  /** Iter-122 — single horizontally scrollable row; every hashtag always stays visible. */
  horizontal?: boolean;
}) {
  return (
    <ScrollView
      horizontal={horizontal}
      style={
        horizontal
          ? { flexGrow: 0, flexShrink: 0, minHeight: 36 }
          : { maxHeight, flexGrow: 0 }
      }
      contentContainerStyle={horizontal ? styles.row : styles.wrap}
      nestedScrollEnabled
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
    >
      {POST_HASHTAGS.map((tag) => {
        const on = selected.includes(tag);
        return (
          <Pressable
            key={tag}
            testID={`${testIDPrefix}-${tag}`}
            onPress={() => onToggle(tag)}
            style={[styles.chip, on && styles.chipOn]}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]}>
              #{tag}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function FullVideo({ uri, poster }: { uri: string; poster?: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.play();
  });
  const { status, error } = useEvent(player, "statusChange", {
    status: player.status,
  });
  useEffect(() => {
    if (status === "error")
      console.warn("[post-video] playback failed", uri, error?.message);
  }, [status, error, uri]);
  const [ended, setEnded] = useState(false);
  useEventListener(player, "playToEnd", () => setEnded(true));
  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: player.playing });
  const replay = () => {
    setEnded(false);
    player.replay();
  };
  const started = useRef(false);
  useEffect(() => {
    if (status !== "readyToPlay" || started.current) return;
    started.current = true;
    try {
      player.play();
    } catch {
    }
  }, [status, player]);
  return (
    <>
      <View style={StyleSheet.absoluteFill}>
        <VideoView
          player={player}
          style={{ width: "100%", height: "100%" }}
          nativeControls
          contentFit="contain"
          testID="post-viewer-video"
        />
      </View>
      {!!poster && status === "loading" && (
        <Image source={poster} style={StyleSheet.absoluteFill} contentFit="contain" pointerEvents="none" />
      )}
      {status === "loading" && (
        <ActivityIndicator
          color="#FFFFFF"
          size="large"
          style={styles.videoCenter}
          pointerEvents="none"
        />
      )}
      {ended && !isPlaying && status !== "error" && (
        <Pressable onPress={replay} style={styles.replayBtn} testID="post-viewer-video-replay" hitSlop={12}>
          <Icon name="refresh" size={34} color="#FFFFFF" />
          <Text style={styles.replayText}>Replay</Text>
        </Pressable>
      )}
      {status === "error" && (
        <View style={styles.videoError} testID="post-viewer-video-error">
          <Icon name="alert-circle-outline" size={40} color="#FFFFFF" />
          <Text style={styles.videoErrorText}>
            {"This video can't be played here."}
          </Text>
          {Platform.OS === "web" && (
            <Pressable
              onPress={() => Linking.openURL(uri)}
              style={styles.videoErrorBtn}
              testID="post-viewer-video-open"
            >
              <Text style={styles.videoErrorBtnText}>
                Open video in a new tab
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </>
  );
}

/** Single photo: original aspect ratio, never larger than the approved box. */
function SingleImage({
  uri,
  maxW,
  maxH,
  onPress,
  testID,
}: {
  uri: string;
  maxW: number;
  maxH: number;
  onPress: () => void;
  testID?: string;
}) {
  const [ratio, setRatio] = useState(1);
  let w = maxW,
    h = Math.round(maxW / ratio);
  if (h > maxH) {
    h = maxH;
    w = Math.round(maxH * ratio);
  }
  return (
    <Pressable onPress={onPress} testID={testID}>
      <Image
        source={uri}
        style={[styles.single, { width: w, height: h }]}
        contentFit="cover"
        onLoad={(e: any) => {
          const s = e?.source;
          if (s?.width && s?.height) setRatio(s.width / s.height);
        }}
      />
    </Pressable>
  );
}

/** 5 → "0:05", 75 → "1:15". */
function formatDuration(sec: number) {
  const s = Math.max(1, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Compact previews; tap → full-screen viewer (images: swipe pager, video: player). */
export function PostMedia({
  images,
  video,
  videoThumb,
  videoDuration,
  testID,
}: {
  images?: string[];
  video?: string | null;
  /** Seconds; shown as a "0:05" badge on the tile. */
  videoDuration?: number | null;
  /** Frame made by the server at upload; older videos have none (dark tile). */
  videoThumb?: string | null;
  testID?: string;
}) {
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
        <Pressable
          onPress={() => setOpen(0)}
          style={[
            styles.videoThumb,
            {
              width: Math.round(inner * 0.48),
              height: Math.round((inner * 0.48 * 4) / 3),
            },
          ]}
          testID={testID ? `${testID}-video` : undefined}
        >
          {!!videoThumb && (
            <Image
              source={mediaUrl(videoThumb)}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={150}
              testID={testID ? `${testID}-video-thumb` : undefined}
            />
          )}
          <View style={styles.playBadge}>
            <Icon name="play" size={26} color="#FFFFFF" style={{ marginLeft: 3 }} />
          </View>
          {videoDuration != null && videoDuration > 0 && (
            <View style={styles.durationBadge} testID={testID ? `${testID}-video-duration` : undefined}>
              <Text style={styles.durationText}>{formatDuration(videoDuration)}</Text>
            </View>
          )}
        </Pressable>
      ) : list.length === 1 ? (
        <SingleImage
          uri={mediaUrl(list[0])!}
          maxW={Math.round(inner * 0.55)}
          maxH={Math.round(inner * 0.7)}
          onPress={() => setOpen(0)}
          testID={testID ? `${testID}-img-0` : undefined}
        />
      ) : (
        // ≥2 photos: fixed 3-column grid of equal squares (9 photos → exactly 3×3).
        <View style={[styles.grid, { width: cell * cols + 4 * (cols - 1) }]}>
          {list.slice(0, 9).map((u, i) => (
            <Pressable
              key={u + i}
              onPress={() => setOpen(i)}
              testID={testID ? `${testID}-img-${i}` : undefined}
            >
              <Image
                source={mediaUrl(u)}
                style={{ width: cell, height: cell, borderRadius: radius.sm }}
                contentFit="cover"
              />
            </Pressable>
          ))}
        </View>
      )}
      <Modal
        visible={open !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(null)}
        statusBarTranslucent
      >
        <View style={styles.viewer} testID="post-media-viewer">
          {video
            ? open !== null && <FullVideo uri={mediaUrl(video)!} poster={videoThumb ? mediaUrl(videoThumb) : undefined} />
            : open !== null && (
                // Opens on the exact tapped photo (initialScrollIndex), then swipe.
                <FlatList
                  key={`viewer-${open}`}
                  data={list}
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  initialScrollIndex={open}
                  getItemLayout={(_, i) => ({
                    length: width,
                    offset: width * i,
                    index: i,
                  })}
                  keyExtractor={(u, i) => u + i}
                  style={StyleSheet.absoluteFill}
                  renderItem={({ item: u, index: i }) => (
                    <Image
                      source={mediaUrl(u)}
                      style={{ width, height }}
                      contentFit="contain"
                      testID={`post-media-viewer-img-${i}`}
                    />
                  )}
                />
              )}
          <Pressable
            onPress={() => setOpen(null)}
            hitSlop={10}
            style={styles.viewerClose}
            testID="post-media-viewer-close"
          >
            <Icon name="close" size={26} color="#FFFFFF" />
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingBottom: 6,
  },
  row: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingBottom: 6,
    alignItems: "center",
  },
  chip: {
    paddingHorizontal: 10,
    height: 28,
    borderRadius: radius.pill,
    justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipOn: {
    backgroundColor: colors.brandPrimary + "33",
    borderColor: colors.brandPrimary,
  },
  chipText: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  chipTextOn: { color: colors.onSurface },
  single: { borderRadius: radius.md, marginTop: spacing.sm },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: spacing.sm,
  },
  videoCenter: {
    position: "absolute",
    alignSelf: "center",
    top: "50%",
    marginTop: -18,
  },
  videoError: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.lg,
  },
  videoErrorText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
  },
  videoErrorBtn: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
  },
  videoErrorBtnText: { color: colors.onBrandPrimary, fontWeight: "800" },
  videoThumb: {
    borderRadius: radius.md,
    marginTop: spacing.sm,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  replayBtn: {
    position: "absolute",
    alignSelf: "center",
    top: "50%",
    marginTop: -48,
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.9)",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  replayText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  durationBadge: {
    position: "absolute",
    right: 8,
    bottom: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  durationText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700", fontVariant: ["tabular-nums"] },
  playBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.9)",
    alignItems: "center",
    justifyContent: "center",
  },
  viewer: { flex: 1, backgroundColor: "#000" },
  viewerClose: {
    position: "absolute",
    top: 48,
    end: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
});
