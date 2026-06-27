import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
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
type TearState = "idle" | "tearing" | "open" | "closing";
type FetchReport = { ok: number; failed: number; message: string };

const PAGE_SIZE = 5;
const TEAR_ANIMATION_MS = 620;
const TEMPLATES = ["ads", "punk", "tear"] as const;

function todayArticles(articles: Article[]): Article[] {
  const today = localDateKey();
  const fresh = articles.filter((article) => localDateKey(new Date(article.fetchedAt)) === today);
  const base = fresh.length > 0 ? fresh : articles.slice(0, 30);
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

function CavityForm({
  inputRef,
  feedInput,
  addStatus,
  onFeedInput,
  onSubmit,
  onClose
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  feedInput: string;
  addStatus: string;
  onFeedInput: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <form
      className="cavity-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <span className="cavity-kicker">SOURCE CUT / RSS ATOM XML</span>
      <h2>ZINEにソースを刻む</h2>
      <label>
        <span>RSS / Atom URLを入力</span>
        <input
          ref={inputRef}
          value={feedInput}
          onChange={(event) => onFeedInput(event.target.value)}
          inputMode="url"
          placeholder="https://example.com/feed.xml"
        />
      </label>
      <div className="command-row">
        <button className="black-command" type="submit">この紙面に刻む</button>
        <button className="paper-command" type="button" onClick={onClose}>閉じる</button>
      </div>
      {addStatus && <p className={addStatus === "刻印済み" ? "stamp-result" : "status-slab"}>{addStatus}</p>}
    </form>
  );
}

function TextureLayer() {
  return (
    <div className="texture-layer" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

function EmptyEdition() {
  return (
    <section className="empty-classifieds">
      <span className="image-shard image-shard-a" aria-hidden="true" />
      <span className="image-shard image-shard-b" aria-hidden="true" />
      <span className="image-shard image-shard-c" aria-hidden="true" />
      <span className="ransom-strip ransom-strip-a" aria-hidden="true" />
      <span className="ransom-strip ransom-strip-b" aria-hidden="true" />
      <span className="tape-strip tape-strip-a" aria-hidden="true" />
      <span className="tape-strip tape-strip-b" aria-hidden="true" />
      <span className="tear-scar tear-scar-a" aria-hidden="true" />
      <div className="classified classified-lead">
        <b>NO<br />SOURCE<br />CARVED</b>
        <small>検版待ち / RSS ATOM</small>
      </div>
      <div className="classified black">WRITE RIGHT NOW!</div>
      <div className="classified">FREE FEED CATALOG</div>
      <div className="classified">RSS / ATOM<br />URL ONLY</div>
      <div className="classified red">CARVE HERE</div>
      <div className="classified">NOISE<br />BULLETIN</div>
      <div className="classified copy">
        <h2>この紙面にはまだ情報源が刻まれていません</h2>
        <p>中央の赤い裂け目を開き、下層の黒い刻印台にRSS / Atom URLを入力してください。</p>
      </div>
      <span className="round-stamp">NO SOURCE</span>
    </section>
  );
}

function ArticleCut({
  article,
  index,
  onSelect
}: {
  article: Article;
  index: number;
  onSelect: (article: Article) => void;
}) {
  return (
    <article className={`article-cut cut-${index} ${article.read ? "read" : ""}`} onClick={() => onSelect(article)}>
      <p className="source-line">{article.sourceTitle} / {formatDate(article.publishedAt)}</p>
      <h2>{article.title}</h2>
      <p>{article.excerpt}</p>
      {!article.read && <span className="unread-stamp">未読</span>}
    </article>
  );
}

export default function App() {
  const [view, setView] = useState<View>("paper");
  const [sources, setSources] = useState<FeedSource[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [scraps, setScraps] = useState<Scrap[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [tearState, setTearState] = useState<TearState>("idle");
  const [feedInput, setFeedInput] = useState("");
  const [addStatus, setAddStatus] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [fetchReport, setFetchReport] = useState<FetchReport | null>(null);
  const [page, setPage] = useState(0);
  const [turn, setTurn] = useState<"next" | "prev" | "idle">("idle");
  const swipeStart = useRef<number | null>(null);
  const carveInputRef = useRef<HTMLInputElement | null>(null);

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

  useEffect(() => {
    if (tearState === "open") {
      window.setTimeout(() => carveInputRef.current?.focus(), settings.reducedMotion ? 0 : 90);
    }
  }, [settings.reducedMotion, tearState]);

  const paperArticles = useMemo(() => todayArticles(articles), [articles]);
  const pages = useMemo(() => chunk(paperArticles, PAGE_SIZE), [paperArticles]);
  const currentPage = Math.min(page, pages.length - 1);
  const currentArticles = pages[currentPage];
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

  function openTear() {
    if (tearState === "tearing" || tearState === "open") return;
    setTearState("tearing");
    window.setTimeout(() => setTearState("open"), settings.reducedMotion ? 0 : TEAR_ANIMATION_MS);
  }

  function closeTear() {
    if (tearState === "idle" || tearState === "closing") return;
    setTearState("closing");
    window.setTimeout(() => setTearState("idle"), settings.reducedMotion ? 0 : TEAR_ANIMATION_MS);
  }

  function toggleTear() {
    if (tearState === "idle" || tearState === "closing") openTear();
    else closeTear();
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
      window.setTimeout(closeTear, 950);
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
    <main className="noise-workbench">
      <header className="press-rail">
        <button className="brand-ransom" onClick={() => setView("paper")} aria-label="今日の紙面へ戻る">
          <span>NF</span>
          <strong>
            <i>NOISE</i>
            <i>FEED</i>
          </strong>
        </button>
        <p>ZINEにソースを刻む。</p>
        <div className="rail-meta">
          <span>ISSUE #{issueNumber()}</span>
          <span>{shortDate(nowIso())}</span>
        </div>
      </header>

      {view === "paper" && (
        <section className={`tear-rig tear-${tearState}`}>
          <div className="source-cavity">
            <CavityForm
              inputRef={carveInputRef}
              feedInput={feedInput}
              addStatus={addStatus}
              onFeedInput={setFeedInput}
              onSubmit={handleAddSource}
              onClose={closeTear}
            />
          </div>

          <section
            className={`edition-stack turn-${turn}`}
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
            <div className="edition-sheet">
              <div className="edition-topline">
                <span>今日の紙面</span>
                <span>{shortDate(nowIso())} / ISSUE #{issueNumber()}</span>
              </div>
              <div className="edition-title">
                <h1>SOURCE<br />CUT-UP<br />PRESS</h1>
                <button onClick={refreshPaper} disabled={isRefreshing}>{isRefreshing ? "ソースを検版中" : "紙面を更新"}</button>
              </div>
              {fetchReport && <p className="status-slab">{fetchReport.message}</p>}
              <div className={`edition-grid layout-${pageTemplate(currentArticles, currentPage)}`}>
                {currentArticles.length === 0 ? (
                  <EmptyEdition />
                ) : (
                  currentArticles.map((article, index) => (
                    <ArticleCut key={article.id} article={article} index={index} onSelect={setSelectedArticle} />
                  ))
                )}
              </div>
              <div className="page-turners">
                <button onClick={() => flip(-1)} disabled={currentPage === 0}>前の紙面</button>
                <span>{currentPage + 1} / {pages.length}</span>
                <button onClick={() => flip(1)} disabled={currentPage >= pages.length - 1}>次の紙面</button>
              </div>
              <TextureLayer />
            </div>
          </section>

          <div className="page-fragment page-fragment-pull" aria-hidden="true" />
          <div className="page-fragment page-fragment-lip" aria-hidden="true" />
          <div className="page-fragment page-fragment-fibers" aria-hidden="true" />
          <div className="ragged-mouth" aria-hidden="true" />
          <div className="cavity-shadow" aria-hidden="true" />
          <button className="tear-trigger" onClick={toggleTear}>
            <span>＋ ソースを刻む</span>
            <small>紙面を裂く</small>
          </button>
        </section>
      )}

      {view === "sources" && (
        <section className="utility-sheet">
          <h1>刻まれたソース</h1>
          {sources.length === 0 && <p className="status-slab">刻まれたソースはまだありません。</p>}
          {sources.map((source) => (
            <article className="source-row" key={source.id}>
              <h2>{source.title}</h2>
              <p className="url-text">{source.feedUrl}</p>
              <p className="url-text">{source.siteUrl}</p>
              <p>最終取得日時: {formatDate(source.lastFetchedAt)}</p>
              <p>取得状態: {source.status === "ok" ? "刻印済み" : source.statusMessage ?? "不明"}</p>
              <button className="danger-command" onClick={() => deleteSource(source)}>ソースを削る</button>
            </article>
          ))}
        </section>
      )}

      {view === "scraps" && (
        <section className="utility-sheet">
          <h1>スクラップ帳</h1>
          {scrapArticles.length === 0 && <p className="status-slab">スクラップはまだありません。</p>}
          <div className="scrap-wall">
            {scrapArticles.map(({ article, scrap }, index) => (
              <article className={`scrap-piece scrap-${index % 3}`} key={article.id} onClick={() => setSelectedArticle(article)}>
                <p className="source-line">{article.sourceTitle} / 保存日 {formatDate(scrap.savedAt)}</p>
                <h2>{article.title}</h2>
                <p>{article.excerpt}</p>
                <p className="margin-note">{notes.find((note) => note.articleId === article.id)?.text || "余白メモなし"}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      {view === "settings" && (
        <section className="utility-sheet settings-page">
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
          <div className="command-row">
            <button className="black-command" onClick={() => loadBackup().then(downloadJson)}>JSONバックアップ</button>
            <label className="file-command">
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
          <p className="status-slab">過去号とOPML import/exportを追加しやすいよう、記事・ソース・スクラップを分離して保存しています。</p>
        </section>
      )}

      <nav className="scrap-nav" aria-label="主要画面">
        <button className={view === "paper" ? "active" : ""} onClick={() => setView("paper")}>今日の紙面</button>
        <button className={view === "sources" ? "active" : ""} onClick={() => setView("sources")}>刻まれたソース</button>
        <button className={view === "scraps" ? "active" : ""} onClick={() => setView("scraps")}>スクラップ帳</button>
        <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>設定</button>
      </nav>

      {selectedArticle && (
        <aside className="article-drawer" role="dialog" aria-modal="true" aria-label="記事詳細">
          <button className="close-command" onClick={() => setSelectedArticle(null)}>閉じる</button>
          <p className="source-line">購読元: {selectedArticle.sourceTitle}</p>
          <p className="source-line">公開日: {formatDate(selectedArticle.publishedAt)}</p>
          <h1>{selectedArticle.title}</h1>
          <div className="article-body" dangerouslySetInnerHTML={{ __html: selectedArticle.contentHtml || selectedArticle.excerpt }} />
          <div className="command-row">
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
