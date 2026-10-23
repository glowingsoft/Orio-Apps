/** Iter-135 — tiny bus: room chat line rejected by server moderation. */
const listeners = new Set<() => void>();
export function emitContentBlocked() { listeners.forEach((l) => l()); }
export function onContentBlocked(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

type RejectFn = (code: string) => void;
const rejectSubs = new Set<RejectFn>();
export function emitChatRejected(code: string) { rejectSubs.forEach((f) => f(code)); }
export function onChatRejected(fn: RejectFn) { rejectSubs.add(fn); return () => { rejectSubs.delete(fn); }; }
