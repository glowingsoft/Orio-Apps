/**
 * Iter-134 — one-to-one voice call engine (NATIVE, react-native-agora).
 * Tokens always come from the backend (/api/calls/*); the certificate never
 * leaves the server. Requires a development / production build.
 */
import { Platform, PermissionsAndroid } from "react-native";
// Type-only: the runtime module is lazy-required below, since merely
// importing it crashes in Expo Go (unsupported there; works in a dev build).
import type { IRtcEngine, IRtcEngineEventHandler } from "react-native-agora";
import type { CallRtc } from "@/src/api";
import { isExpoGo } from "@/src/isExpoGo";

export const callEngineSupported = !isExpoGo;

let engine: IRtcEngine | null = null;
let handler: IRtcEngineEventHandler | null = null;

export async function ensureCallMic(): Promise<boolean> {
  if (Platform.OS !== "android") return true; // iOS prompts on join
  const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  return r === PermissionsAndroid.RESULTS.GRANTED;
}

export async function joinCall(rtc: CallRtc, ev: {
  onPeerJoined: () => void; onPeerLeft: () => void; onError: (m: string) => void; onTokenWillExpire: () => void;
}) {
  if (isExpoGo) { ev.onError("Voice calls need a development build (unavailable in Expo Go)."); return; }
  const { createAgoraRtcEngine, ChannelProfileType, ClientRoleType, AudioProfileType, AudioScenarioType } = require("react-native-agora");
  if (!(await ensureCallMic())) { ev.onError("mic"); return; }
  leaveCall();
  const eng: IRtcEngine = createAgoraRtcEngine();
  engine = eng;
  eng.initialize({ appId: rtc.app_id, channelProfile: ChannelProfileType.ChannelProfileCommunication });
  eng.enableAudio();
  // Speech-optimised, low-latency 1:1 profile with AI noise suppression.
  try { eng.setAudioProfile(AudioProfileType.AudioProfileSpeechStandard, AudioScenarioType.AudioScenarioChatroom); } catch {}
  try { (eng as any).setAINSMode?.(true, 0); } catch {}
  handler = {
    onUserJoined: () => ev.onPeerJoined(),
    onUserOffline: () => ev.onPeerLeft(),
    onError: (code: number, msg: string) => ev.onError(`${code} ${msg}`),
    onTokenPrivilegeWillExpire: () => ev.onTokenWillExpire(),
  };
  eng.registerEventHandler(handler);
  eng.joinChannel(rtc.token, rtc.channel, rtc.uid, {
    clientRoleType: ClientRoleType.ClientRoleBroadcaster,
    publishMicrophoneTrack: true,
    autoSubscribeAudio: true,
  });
  eng.setEnableSpeakerphone(false);
}

export function setCallMuted(m: boolean) { try { engine?.muteLocalAudioStream(m); } catch {} }
export function setCallSpeaker(on: boolean) { try { engine?.setEnableSpeakerphone(on); } catch {} }
export function renewCallToken(token: string) { try { engine?.renewToken(token); } catch {} }

export function leaveCall() {
  try {
    if (engine) {
      engine.leaveChannel();
      if (handler) engine.unregisterEventHandler(handler);
      engine.release();
    }
  } catch {}
  engine = null;
  handler = null;
}
