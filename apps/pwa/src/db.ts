import type { AppSettings, Article, BackupData, FeedSource, Note, Scrap } from "./types";
import { DEFAULT_PROXY_URL } from "./utils";

const DB_NAME = "noise-feed-db";
const DB_VERSION = 1;

type StoreName = "sources" | "articles" | "scraps" | "notes" | "kv";

export const defaultSettings: AppSettings = {
  proxyUrl: DEFAULT_PROXY_URL,
  fetchMode: "proxy-first",
  reducedMotion: false
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("sources")) db.createObjectStore("sources", { keyPath: "id" });
      if (!db.objectStoreNames.contains("articles")) db.createObjectStore("articles", { keyPath: "id" });
      if (!db.objectStoreNames.contains("scraps")) db.createObjectStore("scraps", { keyPath: "articleId" });
      if (!db.objectStoreNames.contains("notes")) db.createObjectStore("notes", { keyPath: "articleId" });
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function tx<T>(storeName: StoreName, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = run(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export function getAll<T>(store: StoreName): Promise<T[]> {
  return tx<T[]>(store, "readonly", (objectStore) => objectStore.getAll() as IDBRequest<T[]>);
}

export function put<T>(store: StoreName, value: T): Promise<IDBValidKey> {
  return tx<IDBValidKey>(store, "readwrite", (objectStore) => objectStore.put(value));
}

export function remove(store: StoreName, key: IDBValidKey): Promise<undefined> {
  return tx<undefined>(store, "readwrite", (objectStore) => objectStore.delete(key) as IDBRequest<undefined>);
}

export async function getSettings(): Promise<AppSettings> {
  const rows = await getAll<{ key: string; value: AppSettings }>("kv");
  return { ...defaultSettings, ...(rows.find((row) => row.key === "settings")?.value ?? {}) };
}

export function saveSettings(settings: AppSettings): Promise<IDBValidKey> {
  return put("kv", { key: "settings", value: settings });
}

export async function loadBackup(): Promise<BackupData> {
  const [settings, sources, articles, scraps, notes] = await Promise.all([
    getSettings(),
    getAll<FeedSource>("sources"),
    getAll<Article>("articles"),
    getAll<Scrap>("scraps"),
    getAll<Note>("notes")
  ]);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    sources,
    articles,
    scraps,
    notes
  };
}

export async function importBackup(data: BackupData): Promise<void> {
  if (data.version !== 1) throw new Error("対応していないバックアップ形式です。");
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(["sources", "articles", "scraps", "notes", "kv"], "readwrite");
    for (const name of ["sources", "articles", "scraps", "notes", "kv"] as StoreName[]) {
      transaction.objectStore(name).clear();
    }
    transaction.objectStore("kv").put({ key: "settings", value: { ...defaultSettings, ...data.settings } });
    data.sources.forEach((item) => transaction.objectStore("sources").put(item));
    data.articles.forEach((item) => transaction.objectStore("articles").put(item));
    data.scraps.forEach((item) => transaction.objectStore("scraps").put(item));
    data.notes.forEach((item) => transaction.objectStore("notes").put(item));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}
