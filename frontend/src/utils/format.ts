/**
 * Compact K/M formatting (never translated; latin digits in both locales).
 * Max unit is M (e.g. 3500M). Backend values stay exact.
 */
export function abbrevNumber(n: number): string {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  const trim = (x: number) => {
    const s = x >= 100 ? Math.floor(x).toString() : (Math.floor(x * 10) / 10).toString();
    return s.replace(/\.0$/, "");
  };
  if (v >= 1_000_000) return `${trim(v / 1_000_000)}M`;
  if (v >= 1_000) return `${trim(v / 1_000)}K`;
  return String(v);
}
