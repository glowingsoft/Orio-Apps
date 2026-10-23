/**
 * Room music engine (native): plays the DJ's track INTO the Agora voice channel
 * via audio mixing, so every participant hears it — independent of mic mute.
 */
let engine: any = null;
let current: string | null = null;
let active = false;
let endedCb: (() => void) | null = null;
let reapply: (() => void) | null = null;

export function attachMusicEngine(e: any) { engine = e; }
export function detachMusicEngine() { engine = null; current = null; active = false; }
export function setMuteReapply(fn: (() => void) | null) { reapply = fn; }
export function onMusicEnded(cb: (() => void) | null) { endedCb = cb; }
export function isMusicActive() { return active; }
export function musicAvailable() { return !!engine; }

/** Agora AudioMixingStateType 713=Stopped, reason 723=AllLoopsCompleted. */
export function handleMixingState(state: number, reason: number) {
  if (state === 713 && reason === 723) { active = false; current = null; reapply?.(); endedCb?.(); }
}

export function musicPlay(uri: string, volume: number) {
  if (!engine) return false;
  try {
    if (current === uri) engine.resumeAudioMixing();
    else { engine.stopAudioMixing(); engine.startAudioMixing(uri, false, 1, 0); current = uri; }
    engine.adjustAudioMixingVolume(Math.round(volume));
    active = true;
    reapply?.();
    return true;
  } catch { return false; }
}
export function musicPause() { try { engine?.pauseAudioMixing(); } catch {} active = false; reapply?.(); }
export function musicStop() { try { engine?.stopAudioMixing(); } catch {} current = null; active = false; reapply?.(); }
export function musicVolume(v: number) { try { engine?.adjustAudioMixingVolume(Math.round(v)); } catch {} }
export function currentUri() { return current; }
