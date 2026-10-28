
export function parseServerTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const hasOffset = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(value);
  const ms = new Date(hasOffset ? value : `${value}Z`).getTime();
  return Number.isNaN(ms) ? null : ms;
}
