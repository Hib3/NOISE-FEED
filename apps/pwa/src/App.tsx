import { useEffect, useMemo, useRef, useState } from "react";
import {
  defaultSettings,
  getAll,
  getSettings,
  importBackup,
  loadBackup,
  put,
  remove,
  saveSettings
} from "./db";
import { fetchFeed } from "./rss";
import type { AppSettings, Article, BackupData, FeedSource, Note, Scrap } from "./types";
import { formatDate, hashText, issueNumber, localDateKey, nowIso, seededIndex, shortDate } from "./utils";

type View = "paper" | "sources" | "scraps" | "settings";
type FetchReport = { ok: number; failed: number; message: string };

const PAGE_SIZE = 4;
const TEMPLATES = ["front", "briefs", "scrap", "memo", "flyer"] as const;

function todayArticles(articles: Article[]): Article[] {
  const today = localDateKey();
  const fresh = articles.filter((article) => localDateKey(new Date(article.fetchedAt)) === today);
  const base = fresh.length > 0 ? fresh : articles.slice(0, 24);
  return [...base].sort((a, b) => {
    const left = new Date(a.publishedAt ?? a.fetchedAt).getTime();
    const right = new Date(b.publishedAt ?? b.fetchedAt).getTime();
    return right - left;
  });
}

function chunk<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages.length > 0 ? pages : [[]];
}

function sourceId(url: string): string {
  return hashText(url.trim().toLowerCase());
}

function pageTemplate(pageArticles: Article[], pageIndex: number): (typeof TEMPLATES)[number] {
  const seed = `${localDateKey()}-${pageIndex}-${pageArticles.map((article) => article.id).join("-")}`;
  return TEMPLATES[seededIndex(seed, TEMPLATES.length)];
}

function downloadJson(data: BackupData): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `noise-feed-backup-${localDateKey()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function readFile(file: File): Promise<BackupData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)) as BackupData);
      } catch {
        reject(new Error("JSONを読めませんでした。"));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export default function App() {
  const [view, setView] = useState<View>("paper");
  const [sources, setSources] = useState<FeedSource[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [scraps, setScraps] = useState<Scrap[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [feedInput, setFeedInput] = useState("");
  const [addStatus, setAddStatus] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [fetchReport, setFetchReport] = useState<FetchReport | null>(null);
  const [page, setPage] = useState(0);
  const [turn, setTurn] = useState<"next" | "prev" | "idle">("idle");
  const swipeStart = useRef<number | null>(null);

  useEffect(() => {
    Promise.all([
      getAll<FeedSource>("sources"),
      getAll<Article>("articles"),
      getAll<Scrap>("scraps"),
      getAll<Note>("notes"),
      getSettings()
    ]).then(([savedSources, savedArticles, savedScraps, savedNotes, savedSettings]) => {
      setSources(savedSources);
      setArticles(savedArticles);
      setScraps(savedScraps);
      setNotes(savedNotes);
      setSettings(savedSettings);
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = settings.reducedMotion ? "true" : "false";
  }, [settings.reducedMotion]);

  const paperArticles = useMemo(() => todayArticles(articles), [articles]);
  const pages = useMemo(() => chunk(paperArticles, PAGE_SIZE), [paperArticles]);
  const currentPage = Math.min(page, pages.length - 1);
  const selectedNote = selectedArticle ? notes.find((note) => note.articleId === selectedArticle.id)?.text ?? "" : "";
  const selectedScrap = selectedArticle ? scraps.some((scrap) => scrap.articleId === selectedArticle.id) : false;
  const scrapArticles = scraps
    .map((scrap) => ({ scrap, article: articles.find((article) => article.id === scrap.articleId) }))
    .filter((row): row is { scrap: Scrap; article: Article } => Boolean(row.article))
    .sort((a, b) => new Date(b.scrap.savedAt).getTime() - new Date(a.scrap.savedAt).getTime());

  async function reloadState() {
    const [nextSources, nextArticles, nextScraps, nextNotes, nextSettings] = await Promise.all([
      getAll<FeedSource>("sources"),
      getAll<Article>("articles"),
      getAll<Scrap>("scraps"),
      getAll<Note>("notes"),
      getSettings()
    ]);
    setSources(nextSources);
    setArticles(nextArticles);
    setScraps(nextScraps);
    setNotes(nextNotes);
    setSettings(nextSettings);
  }

  async function handleAddSource() {
    const url = feedInput.trim();
    if (!url) return;
    setAddStatus("ソースを検版中");
    const id = sourceId(url);
    try {
      const parsed = await fetchFeed(url, settings);
      const stampedAt = nowIso();
      const source: FeedSource = {
        id,
        title: parsed.title,
        feedUrl: url,
        siteUrl: parsed.siteUrl,
        createdAt: stampedAt,
        lastFetchedAt: stampedAt,
        status: "ok",
        statusMessage: "刻印済み"
      };
      const nextArticles = parsed.articles.map<Article>((article) => ({
        ...article,
        sourceId: id,
        sourceTitle: parsed.title,
        fetchedAt: stampedAt,
        read: articles.find((old) => old.id === article.id)?.read ?? false
      }));
      await put("sources", source);
      await Promise.all(nextArticles.map((article) => put("articles", article)));
      setSources((prev) => [...prev.filter((item) => item.id !== id), source]);
      setArticles((prev) => {
        const map = new Map(prev.map((article) => [article.id, article]));
        nextArticles.forEach((article) => map.set(article.id, article));
        return Array.from(map.values());
      });
      setFeedInput("");
      setAddStatus("刻印済み");
      window.setTimeout(() => setIsAddOpen(false), 900);
    } catch (error) {
      setAddStatus(`このソースは刻めませんでした: ${error instanceof Error ? error.message : "不明"}`);
    }
  }

  async function refreshPaper() {
    setIsRefreshing(true);
    setFetchReport(null);
    let ok = 0;
    let failed = 0;
    const nextSources: FeedSource[] = [];
    const existing = new Map(articles.map((article) => [article.id, article]));
    const stampedAt = nowIso();

    for (const source of sources) {
      try {
        const parsed = await fetchFeed(source.feedUrl, settings);
        ok += 1;
        const updatedSource = {
          ...source,
          title: parsed.title,
          siteUrl: parsed.siteUrl,
          lastFetchedAt: stampedAt,
          status: "ok" as const,
          statusMessage: "刻印済み"
        };
        nextSources.push(updatedSource);
        await put("sources", updatedSource);
        for (const item of parsed.articles) {
          const article: Article = {
            ...item,
            sourceId: source.id,
            sourceTitle: parsed.title,
            fetchedAt: stampedAt,
            read: existing.get(item.id)?.read ?? false
          };
          existing.set(article.id, article);
          await put("articles", article);
        }
      } catch (error) {
        failed += 1;
        const failedSource = {
          ...source,
          lastFetchedAt: stampedAt,
          status: "error" as const,
          statusMessage: error instanceof Error ? error.message : "不明"
        };
        nextSources.push(failedSource);
        await put("sources", failedSource);
      }
    }

    setSources(nextSources);
    setArticles(Array.from(existing.values()));
    setFetchReport({
      ok,
      failed,
      message: failed > 0 ? `${ok}件を検版、${failed}件は取得失敗。` : `${ok}件のソースを検版しました。`
    });
    setIsRefreshing(false);
    setPage(0);
  }

  async function deleteSource(source: FeedSource) {
    if (!window.confirm("このソースを紙面から削りますか？")) return;
    await remove("sources", source.id);
    const scrapIds = new Set(scraps.map((scrap) => scrap.articleId));
    const removableArticles = articles.filter((article) => article.sourceId === source.id && !scrapIds.has(article.id));
    await Promise.all(removableArticles.map((article) => remove("articles", article.id)));
    setSources((prev) => prev.filter((item) => item.id !== source.id));
    setArticles((prev) => prev.filter((article) => article.sourceId !== source.id || scrapIds.has(article.id)));
  }

  async function markRead(article: Article, read: boolean) {
    const updated = { ...article, read };
    await put("articles", updated);
    setArticles((prev) => prev.map((item) => (item.id === article.id ? updated : item)));
    setSelectedArticle(updated);
  }

  async function toggleScrap(article: Article) {
    if (scraps.some((scrap) => scrap.articleId === article.id)) {
      await remove("scraps", article.id);
      setScraps((prev) => prev.filter((scrap) => scrap.articleId !== article.id));
    } else {
      const scrap = { articleId: article.id, savedAt: nowIso(), tags: [] };
      await put("scraps", scrap);
      setScraps((prev) => [...prev, scrap]);
    }
  }

  async function saveNote(articleId: string, text: string) {
    const note = { articleId, text, updatedAt: nowIso() };
    await put("notes", note);
    setNotes((prev) => [...prev.filter((item) => item.articleId !== articleId), note]);
  }

  async function updateSettings(next: AppSettings) {
    setSettings(next);
    await saveSettings(next);
  }

  function flip(delta: number) {
    const next = Math.max(0, Math.min(pages.length - 1, currentPage + delta));
    if (next === currentPage) return;
    setTurn(delta > 0 ? "next" : "prev");
    setPage(next);
    window.setTimeout(() => setTurn("idle"), settings.reducedMotion ? 0 : 360);
  }

  return (
    <main className="app-shell">
      <header className="masthead">
        <button className="brand" onClick={() => setView("paper")} aria-label="今日の紙面へ戻る">
          <span className="brand-mark">NF</span>
          <span>
            <strong>NOISE FEED</strong>
            <small>ZINEにソースを刻む。</small>
          </span>
        </button>
        <div className="masthead-meta" aria-label="発行情報">
          <span>ISSUE #{issueNumber()}</span>
          <span>{shortDate(nowIso())}</span>
        </div>
        <nav className="top-nav" aria-label="主要画面">
          <button className={view === "paper" ? "active" : ""} onClick={() => setView("paper")}>今日の紙面</button>
          <button className={view === "sources" ? "active" : ""} onClick={() => setView("sources")}>刻まれたソース</button>
          <button className={view === "scraps" ? "active" : ""} onClick={() => setView("scraps")}>スクラップ帳</button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>設定</button>
        </nav>
      </header>

      {view === "paper" && (
        <section className={`paper-stage ${isAddOpen ? "carving" : ""}`}>
          <div className="under-carve-layer" aria-hidden={!isAddOpen}>
            <span className="tear-label">CARVE SOURCE</span>
            <h2>ZINEにソースを刻む</h2>
            <label>
              <span>RSS / Atom URLを入力</span>
              <input value={feedInput} onChange={(event) => setFeedInput(event.target.value)} inputMode="url" placeholder="https://example.com/feed.xml" />
            </label>
            <button className="ink-button" onClick={handleAddSource}>この紙面に刻む</button>
            {addStatus && <p className={addStatus === "刻印済み" ? "stamp-message" : "status-line"}>{addStatus}</p>}
          </div>

          <div
            className={`paper-sheet turn-${turn}`}
            onPointerDown={(event) => {
              swipeStart.current = event.clientX;
            }}
            onPointerUp={(event) => {
              if (swipeStart.current === null) return;
              const diff = event.clientX - swipeStart.current;
              swipeStart.current = null;
              if (Math.abs(diff) > 52) flip(diff < 0 ? 1 : -1);
            }}
          >
            <div className="issue-strip">
              <div>
                <p>今日の紙面</p>
                <h1>DAILY PERSONAL ZINE</h1>
                <span className="issue-number">{shortDate(nowIso())} / ISSUE #{issueNumber()}</span>
              </div>
              <button className="refresh-button" onClick={refreshPaper} disabled={isRefreshing}>
                {isRefreshing ? "ソースを検版中" : "紙面を更新"}
              </button>
            </div>
            {fetchReport && <p className="status-line">{fetchReport.message}</p>}

            <div className={`article-grid template-${pageTemplate(pages[currentPage], currentPage)}`}>
              {pages[currentPage].length === 0 ? (
                <div className="empty-paper">
                  <span className="empty-tape">ADD SOURCE</span>
                  <span className="empty-stamp">NO SOURCE</span>
                  <span className="empty-code">NF-UNSTAMPED / PREPRESS</span>
                  <h2>未刻印</h2>
                  <h3>この紙面にはまだ情報源が刻まれていません</h3>
                  <p>右下の「＋ ソースを刻む」からRSS / Atom URLを刻んでください。</p>
                  <dl className="empty-memo">
                    <div>
                      <dt>STATUS</dt>
                      <dd>NO FEED CARVED</dd>
                    </div>
                    <div>
                      <dt>NEXT</dt>
                      <dd>RSS / ATOM SOURCE</dd>
                    </div>
                  </dl>
                  <span className="empty-barcode" aria-hidden="true" />
                  <span className="empty-rip-note" aria-hidden="true">tear here</span>
                </div>
              ) : (
                pages[currentPage].map((article, index) => (
                  <article key={article.id} className={`paper-article slot-${index} ${article.read ? "read" : ""}`} onClick={() => setSelectedArticle(article)}>
                    <p className="source-line">{article.sourceTitle} / {formatDate(article.publishedAt)}</p>
                    <h2>{article.title}</h2>
                    <p>{article.excerpt}</p>
                    {!article.read && <span className="unread-stamp">未読</span>}
                  </article>
                ))
              )}
            </div>
            <div className="tear-mask" aria-hidden="true" />
            <div className="tear-flap tear-flap-left" aria-hidden="true" />
            <div className="tear-flap tear-flap-right" aria-hidden="true" />
            <div className="tear-shadow" aria-hidden="true" />
            <div className="page-controls">
              <button onClick={() => flip(-1)} disabled={currentPage === 0}>前の紙面</button>
              <span>{currentPage + 1} / {pages.length}</span>
              <button onClick={() => flip(1)} disabled={currentPage >= pages.length - 1}>次の紙面</button>
            </div>
          </div>

          <button className="carve-button" onClick={() => setIsAddOpen((value) => !value)}>
            ＋ ソースを刻む
          </button>
        </section>
      )}

      {view === "sources" && (
        <section className="panel-page">
          <h1>刻まれたソース</h1>
          <div className="source-list">
            {sources.map((source) => (
              <article className="source-row" key={source.id}>
                <h2>{source.title}</h2>
                <p className="url-text">{source.feedUrl}</p>
                <p className="url-text">{source.siteUrl}</p>
                <p>最終取得日時: {formatDate(source.lastFetchedAt)}</p>
                <p>取得状態: {source.status === "ok" ? "刻印済み" : source.statusMessage ?? "不明"}</p>
                <button className="danger-button" onClick={() => deleteSource(source)}>ソースを削る</button>
              </article>
            ))}
            {sources.length === 0 && <p className="status-line">刻まれたソースはまだありません。</p>}
          </div>
        </section>
      )}

      {view === "scraps" && (
        <section className="panel-page">
          <h1>スクラップ帳</h1>
          <div className="scrap-wall">
            {scrapArticles.map(({ article, scrap }) => (
              <article className="scrap-piece" key={article.id} onClick={() => setSelectedArticle(article)}>
                <p className="source-line">{article.sourceTitle} / 保存日 {formatDate(scrap.savedAt)}</p>
                <h2>{article.title}</h2>
                <p>{article.excerpt}</p>
                <p className="margin-note">{notes.find((note) => note.articleId === article.id)?.text || "余白メモなし"}</p>
              </article>
            ))}
            {scrapArticles.length === 0 && <p className="status-line">スクラップはまだありません。</p>}
          </div>
        </section>
      )}

      {view === "settings" && (
        <section className="panel-page settings-page">
          <h1>設定</h1>
          <label>
            <span>RSSプロキシURL</span>
            <input className="url-text" value={settings.proxyUrl} onChange={(event) => updateSettings({ ...settings, proxyUrl: event.target.value })} />
          </label>
          <label>
            <span>RSS取得方式</span>
            <select value={settings.fetchMode} onChange={(event) => updateSettings({ ...settings, fetchMode: event.target.value as AppSettings["fetchMode"] })}>
              <option value="proxy-first">プロキシ優先</option>
              <option value="direct-only">直接取得のみ</option>
              <option value="auto">自動</option>
            </select>
          </label>
          <label className="check-line">
            <input type="checkbox" checked={settings.reducedMotion} onChange={(event) => updateSettings({ ...settings, reducedMotion: event.target.checked })} />
            <span>reduced motion設定</span>
          </label>
          <div className="button-line">
            <button className="ink-button" onClick={() => loadBackup().then(downloadJson)}>JSONバックアップ</button>
            <label className="file-button">
              JSON復元
              <input
                type="file"
                accept="application/json"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  await importBackup(await readFile(file));
                  await reloadState();
                  event.target.value = "";
                }}
              />
            </label>
          </div>
          <p className="status-line">過去号とOPML import/exportを追加しやすいよう、記事・ソース・スクラップを分離して保存しています。</p>
        </section>
      )}

      {selectedArticle && (
        <aside className="detail-drawer" role="dialog" aria-modal="true" aria-label="記事詳細">
          <button className="close-button" onClick={() => setSelectedArticle(null)}>閉じる</button>
          <p className="source-line">購読元: {selectedArticle.sourceTitle}</p>
          <p className="source-line">公開日: {formatDate(selectedArticle.publishedAt)}</p>
          <h1>{selectedArticle.title}</h1>
          <div className="article-body" dangerouslySetInnerHTML={{ __html: selectedArticle.contentHtml || selectedArticle.excerpt }} />
          <div className="detail-actions">
            <a href={selectedArticle.url} target="_blank" rel="noreferrer">元記事を開く</a>
            <button onClick={() => markRead(selectedArticle, !selectedArticle.read)}>
              {selectedArticle.read ? "未読に戻す" : "既読にする"}
            </button>
            <button onClick={() => toggleScrap(selectedArticle)}>
              {selectedScrap ? "スクラップから外す" : "スクラップに保存"}
            </button>
          </div>
          <label className="note-box">
            <span>余白にメモ</span>
            <textarea value={selectedNote} onChange={(event) => saveNote(selectedArticle.id, event.target.value)} rows={5} />
          </label>
        </aside>
      )}
    </main>
  );
}
