import type { AppSettings, Article, ParsedFeed } from "./types";
import { clipText, hashText, toAbsoluteUrl } from "./utils";

function textOf(parent: Element | Document, selector: string): string {
  return parent.querySelector(selector)?.textContent?.trim() ?? "";
}

function attrOf(parent: Element, selector: string, attr: string): string {
  return parent.querySelector(selector)?.getAttribute(attr)?.trim() ?? "";
}

function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(`<main>${html}</main>`, "text/html");
  return doc.body.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<main>${html}</main>`, "text/html");
  const dangerous = doc.querySelectorAll("script, style, iframe, object, embed, form, input, button, meta, link");
  dangerous.forEach((node) => node.remove());
  doc.querySelectorAll("*").forEach((element) => {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on") || value.startsWith("javascript:") || value.startsWith("data:text/html")) {
        element.removeAttribute(attr.name);
      }
      if (["srcset", "style"].includes(name)) element.removeAttribute(attr.name);
    }
  });
  return doc.body.firstElementChild?.innerHTML ?? "";
}

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("RSS / Atom XMLとして読めませんでした。");
  }
  return doc;
}

function readAtomLink(entry: Element, baseUrl: string): string {
  const alternate = Array.from(entry.querySelectorAll("link")).find((link) => {
    const rel = link.getAttribute("rel");
    return !rel || rel === "alternate";
  });
  return toAbsoluteUrl(alternate?.getAttribute("href") ?? textOf(entry, "link"), baseUrl);
}

function readRssLink(item: Element, baseUrl: string): string {
  const link = textOf(item, "link") || textOf(item, "guid");
  return toAbsoluteUrl(link, baseUrl);
}

export function parseFeed(xml: string, feedUrl: string): ParsedFeed {
  const doc = parseXml(xml);
  const rootName = doc.documentElement.nodeName.toLowerCase();
  const isAtom = rootName.includes("feed");
  const sourceTitle = isAtom ? textOf(doc, "feed > title") : textOf(doc, "channel > title");
  const siteUrl = isAtom
    ? toAbsoluteUrl(attrOf(doc.documentElement, "link[rel='alternate'], link:not([rel])", "href") || feedUrl, feedUrl)
    : toAbsoluteUrl(textOf(doc, "channel > link") || feedUrl, feedUrl);

  const entries = Array.from(doc.querySelectorAll(isAtom ? "entry" : "item"));
  if (!sourceTitle && entries.length === 0) throw new Error("記事が見つかりませんでした。");

  const articles = entries.slice(0, 80).map((entry) => {
    const title = textOf(entry, "title") || "無題の記事";
    const url = isAtom ? readAtomLink(entry, feedUrl) : readRssLink(entry, feedUrl);
    const publishedAt =
      textOf(entry, "published") ||
      textOf(entry, "updated") ||
      textOf(entry, "pubDate") ||
      textOf(entry, "dc\\:date") ||
      undefined;
    const rawHtml =
      textOf(entry, "content") ||
      textOf(entry, "content\\:encoded") ||
      textOf(entry, "summary") ||
      textOf(entry, "description") ||
      "";
    const contentHtml = sanitizeHtml(rawHtml);
    const plain = htmlToText(contentHtml || rawHtml);
    const stable = url ? url : `${feedUrl}|${title}|${publishedAt ?? ""}`;
    return {
      id: hashText(stable),
      title,
      url: url || feedUrl,
      publishedAt,
      excerpt: clipText(plain || title, 240),
      contentHtml: contentHtml || clipText(plain || title, 600)
    };
  });

  return {
    title: sourceTitle || new URL(feedUrl).hostname,
    siteUrl,
    articles
  };
}

async function fetchText(url: string, timeoutMs = 12_000): Promise<string> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5" }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("取得が時間切れになりました。");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function proxyUrl(settings: AppSettings, feedUrl: string): string {
  try {
    const proxy = new URL(settings.proxyUrl);
    proxy.searchParams.set("url", feedUrl);
    return proxy.toString();
  } catch {
    throw new Error("RSSプロキシURLが正しくありません。");
  }
}

function validateFeedUrl(feedUrl: string): string {
  try {
    const url = new URL(feedUrl);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    return url.toString();
  } catch {
    throw new Error("RSS / Atom URLが正しくありません。");
  }
}

export async function fetchFeed(feedUrl: string, settings: AppSettings): Promise<ParsedFeed> {
  const normalizedFeedUrl = validateFeedUrl(feedUrl);
  const attempts =
    settings.fetchMode === "direct-only"
      ? [normalizedFeedUrl]
      : settings.fetchMode === "auto"
        ? [proxyUrl(settings, normalizedFeedUrl), normalizedFeedUrl]
        : [proxyUrl(settings, normalizedFeedUrl)];

  const reasons: string[] = [];
  for (const target of attempts) {
    try {
      const xml = await fetchText(target);
      return parseFeed(xml, normalizedFeedUrl);
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : "不明な取得エラー");
    }
  }
  throw new Error(reasons.filter(Boolean).join(" / ") || "取得できませんでした。");
}

export function mergeArticles(existing: Article[], incoming: Article[]): Article[] {
  const map = new Map(existing.map((article) => [article.id, article]));
  for (const article of incoming) {
    const old = map.get(article.id);
    map.set(article.id, old ? { ...article, read: old.read } : article);
  }
  return Array.from(map.values()).sort((a, b) => {
    const left = new Date(a.publishedAt ?? a.fetchedAt).getTime();
    const right = new Date(b.publishedAt ?? b.fetchedAt).getTime();
    return right - left;
  });
}
