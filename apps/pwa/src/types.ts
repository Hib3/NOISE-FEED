export type FetchMode = "proxy-first" | "direct-only" | "auto";

export type AppSettings = {
  proxyUrl: string;
  fetchMode: FetchMode;
  reducedMotion: boolean;
};

export type SourceStatus = "idle" | "checking" | "ok" | "error";

export type FeedSource = {
  id: string;
  title: string;
  feedUrl: string;
  siteUrl: string;
  createdAt: string;
  lastFetchedAt?: string;
  status: SourceStatus;
  statusMessage?: string;
};

export type Article = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  title: string;
  url: string;
  publishedAt?: string;
  fetchedAt: string;
  excerpt: string;
  contentHtml: string;
  read: boolean;
};

export type Scrap = {
  articleId: string;
  savedAt: string;
  tags: string[];
};

export type Note = {
  articleId: string;
  text: string;
  updatedAt: string;
};

export type BackupData = {
  version: 1;
  exportedAt: string;
  settings: AppSettings;
  sources: FeedSource[];
  articles: Article[];
  scraps: Scrap[];
  notes: Note[];
};

export type ParsedFeed = {
  title: string;
  siteUrl: string;
  articles: Omit<Article, "sourceId" | "sourceTitle" | "fetchedAt" | "read">[];
};
