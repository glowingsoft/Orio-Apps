/**
 * One-to-one voice call engine (WEB) — Agora Web SDK (agora-rtc-sdk-ng).
 * Same backend tokens / channel / uid as the native engine, so a browser
 * user and a phone user hear each other in real time.
 */
import type { CallRtc } from "@/src/api";

export const callEngineSupported = true;

let client: any = null;
let micTrack: any = null;
let remoteTracks: any[] = [];

export async function ensureCallMic() { return true; }

export async function joinCall(rtc: CallRtc, ev: {
  onPeerJoined: () => void; onPeerLeft: () => void; onError: (m: string) => void; onTokenWillExpire: () => void;
}) {
  await leaveCall();
  if (typeof window !== "undefined" && !window.isSecureContext) {
    ev.onError("join:insecure-context — open the site via https:// or http://localhost (the browser blocks the microphone on http://<IP>)");
    return;
  }
  const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
  try { AgoraRTC.setLogLevel(3); } catch {}
  client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
  client.on("user-published", async (u: any, mediaType: string) => {
    if (mediaType !== "audio") return;
    try {
      await client.subscribe(u, "audio");
      u.audioTrack?.play();
      remoteTracks.push(u.audioTrack);
      ev.onPeerJoined();
    } catch (e: any) { ev.onError(String(e?.message || e)); }
  });
  client.on("connection-state-change", (cur: string, prev: string, reason?: string) => console.log("[call] state", prev, "->", cur, reason || ""));
  client.on("exception", (e: any) => console.warn("[call] exception", e?.code, e?.msg));
  client.on("user-joined", (u: any) => console.log("[call] peer joined", u.uid));
  try { (AgoraRTC as any).onAutoplayFailed = () => console.warn("[call] autoplay blocked: click the page to hear audio"); } catch {}
  client.on("user-left", () => ev.onPeerLeft());
  client.on("token-privilege-will-expire", () => ev.onTokenWillExpire());
  try {
    await client.join(rtc.app_id, rtc.channel, rtc.token, rtc.uid);
  } catch (e: any) {
    console.warn("[call] Agora join failed", e?.code, e?.message || e);
    ev.onError(`join:${e?.code || ""} ${e?.message || e}`);
    return;
  }
  // Users already in the channel before we joined: subscribe to their audio.
  for (const u of client.remoteUsers || []) {
    if (u.hasAudio) {
      try { await client.subscribe(u, "audio"); u.audioTrack?.play(); remoteTracks.push(u.audioTrack); ev.onPeerJoined(); } catch {}
    }
  }
  try {
    // Speech profile + browser 3A (echo cancel, noise suppression, gain) for clear low-latency voice.
    micTrack = await AgoraRTC.createMicrophoneAudioTrack({ encoderConfig: "speech_standard", AEC: true, ANS: true, AGC: true });
    await client.publish([micTrack]);
  } catch {
    ev.onError("mic");
  }
}

export function setCallMuted(m: boolean) { try { micTrack?.setMuted(m); } catch {} }
export function setCallSpeaker(_on: boolean) { /* browsers route audio to the default output */ }
export function renewCallToken(token: string) { try { client?.renewToken(token); } catch {} }

export async function leaveCall() {
  if (client) console.trace("[call] leaveCall() while connected");
  const c = client, t = micTrack;
  client = null; micTrack = null;
  remoteTracks.forEach((r) => { try { r?.stop(); } catch {} });
  remoteTracks = [];
  try { t?.stop(); t?.close(); } catch {}
  try { await c?.leave(); } catch {}
}
