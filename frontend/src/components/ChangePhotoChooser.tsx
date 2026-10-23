/**
 * ChangePhotoChooser — Iter-69.
 *
 * Shared modal used by Profile Avatar and Room Avatar flows. Shows exactly
 * two options:
 *   1. Change Profile Photo  → images only (no video, no GIF)
 *   2. Change Profile GIF    → GIF only, VIP4+ required
 *
 * When invoked, the chooser:
 *   • Pre-fetches `/me/media-block`. If the user is currently under the
 *     3-day media restriction, it immediately shows a dedicated modal with
 *     the exact Arabic copy + "فهمت" button; nothing else is reachable.
 *   • If the user picks "Change Profile GIF" while below VIP4, it swaps
 *     to a VIP4 upsell modal with a "{`Go to VIP${gifMinVip ?? 4} Upgrade`}" CTA.
 *   • Otherwise it launches ImagePicker with the correct media type and
 *     returns the picked data URI to the caller via `onPicked(uri, kind)`.
 *
 * The caller is responsible for calling the moderation + save APIs. If a
 * moderation API throws `USER_MEDIA_BLOCKED`, call `openBlockedModal()`
 * exposed through the imperative ref so the user sees the Arabic notice.
 */
import { GifAccessModal } from "@/src/components/GifAccessModal";
import React, { useEffect, useImperativeHandle, forwardRef, useState } from "react";
import { pickAndCrop } from "@/src/media/ImageCropper";
import {
  View, Text, StyleSheet, Pressable, Modal, ActivityIndicator,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import Icon from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { apiMediaBlockStatus } from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { colors, spacing, radius } from "@/src/theme";

type Kind = "photo" | "gif";

export type ChangePhotoChooserRef = {
  open: () => void;
  openBlockedModal: () => void;
};

type Props = {
  onPicked: (dataUri: string, kind: Kind) => void;
  isRTL?: boolean;
  /** Minimum VIP for GIFs (profile avatar = 4, room cover keeps 5). */
  gifMinVip?: number;
};

export const ChangePhotoChooser = forwardRef<ChangePhotoChooserRef, Props>(
  function ChangePhotoChooser({ onPicked, isRTL, gifMinVip }, ref) {
    const router = useRouter();
    const { user } = useAuth();
    const [open, setOpen] = useState(false);
    const [vipUpsell, setVipUpsell] = useState(false);
    const [gifModal, setGifModal] = useState(false);
    const [blocked, setBlocked] = useState(false);
    const [checking, setChecking] = useState(false);

    useImperativeHandle(ref, () => ({
      open: async () => {
        setChecking(true);
        try {
          const st = await apiMediaBlockStatus();
          if (st?.blocked) {
            setBlocked(true);
            return;
          }
          setOpen(true);
        } catch {
          setOpen(true);
        } finally {
          setChecking(false);
        }
      },
      openBlockedModal: () => {
        setOpen(false);
        setVipUpsell(false);
        setBlocked(true);
      },
    }));

    const close = () => setOpen(false);

    const pickPhoto = async () => {
      setOpen(false);
      try {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) return;
        const res = await pickAndCrop({ aspect: [1, 1], shape: "circle", base64: true, maxSide: 1080 });
        if (res.canceled) return;
        const a = res.assets?.[0];
        if (!a) return;
        // Iter-70 — reject GIFs/videos: the "Change Photo" option is for
        // images only. If the user still manages to pick a GIF (gallery
        // allowed it on some devices), surface the error up to the caller.
        const mime = (a.mimeType || "").toLowerCase();
        const uriLow = (a.uri || "").toLowerCase();
        const nameLow = (a.fileName || "").toLowerCase();
        let isGif = mime.includes("gif") || uriLow.endsWith(".gif") || nameLow.endsWith(".gif");
        const isVideo = mime.startsWith("video") || (a as any).type === "video";
        // Iter-72 — strict byte-level GIF detection even when MIME/name/URI
        // all claim the file is a JPEG/PNG. We peek at the first 32 base64
        // chars which encode the first 24 raw bytes; any GIF file starts
        // with the ASCII magic signature "GIF87a" or "GIF89a". In base64,
        // every GIF therefore starts with the "R0lGOD" prefix.
        if (!isGif && a.base64) {
          const head = a.base64.slice(0, 16);
          if (head.startsWith("R0lGOD")) {
            isGif = true;
          }
        }
        if (isGif || isVideo) {
          onPicked("__NOT_PHOTO__", "photo");
          return;
        }
        const dataUri = a.base64 ? `data:image/jpeg;base64,${a.base64}` : a.uri;
        onPicked(dataUri, "photo");
      } catch {
        // no-op; caller surfaces errors from the moderation call
      }
    };

    const pickGif = async () => {
      const vip = Number(user?.vip_level || 0);
      // Profile avatar (VIP4 rule): VIP4+ or an active paid 7-day GIF pass.
      const eligible = (gifMinVip ?? 4) === 4 ? (vip >= 4 || !!(user as any)?.gif_eligible) : vip >= (gifMinVip ?? 4);
      if (!eligible) {
        setOpen(false);
        if ((gifMinVip ?? 4) === 4) setGifModal(true); else setVipUpsell(true);
        return;
      }
      setOpen(false);
      try {
        // Iter-70 — use a GIF-only DocumentPicker so the gallery/file picker
        // natively restricts to .gif. On web this uses `<input accept>` and
        // on native it uses UIDocumentPicker / Android SAF with mime=image/gif.
        const doc = await DocumentPicker.getDocumentAsync({
          type: ["image/gif"],
          multiple: false,
          copyToCacheDirectory: true,
        });
        if (doc.canceled) return;
        const a = doc.assets?.[0];
        if (!a) return;
        const mime = (a.mimeType || "").toLowerCase();
        const nameLow = (a.name || "").toLowerCase();
        const uriLow = (a.uri || "").toLowerCase();
        const isGif = mime === "image/gif" || nameLow.endsWith(".gif") || uriLow.endsWith(".gif");
        if (!isGif) {
          onPicked("__NOT_GIF__", "gif");
          return;
        }
        let dataUri = a.uri;
        let gifBytes: number | null = null;
        try {
          const resp = await fetch(a.uri);
          const blob = await resp.blob();
          gifBytes = blob.size;
          dataUri = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(String(reader.result));
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch { /* fall back to raw uri */ }
        // Iter-71 — hard GIF file-size cap client side (5 MB). Dimensions,
        // frame count and duration are enforced server-side where PIL can
        // parse the GIF reliably.
        const GIF_MAX_BYTES = 5 * 1024 * 1024;
        if (gifBytes !== null && gifBytes > GIF_MAX_BYTES) {
          const mb = (gifBytes / (1024 * 1024)).toFixed(1);
          onPicked(`__GIF_TOO_LARGE__${mb}`, "gif");
          return;
        }
        onPicked(dataUri, "gif");
      } catch {
        // ignore
      }
    };

    return (
      <>
        {/* -------- Chooser modal -------- */}
        <Modal transparent animationType="fade" visible={open} onRequestClose={close}>
          <View style={_s.backdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={close} />
            <View style={_s.sheet}>
              <View style={_s.handle} />
              <Pressable testID="chooser-photo" onPress={pickPhoto} style={({ pressed }) => [_s.row, pressed && _s.rowPressed]}>
                <View style={[_s.iconWrap, { backgroundColor: "#8B5CF622" }]}>
                  <Icon name="image" size={22} color="#8B5CF6" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={_s.rowTitle}>{isRTL ? "تغيير الصورة الشخصية" : "Change Profile Photo"}</Text>
                  <Text style={_s.rowSub}>{isRTL ? "صور فقط (بدون فيديو أو GIF)" : "Images only (no videos or GIFs)"}</Text>
                </View>
                <Icon name={isRTL ? "chevron-back" : "chevron-forward"} size={18} color={colors.muted} />
              </Pressable>
              <Pressable testID="chooser-gif" onPress={pickGif} style={({ pressed }) => [_s.row, pressed && _s.rowPressed]}>
                <View style={[_s.iconWrap, { backgroundColor: "#F472B622" }]}>
                  <Icon name="sparkles" size={22} color="#F472B6" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={_s.rowTitle}>{isRTL ? "تغيير صورة متحركة/Gif" : "Change Profile GIF"}</Text>
                  <Text style={_s.rowSub}>
                    {isRTL ? `ملفات GIF فقط • يتطلب VIP${gifMinVip ?? 4}+` : `GIF files only • VIP${gifMinVip ?? 4}+ required`}
                  </Text>
                </View>
                <Icon name={isRTL ? "chevron-back" : "chevron-forward"} size={18} color={colors.muted} />
              </Pressable>
              <Pressable testID="chooser-cancel" onPress={close} style={_s.cancel}>
                <Text style={_s.cancelText}>{isRTL ? "إلغاء" : "Cancel"}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <GifAccessModal visible={gifModal} onClose={() => setGifModal(false)} isRTL={!!isRTL} />
        {/* -------- VIP5 upsell -------- */}
        <Modal transparent animationType="fade" visible={vipUpsell} onRequestClose={() => setVipUpsell(false)}>
          <View style={_s.backdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setVipUpsell(false)} />
            <View style={_s.card}>
              <View style={[_s.iconHero, { backgroundColor: "#F5C54222" }]}>
                <Icon name="diamond" size={28} color="#F5C542" />
              </View>
              <Text style={_s.cardTitle}>
                {isRTL
                  ? `يرجى الترقية إلى VIP${gifMinVip ?? 4} لتغيير صورتك الشخصية المتحركة.`
                  : `Please upgrade to VIP${gifMinVip ?? 4} to change your GIF profile picture.`}
              </Text>
              <Pressable
                testID="go-to-vip5"
                onPress={() => { setVipUpsell(false); router.push("/vip" as any); }}
                style={_s.ctaPurple}
              >
                <Text style={_s.ctaPurpleText}>{isRTL ? `الترقية إلى VIP${gifMinVip ?? 4}` : `Go to VIP${gifMinVip ?? 4} Upgrade`}</Text>
              </Pressable>
              <Pressable onPress={() => setVipUpsell(false)} style={{ marginTop: spacing.sm, paddingVertical: 8 }}>
                <Text style={{ color: colors.muted, fontSize: 13 }}>{isRTL ? "إغلاق" : "Close"}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* -------- 3-day block notice -------- */}
        <Modal transparent animationType="fade" visible={blocked} onRequestClose={() => setBlocked(false)}>
          <View style={_s.backdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setBlocked(false)} />
            <View style={_s.card}>
              <View style={[_s.iconHero, { backgroundColor: "#EF444422" }]}>
                <Icon name="shield" size={28} color="#EF4444" />
              </View>
              <Text style={[_s.cardTitle, { textAlign: "right" }]}>
                لقد قمت برفع صور مسيئة للمجتمع وتم حظرك من رفع صوره/gif لمدة ٣ ايام
              </Text>
              <Pressable
                testID="blocked-ok"
                onPress={() => setBlocked(false)}
                style={_s.ctaPurple}
              >
                <Text style={_s.ctaPurpleText}>فهمت</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* Non-blocking preflight indicator */}
        {checking && (
          <Modal transparent animationType="none" visible>
            <View style={_s.backdrop}>
              <ActivityIndicator color="#8B5CF6" size="large" />
            </View>
          </Modal>
        )}
      </>
    );
  },
);

const _s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  sheet: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: "rgba(139,92,246,0.3)",
  },
  handle: {
    width: 44, height: 4, borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  rowPressed: { backgroundColor: "rgba(255,255,255,0.05)" },
  iconWrap: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
  },
  rowTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  rowSub: { color: colors.muted, fontSize: 11, marginTop: 2, fontWeight: "600" },
  cancel: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  cancelText: { color: colors.muted, fontWeight: "700" },

  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: "rgba(139,92,246,0.3)",
    alignItems: "center",
  },
  iconHero: {
    width: 60, height: 60, borderRadius: 30,
    alignItems: "center", justifyContent: "center",
    marginBottom: spacing.md,
  },
  cardTitle: {
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 22,
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  ctaPurple: {
    backgroundColor: "#8B5CF6",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    minWidth: 180,
    alignItems: "center",
  },
  ctaPurpleText: { color: "#FFFFFF", fontWeight: "900", fontSize: 15 },
});
