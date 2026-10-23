/**
 * Room music — half-screen sheet.
 *  Main view: playlist (tap to play), centered "Add Music" when empty, pinned
 *  player bar (Play/Pause · Repeat-one→Shuffle→Normal · Volume 0–100).
 *  Browser view (same height): tabs "From Phone" (device audio, re-scanned on
 *  every open) and "From Internet" (30 famous Arabic songs — playable only
 *  when a licensed stream URL is configured by admins).
 *  State is server-authoritative and synced over the room socket; audio is
 *  broadcast by the DJ device through Agora (native builds).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, FlatList, ActivityIndicator, Animated, Easing, Platform, Linking, TextInput } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import * as MediaLibrary from "expo-media-library/legacy";
import Slider from "@react-native-community/slider";
import { useAuth } from "@/src/auth-context";
import { useRoomSession } from "@/src/room/RoomSession";
import { useToast } from "@/src/components/Toast";
import { apiMusicAdd, apiMusicCatalog, apiMusicControl } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";

const MIC_MSG = "يرجى الصعود على المايك للتشغيل";

function Beat() {
  const bars = [useRef(new Animated.Value(0.3)).current, useRef(new Animated.Value(0.6)).current, useRef(new Animated.Value(0.4)).current];
  useEffect(() => {
    const loops = bars.map((b, i) => Animated.loop(Animated.sequence([
      Animated.timing(b, { toValue: 1, duration: 260 + i * 90, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(b, { toValue: 0.25, duration: 260 + i * 90, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ])));
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={styles.beat} testID="music-beat">
      {bars.map((b, i) => <Animated.View key={i} style={[styles.beatBar, { transform: [{ scaleY: b }] }]} />)}
    </View>
  );
}

export function MusicSheet({ visible, onClose, roomId, isSeated, isRTL }: {
  visible: boolean; onClose: () => void; roomId: string; isSeated: boolean; isRTL: boolean;
}) {
  const insets = useSafeAreaInsets();
  const session = useRoomSession();
  const toast = useToast();
  const { user } = useAuth();
  const m = session.music;
  const queue: any[] = m?.queue ?? [];
  const [view, setView] = useState<"main" | "browse">("main");
  const [tab, setTab] = useState<"phone" | "internet">("phone");
  const [expanded, setExpanded] = useState(false);
  const [showVol, setShowVol] = useState(false);
  const [vol, setVol] = useState<number>(m?.volume ?? 80);
  const [phone, setPhone] = useState<any[] | null>(null);
  const [perm, setPerm] = useState<"ok" | "denied" | "blocked" | "unsupported" | null>(null);
  const [catalog, setCatalog] = useState<any[]>([]);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [delMode, setDelMode] = useState(false);
  const t = (ar: string, en: string) => (isRTL ? ar : en);

  useEffect(() => { if (m?.volume != null) setVol(m.volume); }, [m?.volume]);
  useEffect(() => { if (!visible) { setView("main"); setShowVol(false); setDelMode(false); } }, [visible]);
  useEffect(() => { if (queue.length === 0) setDelMode(false); }, [queue.length]);

  const ctl = useCallback(async (action: string, extra: any = {}) => {
    if (["play", "select", "next"].includes(action) && !isSeated) { toast.warning(MIC_MSG); return; }
    try { session.setMusic(await apiMusicControl(roomId, action, extra)); return true; } catch (e: any) {
      const msg = String(e?.message || "");
      if (/MIC_REQUIRED/.test(msg)) toast.warning(MIC_MSG);
      else if (/Not allowed/.test(msg)) toast.error(t("لا يمكنك حذف هذه الأغنية", "You can't delete this song"));
      else if (/TRACK_UNAVAILABLE/.test(msg)) toast.info(t("هذه الأغنية غير متاحة للتشغيل حالياً", "This song isn't available to play yet"));
      else toast.error(msg || "Error");
    }
  }, [roomId, isSeated, session, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  // "From Phone": scan ALL device audio every time the tab opens (no picker).
  const loadPhone = useCallback(async (ask = true) => {
    setPhone(null);
    if (Platform.OS === "web") { setPerm("unsupported"); setPhone([]); return; }
    let p = await MediaLibrary.getPermissionsAsync(false, ["audio"]);
    if (!p.granted && p.canAskAgain && ask) p = await MediaLibrary.requestPermissionsAsync(false, ["audio"]);
    if (!p.granted) { setPerm(p.canAskAgain ? "denied" : "blocked"); setPhone([]); return; }
    setPerm("ok");
    const all: any[] = [];
    let after: string | undefined;
    for (let page = 0; page < 20; page++) {
      const res = await MediaLibrary.getAssetsAsync({ mediaType: MediaLibrary.MediaType.audio, first: 200, after, sortBy: [[MediaLibrary.SortBy.modificationTime, false]] });
      all.push(...res.assets);
      if (!res.hasNextPage) break;
      after = res.endCursor;
    }
    // Audio only (mp3, m4a, aac, wav, flac, ogg, opus, amr…) — never photos/videos.
    setPhone(all.filter((a) => a.mediaType === "audio" && /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|amr|wma|3gp|mid|midi)$/i.test(a.filename || "") ));
  }, []);
  useEffect(() => {
    if (view === "browse" && tab === "phone") loadPhone().catch(() => setPhone([]));
  }, [view, tab, loadPhone]);
  // From Internet: playable-only catalog (Audius), debounced search.
  const [q, setQ] = useState("");
  const [catLoading, setCatLoading] = useState(false);
  useEffect(() => {
    if (view !== "browse" || tab !== "internet") return;
    let alive = true;
    const h = setTimeout(() => {
      setCatLoading(true);
      apiMusicCatalog(q.trim() || undefined)
        .then((r) => { if (alive) setCatalog(r.items); })
        .catch(() => { if (alive) toast.error(t("تعذر تحميل الأغاني", "Couldn't load songs")); })
        .finally(() => { if (alive) setCatLoading(false); });
    }, q ? 400 : 0);
    return () => { alive = false; clearTimeout(h); };
  }, [view, tab, q]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Added" state derives from the server playlist → persists across tabs / reopen / devices.
  const addedCat = new Set(queue.map((q) => q.catalog_id).filter(Boolean));
  const addedUri = new Set(queue.filter((q) => q.owner_id === user?.id).map((q) => q.local_uri).filter(Boolean));
  const add = async (key: string, body: any) => {
    if (pending.has(key)) return;
    setPending((s) => new Set(s).add(key));
    try { session.setMusic(await apiMusicAdd(roomId, body)); }
    catch (e: any) { toast.error(e?.message || "Error"); }
    finally { setPending((s) => { const n = new Set(s); n.delete(key); return n; }); }
  };
  const addPhone = (a: { filename: string; uri: string }) =>
    add(a.uri, { source: "phone", title: a.filename.replace(/\.[^.]+$/, ""), local_uri: a.uri });
  const addInternet = (c: any) =>
    add(c.id, { source: "internet", title: c.title, artist: c.artist, catalog_id: c.id });
  const removeAt = (index: number) => ctl("remove", { index });

  const AddBtn = ({ added, busyKey, onPress, testID }: { added: boolean; busyKey: string; onPress: () => void; testID?: string }) => (
    added ? (
      <View style={styles.addedPill} testID={testID ? `${testID}-added` : undefined}>
        <Text style={styles.addedText}>{t("تم الإضافة", "Added")}</Text>
      </View>
    ) : pending.has(busyKey) ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : (
      <Pressable onPress={onPress} hitSlop={8} testID={testID} style={styles.plusBtn}>
        <Icon name="add" size={22} color={colors.brandPrimary} />
      </Pressable>
    )
  );

  const cycleMode = async () => {
    const ok = await ctl("mode");
    const next = { normal: "repeat_one", repeat_one: "shuffle", shuffle: "normal" }[(m?.mode ?? "normal") as "normal"];
    if (ok && next === "repeat_one") toast.info("تكرار");
    else if (ok && next === "shuffle") toast.info("بشكل عشوائي");
  };

  const cur = m && m.index >= 0 ? queue[m.index] : null;
  const height = expanded && view === "browse" ? "85%" : "50%";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { height, paddingBottom: insets.bottom }]} onPress={(e) => e.stopPropagation()} testID="music-sheet">
          {view === "main" ? (
            <>
              <View style={styles.headRow}>
                <Text style={styles.title}>{t("الموسيقى", "Music")}</Text>
                {queue.length > 0 && (
                  <View style={styles.headActions}>
                    <Pressable onPress={() => setDelMode((d) => !d)} testID="music-delete-toggle" hitSlop={8}
                      style={[styles.delToggle, delMode && styles.delToggleOn]}>
                      <Text style={[styles.delToggleText, delMode && { color: colors.error }]}>
                        {delMode ? t("تم", "Done") : t("حذف", "Delete")}
                      </Text>
                    </Pressable>
                    <Pressable onPress={() => { setDelMode(false); setView("browse"); }} testID="music-add-more" hitSlop={8}>
                      <Icon name="add-circle-outline" size={24} color={colors.brandPrimary} />
                    </Pressable>
                  </View>
                )}
              </View>
              {queue.length === 0 ? (
                <Pressable style={styles.addCenter} onPress={() => setView("browse")} testID="music-add">
                  <Icon name="musical-notes" size={34} color={colors.brandPrimary} />
                  <Text style={styles.addText}>{t("إضافة موسيقى", "Add Music")}</Text>
                </Pressable>
              ) : (
                <FlatList
                  data={queue}
                  keyExtractor={(q) => q.id}
                  style={{ flex: 1 }}
                  renderItem={({ item, index }) => {
                    const playing = m?.playing && m?.index === index;
                    return (
                      <Pressable style={styles.row} onPress={() => (delMode ? removeAt(index) : ctl("select", { index }))} testID={`music-track-${index}`}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[styles.trackTitle, playing && { color: colors.brandPrimary }]} numberOfLines={1}>{item.title}</Text>
                          {!!item.artist && <Text style={styles.trackArtist} numberOfLines={1}>{item.artist}</Text>}
                        </View>
                        {playing ? <Beat /> : <Icon name="play-circle-outline" size={22} color={colors.muted} />}
                        {delMode && (
                          <Pressable onPress={() => removeAt(index)} hitSlop={8} testID={`music-del-${index}`} style={styles.trashBtn}>
                            <Icon name="trash" size={16} color={colors.error} />
                          </Pressable>
                        )}
                      </Pressable>
                    );
                  }}
                />
              )}
              {/* Pinned player bar */}
              <View style={styles.player} testID="music-player">
                {showVol ? (
                  <View style={styles.volRow}>
                    <Pressable onPress={() => setShowVol(false)} testID="music-vol-back" hitSlop={8}>
                      <Icon name={isRTL ? "arrow-forward" : "arrow-back"} size={20} color={colors.onSurface} />
                    </Pressable>
                    <Slider
                      testID="music-vol-slider"
                      style={{ flex: 1 }}
                      minimumValue={0} maximumValue={100} step={1}
                      value={vol}
                      onValueChange={setVol}
                      onSlidingComplete={(v) => ctl("volume", { value: Math.round(v) })}
                      minimumTrackTintColor={colors.brandPrimary}
                    />
                    <Text style={styles.volNum}>{Math.round(vol)}</Text>
                  </View>
                ) : (
                  <>
                    <Text style={styles.nowTitle} numberOfLines={1}>{cur?.title ?? t("لا يوجد تشغيل", "Nothing playing")}</Text>
                    <View style={styles.controls}>
                      <Pressable onPress={cycleMode} testID="music-mode" hitSlop={8} style={styles.ctlBtn}>
                        {m?.mode === "shuffle" ? <Icon name="shuffle" size={20} color={colors.brandPrimary} /> : (
                          <View>
                            <Icon name="repeat" size={20} color={m?.mode === "repeat_one" ? colors.brandPrimary : colors.muted} />
                            {m?.mode === "repeat_one" && <Text style={styles.one}>1</Text>}
                          </View>
                        )}
                      </Pressable>
                      <Pressable onPress={() => ctl(m?.playing ? "pause" : "play")} testID="music-play" style={styles.playBtn}>
                        <Icon name={m?.playing ? "pause" : "play"} size={22} color={colors.onBrandPrimary} />
                      </Pressable>
                      <Pressable onPress={() => ctl("next")} testID="music-next" hitSlop={8} style={styles.ctlBtn}>
                        <Icon name={isRTL ? "play-skip-back" : "play-skip-forward"} size={20} color={colors.onSurface} />
                      </Pressable>
                      <Pressable onPress={() => setShowVol(true)} testID="music-volume" hitSlop={8} style={styles.ctlBtn}>
                        <Icon name="volume-high" size={20} color={colors.onSurface} />
                      </Pressable>
                    </View>
                  </>
                )}
              </View>
            </>
          ) : (
            <>
              <View style={styles.headRow}>
                <Pressable onPress={() => setView("main")} hitSlop={8} testID="music-browse-back">
                  <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={22} color={colors.onSurface} />
                </Pressable>
                <View style={styles.tabs}>
                  {(["phone", "internet"] as const).map((k) => (
                    <Pressable key={k} onPress={() => setTab(k)} testID={`music-tab-${k}`} style={[styles.tab, tab === k && styles.tabOn]}>
                      <Text style={[styles.tabText, tab === k && { color: colors.brandPrimary }]}>{k === "phone" ? t("من الهاتف", "From Phone") : t("من الإنترنت", "From Internet")}</Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable onPress={() => setExpanded((e) => !e)} hitSlop={8} testID="music-expand">
                  <Icon name={expanded ? "chevron-down" : "chevron-up"} size={22} color={colors.onSurface} />
                </Pressable>
              </View>
              {tab === "phone" ? (
                phone === null ? <ActivityIndicator style={{ marginTop: 24 }} color={colors.brandPrimary} /> : (
                  <FlatList
                    data={phone}
                    keyExtractor={(a) => a.id}
                    style={{ flex: 1 }}
                    ListEmptyComponent={
                      <View style={styles.note} testID="music-phone-empty">
                        <Icon name="musical-notes-outline" size={30} color={colors.muted} style={{ alignSelf: "center" }} />
                        <Text style={styles.noteText}>
                          {perm === "unsupported"
                            ? t("لا توجد ملفات صوتية", "No audio files")
                            : perm === "denied" || perm === "blocked"
                              ? t("اسمح بالوصول إلى الصوتيات لعرض أغانيك", "Allow audio access to show your songs")
                              : t("لا توجد ملفات صوتية على هاتفك", "No audio files found on your phone")}
                        </Text>
                        {perm === "blocked" && (
                          <Pressable onPress={() => Linking.openSettings()} style={styles.noteBtn} testID="music-open-settings">
                            <Text style={styles.noteBtnText}>{t("فتح الإعدادات", "Open Settings")}</Text>
                          </Pressable>
                        )}
                        {perm === "denied" && (
                          <Pressable onPress={() => loadPhone()} style={styles.noteBtn} testID="music-allow-audio">
                            <Text style={styles.noteBtnText}>{t("السماح بالوصول إلى الصوتيات", "Allow audio access")}</Text>
                          </Pressable>
                        )}
                      </View>
                    }
                    renderItem={({ item }) => (
                      <View style={styles.row}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.trackTitle} numberOfLines={1}>{item.filename.replace(/\.[^.]+$/, "")}</Text>
                          <Text style={styles.trackArtist}>{Math.floor(item.duration / 60)}:{String(Math.floor(item.duration % 60)).padStart(2, "0")}</Text>
                        </View>
                        <AddBtn added={addedUri.has(item.uri)} busyKey={item.uri} onPress={() => addPhone(item)} />
                      </View>
                    )}
                  />
                )
              ) : (
                <View style={{ flex: 1 }}>
                <View style={styles.searchBox}>
                  <Icon name="search" size={16} color={colors.muted} />
                  <TextInput
                    testID="music-search"
                    value={q}
                    onChangeText={setQ}
                    placeholder={t("ابحث عن أغنية أو فنان", "Search songs or artists")}
                    placeholderTextColor={colors.muted}
                    style={[styles.searchInput, isRTL && { textAlign: "right" }]}
                    returnKeyType="search"
                  />
                  {catLoading && <ActivityIndicator size="small" color={colors.brandPrimary} />}
                </View>
                <FlatList
                  data={catalog}
                  keyExtractor={(c) => c.id}
                  style={{ flex: 1 }}
                  keyboardShouldPersistTaps="handled"
                  ListEmptyComponent={catLoading ? null : <Text style={[styles.noteText, { marginTop: 24 }]}>{t("لا توجد نتائج", "No results")}</Text>}
                  renderItem={({ item }) => (
                    <View style={styles.row} testID={`music-cat-${item.id}`}>
                      {item.artwork ? <Image source={item.artwork} style={styles.art} contentFit="cover" /> : <View style={[styles.art, { alignItems: "center", justifyContent: "center" }]}><Icon name="musical-note" size={16} color={colors.muted} /></View>}
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.trackTitle} numberOfLines={1}>{item.title}</Text>
                        <Text style={styles.trackArtist} numberOfLines={1}>{item.artist}{item.duration ? ` · ${Math.floor(item.duration / 60)}:${String(item.duration % 60).padStart(2, "0")}` : ""}</Text>
                      </View>
                      <AddBtn added={addedCat.has(item.id)} busyKey={item.id} onPress={() => addInternet(item)} testID={`music-cat-add-${item.id}`} />
                    </View>
                  )}
                />
                </View>
              )}
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: spacing.sm },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 8 },
  title: { color: colors.onSurface, fontSize: 16, fontWeight: "800" },
  addCenter: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  addText: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: spacing.md, paddingVertical: 10 },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: spacing.md, marginBottom: 4, paddingHorizontal: 12, height: 40, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary },
  searchInput: { flex: 1, color: colors.onSurface, fontSize: 14, paddingVertical: 0 },
  art: { width: 40, height: 40, borderRadius: 8, backgroundColor: colors.surfaceSecondary },
  trackTitle: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  trackArtist: { color: colors.muted, fontSize: 12, marginTop: 2 },
  beat: { flexDirection: "row", alignItems: "flex-end", gap: 2, height: 18, width: 18 },
  beatBar: { width: 4, height: 18, borderRadius: 2, backgroundColor: colors.brandPrimary },
  player: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: 10 },
  nowTitle: { color: colors.onSurface, fontSize: 13, fontWeight: "700", textAlign: "center", marginBottom: 6 },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 26 },
  ctlBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  playBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  one: { position: "absolute", right: -4, top: -4, color: colors.brandPrimary, fontSize: 9, fontWeight: "900" },
  volRow: { flexDirection: "row", alignItems: "center", gap: 10, height: 56 },
  volNum: { color: colors.onSurface, width: 30, textAlign: "center", fontWeight: "800" },
  tabs: { flexDirection: "row", gap: 6, flex: 1, justifyContent: "center" },
  tab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  tabOn: { borderColor: colors.brandPrimary },
  tabText: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  note: { padding: spacing.md, gap: 8 },
  noteBtn: { alignSelf: "center", paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.brandPrimary },
  noteBtnText: { color: colors.brandPrimary, fontWeight: "800", fontSize: 13 },
  noteText: { color: colors.muted, fontSize: 13, textAlign: "center" },
  headActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  delToggle: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  delToggleOn: { borderColor: colors.error },
  delToggleText: { color: colors.onSurface, fontSize: 12, fontWeight: "800" },
  trashBtn: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  plusBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  addedPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.border, opacity: 0.8 },
  addedText: { color: colors.muted, fontSize: 11, fontWeight: "800" },
});
