export const DEFAULT_PROXY_URL = "https://noise-feed-rss-proxy.hibi317.workers.dev";

export function nowIso(): string {
  return new Date().toISOString();
}

export function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function issueNumber(date = new Date()): number {
  const start = new Date("2026-01-01T00:00:00+09:00").getTime();
  const today = new Date(`${localDateKey(date)}T00:00:00+09:00`).getTime();
  return Math.max(1, Math.floor((today - start) / 86_400_000) + 1);
}

export function formatDate(value?: string): string {
  if (!value) return "不明";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "不明";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function shortDate(value?: string): string {
  if (!value) return "日付不明";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日付不明";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).format(date);
}

export function hashText(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function seededIndex(seed: string, size: number): number {
  if (size <= 1) return 0;
  return parseInt(hashText(seed), 36) % size;
}

export function toAbsoluteUrl(value: string, base: string): string {
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
}

export function clipText(value: string, max = 180): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}…`;
}
