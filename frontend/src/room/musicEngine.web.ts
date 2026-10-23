/**
 * Room music engine (web preview): the browser has no Agora voice channel in
 * this app, so playback is LOCAL to the DJ's browser only (preview). Native
 * builds broadcast to the whole room via Agora audio mixing.
 */
let audio: HTMLAudioElement | null = null;
let current: string | null = null;
let active = false;
let endedCb: (() => void) | null = null;

export function attachMusicEngine(_e: any) {}
export function detachMusicEngine() {}
export function setMuteReapply(_fn: (() => void) | null) {}
export function onMusicEnded(cb: (() => void) | null) { endedCb = cb; }
export function isMusicActive() { return active; }
export function musicAvailable() { return typeof window !== "undefined"; }
export function handleMixingState(_s: number, _r: number) {}

export function musicPlay(uri: string, volume: number) {
  if (typeof window === "undefined") return false;
  if (!audio) {
    audio = new Audio();
    audio.addEventListener("ended", () => { active = false; current = null; endedCb?.(); });
  }
  if (current !== uri) { audio.src = uri; current = uri; }
  audio.volume = Math.max(0, Math.min(1, volume / 100));
  audio.play().catch(() => {});
  active = true;
  return true;
}
export function musicPause() { audio?.pause(); active = false; }
export function musicStop() { if (audio) { audio.pause(); audio.src = ""; } current = null; active = false; }
export function musicVolume(v: number) { if (audio) audio.volume = Math.max(0, Math.min(1, v / 100)); }
export function currentUri() { return current; }
