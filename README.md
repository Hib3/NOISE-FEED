# NOISE FEED

ZINEにソースを刻む。毎日、自分だけの紙面をめくる。気になった記事は、スクラップ帳に残す。

NOISE FEED は GitHub Pages で動く日本語UIのスマホ向けPWAです。RSS/Atom URLを「ソース」としてIndexedDBへ保存し、Cloudflare Worker経由で取得した記事を新聞/ZINE風の「今日の紙面」に並べます。

## 構成

- `apps/pwa`: Vite + React + TypeScript のPWA本体
- `workers/rss-proxy`: Cloudflare Workers Freeで動くRSS/Atom取得プロキシ
- `.github/workflows/deploy-pages.yml`: GitHub Pages deploy
- `.github/workflows/deploy-worker.yml`: Cloudflare Workers deploy

## ローカルセットアップ

```bash
npm install
npm run dev:pwa
```

ビルド確認:

```bash
npm run build
```

PWA単体:

```bash
npm run build:pwa
```

Worker型チェック:

```bash
npm run build:worker
```

## GitHub Pages deploy

`main` ブランチへpushすると `.github/workflows/deploy-pages.yml` が `apps/pwa` をビルドし、GitHub Pagesへdeployします。

Pagesのサブパスで動くよう、workflowでは以下を指定しています。

```yaml
VITE_BASE_PATH: /NOISE-FEED/
```

公開URL想定:

```text
https://hib3.github.io/NOISE-FEED/
```

## Cloudflare Worker deploy

Worker名:

```text
noise-feed-rss-proxy
```

Worker URL:

```text
https://noise-feed-rss-proxy.hibi317.workers.dev
```

GitHub Secrets に以下を登録してください。値はコード、README、ログ、コメントに書かないでください。

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

`main` ブランチへpushすると `.github/workflows/deploy-worker.yml` が `cloudflare/wrangler-action` でdeployします。

手元からdeployする場合:

```bash
npm run deploy:worker
```

## Worker設定

`workers/rss-proxy/wrangler.toml` の `[vars]` で調整できます。

- `ALLOWED_ORIGINS`: CORS許可origin。標準は `https://hib3.github.io`
- `MAX_BYTES`: RSS/Atomレスポンス上限。標準は `1048576`
- `TIMEOUT_MS`: 取得タイムアウト。標準は `12000`
- `MAX_REDIRECTS`: リダイレクト上限。標準は `3`

エンドポイント:

```text
GET /?url=<RSS_OR_ATOM_URL>
```

制限:

- GETのみ許可
- `http` / `https` のみ許可
- `localhost` / `127.0.0.1` / `0.0.0.0` / `.local` を拒否
- private IP / link-local IPのURLリテラルを可能な範囲で拒否
- redirect回数制限、timeout、response size上限あり
- RSS/Atom/XMLらしくないレスポンスを拒否
- KV/D1/R2/APIキー/有料機能は不使用

## PWA機能

- 日本語UI、`html lang="ja"`
- スマホファースト
- PWA manifest + service worker
- IndexedDB保存
- Worker URLを設定画面で変更可能
- RSS取得方式: プロキシ優先 / 直接取得のみ / 自動
- RSS/Atom XML解析
- 取得失敗理由を日本語で表示
- 今日の紙面、左右スワイプページ送り、テンプレート式ランダムレイアウト
- スクラップ帳、余白メモ、既読/未読
- JSONバックアップ/復元
- reduced motion対応

## デザイン素材

`apps/pwa/public/assets/generated/` に後から画像生成素材を置けます。画像がなくてもCSSだけで表示できます。

想定ファイル:

- `paper-noise.png`
- `copier-grain.png`
- `torn-paper-edge.png`
- `red-tape.png`
- `stamp-approved.png`
- `ogp-noise-feed.png`

画像生成プロンプト例:

```text
白黒コピー機で複写された古いコピー紙の微細な粒状ノイズ。薄い紙のしわ、かすれ、スキャンムラ。シームレスに使える背景テクスチャ。文字やロゴは入れない。
```

```text
東京の路地裏に貼られたストリート告知ポスターの赤茶色の紙テープ。手作業で破った端、少しだけ汚れた質感。透明背景。文字なし。
```

```text
NOISE FEEDという日本語ZINEアプリのOGP用正方形画像。白黒コピー紙、黒ベタ見出し、赤茶色のスタンプ、スクラップブック風。人物イラストなし。読みやすい構図。
```

## セキュリティと注意事項

- Cloudflare API Token値をコード、README、ログ、コメントへ書かないでください。
- `.env`、`.env.*`、`*.local`、`noise-feed-worker-deploy.txt` はコミット対象外です。
- 公開CORSプロキシには依存しません。
- RSS本文HTMLはPWA側で `script`、イベント属性、危険なURLなどを除去して表示します。
- 元記事は外部リンクとして別タブで開きます。
- ブラウザのCORS制約により、通常はWorker経由取得を使ってください。

## 今後追加しやすい拡張

- OPML import/export
- 過去号の明示的な号数別アーカイブ
- スクラップのタグ編集UI
- 紙面テンプレート追加
