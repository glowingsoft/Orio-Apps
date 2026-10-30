

import { Platform } from "react-native";
import { cropImage } from "@/src/media/ImageCropper";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { API_BASE, getAccessToken, tryRefresh } from "@/src/api";

const RAW_CHUNK = 1_500_000; // bytes per chunk (≈2MB base64)

export type PickedMedia = {
  uri: string;
  kind: "image" | "video";
  mime: string;
  size: number;
  duration?: number | null;
};

export async function pickMedia(
  kind: "image" | "video",
  limit = 1,
  crop = false,
): Promise<PickedMedia[] | "denied"> {
  const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
  let granted = perm.granted;
  if (!granted && perm.canAskAgain !== false)
    granted = (await ImagePicker.requestMediaLibraryPermissionsAsync()).granted;
  if (!granted) return "denied";
  const r = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: [kind === "image" ? "images" : "videos"],
    allowsMultipleSelection: kind === "image" && limit > 1,
    selectionLimit: kind === "image" ? limit : 1,
    quality: 1, // Iter-135 — preserve original quality
    videoMaxDuration: 30,
  });
  if (r.canceled || !r.assets?.length) return [];
  if (kind === "image" && crop) {

    const out: PickedMedia[] = [];
    for (const a of r.assets.slice(0, limit)) {
      const ratio =
        a.width && a.height
          ? Math.min(16 / 9, Math.max(4 / 5, a.width / a.height))
          : 1;
      const c = await cropImage(a.uri, a.width, a.height, {
        aspect: [Math.round(ratio * 1000), 1000],
      });
      if (c)
        out.push({
          uri: c.uri,
          kind: "image",
          mime: c.mimeType,
          size: 0,
          duration: null,
        });
    }
    return out;
  }
  return r.assets.slice(0, limit).map((a) => ({
    uri: a.uri,
    kind,
    mime: a.mimeType || (kind === "image" ? "image/jpeg" : "video/mp4"),
    size: a.fileSize || 0,
    duration: a.duration != null ? (Platform.OS === "web" ? a.duration : a.duration / 1000) : null,
  }));
}

async function post(path: string, body: any) {
  const send = () =>
    fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getAccessToken() ?? ""}`,
      },
      body: JSON.stringify(body),
    });
  let res = await send();
  if (res.status === 401 && (await tryRefresh())) res = await send();
  const txt = await res.text();
  let j: any = null;
  try {
    j = txt ? JSON.parse(txt) : null;
  } catch {
    /* plain text */
  }
  if (!res.ok)
    throw new Error(j?.detail || txt || `Upload failed (${res.status})`);
  return j;
}

async function postWithProgress(
  path: string,
  body: any,
  onProgress: (p: number) => void,
) {
  const send = () =>
    new Promise<{ status: number; text: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE}${path}`);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("Authorization", `Bearer ${getAccessToken() ?? ""}`);
      let finished = false;
      xhr.upload.onprogress = (e) => {
        // Android can deliver progress events after the request has finished, and
        // (with the dev network inspector) reads the body more than once, so
        // `loaded` can restart or exceed `total`. Clamp, and keep the last 5% for
        // the server's reply.
        if (!finished && e.lengthComputable && e.total)
          onProgress(Math.min(0.95, e.loaded / e.total));
      };
      xhr.onload = () => {
        finished = true;
        resolve({ status: xhr.status, text: xhr.responseText });
      };
      xhr.onerror = () => reject(new Error("Network error"));
      xhr.ontimeout = () => reject(new Error("Upload timed out"));
      xhr.send(JSON.stringify(body));
    });
  let res = await send();
  if (res.status === 401 && (await tryRefresh())) res = await send();
  let j: any = null;
  try {
    j = res.text ? JSON.parse(res.text) : null;
  } catch {
    /* plain text */
  }
  if (res.status < 200 || res.status >= 300)
    throw new Error(j?.detail || res.text || `Upload failed (${res.status})`);
  return j;
}

function blobToB64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
    fr.onerror = reject;
    fr.readAsDataURL(b);
  });
}

/** Uploads one picked file; returns the backend URL path (/api/media/files/{id}). */
export async function uploadMedia(
  m:
    | PickedMedia
    | {
        uri: string;
        kind: "audio";
        mime: string;
        size: number;
        duration?: number | null;
      },
  purpose: "post" | "report" | "chat" | "cover" | "gift",
  onProgress?: (p: number) => void,
): Promise<string> {
  // Progress only ever moves forward (late or retried events never pull it back).
  let best = 0;
  const report = onProgress
    ? (p: number) => {
        if (p > best) {
          best = p;
          onProgress(p);
        }
      }
    : undefined;
  let size = m.size;
  let blob: Blob | null = null;
  if (Platform.OS === "web") {
    blob = await (await fetch(m.uri)).blob();
    size = blob.size;
  } else if (!size) {
    const info: any = await FileSystem.getInfoAsync(m.uri);
    size = info?.size || 0;
  }
  const total = Math.max(1, Math.ceil(size / RAW_CHUNK));
  const init = await post("/media/upload/init", {
    kind: m.kind,
    mime: m.mime,
    size,
    purpose,
    total_chunks: total,
    duration: m.duration ?? null,
  });
  for (let i = 0; i < total; i++) {
    const start = i * RAW_CHUNK;
    const len = Math.min(RAW_CHUNK, size - start);
    const data = blob
      ? await blobToB64(blob.slice(start, start + len))
      : await FileSystem.readAsStringAsync(m.uri, {
          encoding: FileSystem.EncodingType.Base64,
          position: start,
          length: len,
        });
    const chunk = { upload_id: init.upload_id, index: i, data };
    if (report) {
      await postWithProgress("/media/upload/chunk", chunk, (p) =>
        report((i + p) / total),
      );
    } else {
      await post("/media/upload/chunk", chunk);
    }
    report?.((i + 1) / total);
  }
  const done = await post("/media/upload/complete", {
    upload_id: init.upload_id,
  });
  return done.url as string;
}

/** Resolve a stored media reference to a full URL. */
export function mediaUrl(u?: string | null): string | undefined {
  if (!u) return undefined;
  if (u.startsWith("/api/")) return `${API_BASE.replace(/\/api$/, "")}${u}`;
  return u;
}

/** Private media (chat): full URL carrying the viewer's access token. */
export function privateMediaUrl(u?: string | null): string | undefined {
  const full = mediaUrl(u);
  if (!full || !u?.startsWith("/api/")) return full;
  return `${full}?t=${encodeURIComponent(getAccessToken() ?? "")}`;
}

/** Device camera capture (permission-checked). */
export async function captureImage(): Promise<
  PickedMedia | null | "denied" | "blocked"
> {
  const perm = await ImagePicker.getCameraPermissionsAsync();
  let granted = perm.granted;
  if (!granted && perm.canAskAgain !== false)
    granted = (await ImagePicker.requestCameraPermissionsAsync()).granted;
  if (!granted) return perm.canAskAgain === false ? "blocked" : "denied";
  const r = await ImagePicker.launchCameraAsync({
    mediaTypes: ["images"],
    quality: 1,
  });
  if (r.canceled || !r.assets?.length) return null;
  const a = r.assets[0];
  return {
    uri: a.uri,
    kind: "image",
    mime: a.mimeType || "image/jpeg",
    size: a.fileSize || 0,
  };
}
