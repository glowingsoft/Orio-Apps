/**
 * ORIO Full-Screen Image Viewer (Iter-48)
 * -----------------------------------------------------------------------------
 * A dead-simple modal that shows a single image at its native aspect in the
 * center of a black overlay. Tap the backdrop OR the X to dismiss.
 *
 * Used so that tapping on a profile avatar opens the raw image directly
 * (no intermediate screen), matching the spec:
 *   "Open the image directly in the image viewer.
 *    Do not open an intermediate menu / profile page first."
 *
 *   import { useImageViewer } from "@/src/components/ImageViewer";
 *   const { show } = useImageViewer();
 *   <Pressable onPress={() => show(user.avatar_url)}>...</Pressable>
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  Modal, View, Pressable, StyleSheet, StatusBar, Platform,
} from "react-native";
import { Image } from "expo-image";
import Icon from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Ctx = {
  show: (uri: string | null | undefined) => void;
  hide: () => void;
};

const ImageViewerCtx = createContext<Ctx | null>(null);

export function useImageViewer(): Ctx {
  const ctx = useContext(ImageViewerCtx);
  if (!ctx) {
    return { show: () => undefined, hide: () => undefined };
  }
  return ctx;
}

export function ImageViewerProvider({ children }: { children: React.ReactNode }) {
  const [uri, setUri] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  const show = useCallback((u: string | null | undefined) => {
    if (!u) return;
    setUri(u);
  }, []);
  const hide = useCallback(() => setUri(null), []);

  const ctx = useMemo<Ctx>(() => ({ show, hide }), [show, hide]);

  return (
    <ImageViewerCtx.Provider value={ctx}>
      {children}
      <Modal
        visible={!!uri}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={hide}
      >
        {Platform.OS === "ios" && <StatusBar barStyle="light-content" />}
        <Pressable testID="orio-image-viewer-backdrop" onPress={hide} style={styles.backdrop}>
          {!!uri && (
            <Image
              source={uri}
              style={styles.image}
              contentFit="contain"
              transition={120}
              testID="orio-image-viewer-image"
            />
          )}
          <Pressable
            testID="orio-image-viewer-close"
            onPress={hide}
            hitSlop={16}
            style={[styles.closeBtn, { top: insets.top + 10 }]}
          >
            <Icon name="close" size={22} color="#FFF" />
          </Pressable>
        </Pressable>
      </Modal>
    </ImageViewerCtx.Provider>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.96)",
    justifyContent: "center",
    alignItems: "center",
  },
  image: { width: "100%", height: "100%" },
  closeBtn: {
    position: "absolute",
    right: 16,
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.18)",
  },
});

export default ImageViewerProvider;
