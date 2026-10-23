// Shared types so the web shim doesn't need to import the native module.
export type AgoraStatus =
  | "idle"
  | "requesting-permission"
  | "no-permission"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "disabled"
  | "error";

export type AgoraSpeakerState = { uid: number; volume: number };

export type UseAgoraOptions = {
  roomId: string | null;
  wantPublisher: boolean;
  localMuted: boolean;
  numericUid: number;
  enabled?: boolean;
};

export type UseAgoraReturn = {
  status: AgoraStatus;
  error?: string;
  activeSpeakers: AgoraSpeakerState[];
  remoteAudioLevels: Record<number, number>;
  isLocalSpeaking: boolean;
};
