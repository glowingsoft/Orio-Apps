/**
 * Iter-135 — interactive crop / reposition for every image upload.
 * The full-quality original is picked (no system crop), then the user
 * pinch-zooms / drags it inside a frame shaped for its destination
 * (avatar circle, cover, post, background). Only the chosen area is
 * cropped, at native resolution — no stretching, no blind auto-cropping.
 *
 * Usage (drop-in for ImagePicker.launchImageLibraryAsync):
 *   const res = await pickAndCrop({ aspect: [1, 1], shape: "circle", base64: true });
 */
import React, { useEffect, useState } from "react";
import { Modal, View, Text, Pressable, StyleSheet, useWindowDimensions, ActivityIndicator, I18nManager } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useSharedValue, useAnimatedStyle } from "react-native-reanimated";
import Icon from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, radius } from "@/src/theme";

export type CropOpts = { aspect: [number, number]; shape?: "rect" | "circle"; base64?: boolean; maxSide?: number };
type Req = { uri: string; w: number; h: number; opts: CropOpts; resolve: (r: CropResult | null) => void };
export type CropResult = { uri: string; width: number; height: number; base64?: string; mimeType: string };

let showFn: ((r: Req) => void) | null = null;

export function cropImage(uri: string, w: number, h: number, opts: CropOpts): Promise<CropResult | null> {
  return new Promise((resolve) => {
    if (!showFn || !w || !h) { resolve({ uri, width: w, height: h, mimeType: "image/jpeg" }); return; }
    showFn({ uri, w, h, opts, resolve });
  });
}

/** Library pick (original quality) → interactive crop. Result mimics ImagePicker. */
export async function pickAndCrop(opts: CropOpts): Promise<ImagePicker.ImagePickerResult> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1, base64: false, exif: false });
  if (res.canceled || !res.assets?.[0]) return res;
  const a = res.assets[0];
  const mime = (a.mimeType || "").toLowerCase();
  if (mime.includes("gif")) return res; // callers reject GIFs themselves
  const c = await cropImage(a.uri, a.width, a.height, opts);
  if (!c) return { canceled: true, assets: null } as any;
  return { canceled: false, assets: [{ ...a, uri: c.uri, width: c.width, height: c.height, base64: c.base64 ?? null, mimeType: c.mimeType, fileName: (a.fileName || "image").replace(/\.\w+$/, "") + ".jpg" }] } as any;
}

export function ImageCropperHost() {
  const [req, setReq] = useState<Req | null>(null);
  useEffect(() => { showFn = (r) => setReq(r); return () => { showFn = null; }; }, []);
  if (!req) return null;
  return <Cropper req={req} onDone={(r) => { req.resolve(r); setReq(null); }} />;
}

function Cropper({ req, onDone }: { req: Req; onDone: (r: CropResult | null) => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const ar = I18nManager.isRTL;
  const [busy, setBusy] = useState(false);
  const [aw, ah] = req.opts.aspect;
  // Frame: as large as possible within the screen (keeps controls visible).
  const maxW = width - 32, maxH = height - insets.top - insets.bottom - 200;
  const fw = Math.min(maxW, maxH * (aw / ah));
  const fh = fw * (ah / aw);
  // Base scale = "cover" the frame (no empty bars), user can zoom further.
  const base = Math.max(fw / req.w, fh / req.h);
  const dispW = req.w * base, dispH = req.h * base;

  const zoom = useSharedValue(1), savedZoom = useSharedValue(1);
  const tx = useSharedValue(0), ty = useSharedValue(0), sx = useSharedValue(0), sy = useSharedValue(0);

  const clamp = (z: number, x: number, y: number) => {
    "worklet";
    const mx = Math.max(0, (dispW * z - fw) / 2), my = Math.max(0, (dispH * z - fh) / 2);
    return [Math.min(mx, Math.max(-mx, x)), Math.min(my, Math.max(-my, y))];
  };
  const pan = Gesture.Pan()
    .onStart(() => { sx.value = tx.value; sy.value = ty.value; })
    .onUpdate((e) => { const [x, y] = clamp(zoom.value, sx.value + e.translationX, sy.value + e.translationY); tx.value = x; ty.value = y; });
  const pinch = Gesture.Pinch()
    .onStart(() => { savedZoom.value = zoom.value; })
    .onUpdate((e) => {
      zoom.value = Math.min(5, Math.max(1, savedZoom.value * e.scale));
      const [x, y] = clamp(zoom.value, tx.value, ty.value); tx.value = x; ty.value = y;
    });
  const gesture = Gesture.Simultaneous(pan, pinch);
  const imgSt = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: zoom.value }] }));

  const step = (d: number) => {
    const z = Math.min(5, Math.max(1, zoom.value + d));
    zoom.value = z;
    const [x, y] = clamp(z, tx.value, ty.value); tx.value = x; ty.value = y;
  };
  const reset = () => { zoom.value = 1; tx.value = 0; ty.value = 0; };

  const confirm = async (z: number, x: number, y: number) => {
    setBusy(true);
    try {
      const s = base * z; // display px per source px
      let cw = Math.round(fw / s), ch = Math.round(fh / s);
      let ox = Math.round(req.w / 2 - (fw / 2 + x) / s), oy = Math.round(req.h / 2 - (fh / 2 + y) / s);
      ox = Math.max(0, Math.min(req.w - cw, ox)); oy = Math.max(0, Math.min(req.h - ch, oy));
      cw = Math.min(cw, req.w - ox); ch = Math.min(ch, req.h - oy);
      const actions: ImageManipulator.Action[] = [{ crop: { originX: ox, originY: oy, width: cw, height: ch } }];
      const maxSide = req.opts.maxSide ?? 1600;
      if (Math.max(cw, ch) > maxSide) actions.push({ resize: cw >= ch ? { width: maxSide } : { height: maxSide } });
      const out = await ImageManipulator.manipulateAsync(req.uri, actions, {
        compress: 0.92, format: ImageManipulator.SaveFormat.JPEG, base64: !!req.opts.base64,
      });
      onDone({ uri: out.uri, width: out.width, height: out.height, base64: out.base64, mimeType: "image/jpeg" });
    } catch {
      onDone(null);
    }
  };
  const doConfirm = () => confirm(zoom.value, tx.value, ty.value);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => onDone(null)} statusBarTranslucent>
      <GestureHandlerRootView style={[styles.wrap, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.md }]}>
        <Text style={styles.title} testID="cropper-title">{ar ? "اضبط الصورة" : "Adjust photo"}</Text>
        <Text style={styles.hint}>{ar ? "اسحب للتحريك وقرّب بإصبعين لاختيار الجزء الظاهر" : "Drag to reposition · pinch to zoom"}</Text>
        <GestureDetector gesture={gesture}>
          <View style={[styles.frame, { width: fw, height: fh, borderRadius: req.opts.shape === "circle" ? fw / 2 : radius.md }]} testID="cropper-frame">
            <Animated.View style={[{ width: dispW, height: dispH, position: "absolute", left: (fw - dispW) / 2, top: (fh - dispH) / 2 }, imgSt]}>
              <Image source={{ uri: req.uri }} style={{ width: dispW, height: dispH }} contentFit="fill" />
            </Animated.View>
          </View>
        </GestureDetector>
        <View style={styles.zoomRow}>
          <Pressable testID="cropper-zoom-out" onPress={() => step(-0.25)} style={styles.zbtn}><Icon name="remove" size={20} color="#FFFFFF" /></Pressable>
          <Pressable testID="cropper-reset" onPress={reset} style={styles.zbtn}><Icon name="scan-outline" size={18} color="#FFFFFF" /></Pressable>
          <Pressable testID="cropper-zoom-in" onPress={() => step(0.25)} style={styles.zbtn}><Icon name="add" size={20} color="#FFFFFF" /></Pressable>
        </View>
        <View style={styles.actions}>
          <Pressable testID="cropper-cancel" onPress={() => onDone(null)} style={[styles.btn, styles.ghost]}>
            <Text style={styles.btnText}>{ar ? "إلغاء" : "Cancel"}</Text>
          </Pressable>
          <Pressable testID="cropper-confirm" disabled={busy} onPress={doConfirm} style={[styles.btn, { backgroundColor: colors.brandPrimary }]}>
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.btnText}>{ar ? "حفظ" : "Save"}</Text>}
          </Pressable>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

// Fixed dark editor chrome.
const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.96)", alignItems: "center", justifyContent: "center", gap: spacing.md },
  title: { color: "#FFFFFF", fontSize: 17, fontWeight: "800" },
  hint: { color: "rgba(255,255,255,0.65)", fontSize: 12, textAlign: "center", paddingHorizontal: spacing.lg },
  frame: { overflow: "hidden", borderWidth: 2, borderColor: "rgba(255,255,255,0.85)", backgroundColor: "#111111" },
  zoomRow: { flexDirection: "row", gap: spacing.lg },
  zbtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", gap: spacing.md, paddingHorizontal: spacing.lg, alignSelf: "stretch" },
  btn: { flex: 1, height: 48, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  ghost: { borderWidth: 1, borderColor: "rgba(255,255,255,0.35)" },
  btnText: { color: "#FFFFFF", fontWeight: "800", fontSize: 15 },
});
