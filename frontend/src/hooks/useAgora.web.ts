/**
 * useAgora — WEB no-op implementation.
 *
 * react-native-agora is a native module and cannot run in the browser.
 * On web we simply expose a stable, inert API so the room screen renders normally.
 * Voice functionality lights up as soon as the app runs inside an Expo dev build
 * (or a real device / simulator), where the .ts file above is picked instead.
 */
import type { UseAgoraOptions, UseAgoraReturn } from "./useAgora.native-types";

export type { AgoraStatus, AgoraSpeakerState, UseAgoraOptions, UseAgoraReturn } from "./useAgora.native-types";

export function useAgora(_opts: UseAgoraOptions): UseAgoraReturn {
  return {
    status: "disabled",
    error: undefined,
    activeSpeakers: [],
    remoteAudioLevels: {},
    isLocalSpeaking: false,
  };
}
