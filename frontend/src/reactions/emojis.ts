/** Batch B — 20 animated emoji reactions (Google Noto Animated Emoji, Lottie). */
export type ReactionCat = "love" | "laugh" | "sad" | "angry" | "celebrate" | "encourage" | "other";

export const REACTIONS: { key: string; cat: ReactionCat }[] = [
  { key: "1f60d", cat: "love" }, { key: "1f618", cat: "love" }, { key: "1f618_m", cat: "love" }, { key: "1f970", cat: "love" },
  { key: "1f602", cat: "laugh" }, { key: "1f923", cat: "laugh" }, { key: "1f606", cat: "laugh" },
  { key: "1f62d", cat: "sad" }, { key: "1f97a", cat: "sad" }, { key: "1f622", cat: "sad" },
  { key: "1f621", cat: "angry" }, { key: "1f92c", cat: "angry" }, { key: "1f624", cat: "angry" },
  { key: "1f973", cat: "celebrate" }, { key: "1f389", cat: "celebrate" }, { key: "1f525", cat: "celebrate" },
  { key: "1f44f", cat: "encourage" }, { key: "1f4aa", cat: "encourage" }, { key: "1f44d", cat: "encourage" },
  { key: "1f62e", cat: "other" }, { key: "1f631", cat: "other" },
];

export const REACTION_CATS: { key: ReactionCat; en: string; ar: string }[] = [
  { key: "love", en: "Love", ar: "حب" },
  { key: "laugh", en: "Laugh", ar: "ضحك" },
  { key: "sad", en: "Sad", ar: "حزن" },
  { key: "angry", en: "Angry", ar: "غضب" },
  { key: "celebrate", en: "Celebrate", ar: "احتفال" },
  { key: "encourage", en: "Cheer", ar: "تشجيع" },
  { key: "other", en: "Other", ar: "أخرى" },
];

const NOTO = "https://fonts.gstatic.com/s/e/notoemoji/latest/";
/** "_m" suffix = mirrored (opposite-facing) variant of the same artwork. */
export const isMirrored = (k: string) => k.endsWith("_m");
const base = (k: string) => k.replace(/_m$/, "");
export const reactionLottie = (k: string) => `${NOTO}${base(k)}/lottie.json`;
export const reactionStill = (k: string) => `${NOTO}${base(k)}/512.webp`;
export const REACTION_COOLDOWN_MS = 2500;
