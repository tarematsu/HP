# HomePanel Cloud

HomePanel 用の Cloudflare Workers / D1 構成です。  
このディレクトリには公開可能なテンプレートだけを置き、環境固有の値は外に出します。

## 先に変更する項目

- `wrangler.jsonc` の `name`
- `wrangler.jsonc` の `d1_databases[0].database_name`
- GitHub / Cloudflare 側の Secrets と Variables

`database_id` はゼロ UUID のままで構いません。デプロイスクリプトは次の順で実 ID を解決します。

1. `HOMEPANEL_D1_DATABASE_ID` または `D1_DATABASE_ID`
2. `wrangler.jsonc` の実 UUID
3. `wrangler d1 list --json` で見つかった一致名

## Cloudflare Variables

```text
CITY_NAME
WEATHERNEWS_URL
STATIONHEAD_MONITOR_URL
HOMEPANEL_PUBLIC_URL
HOMEPANEL_PRIMARY_DEVICE_ID
RADAR_CENTER_LAT
RADAR_CENTER_LON
RADAR_ZOOM
SWITCHBOT_CONTROL_PLUG_IDS
SWITCHBOT_EXIT_CONFIRM_SECONDS
SWITCHBOT_FALLBACK_POLL_SECONDS
UPDATE_BUCKET_PREFIX
```

## Cloudflare Secrets

```text
HOMEPANEL_INGEST_SECRET
HOMEPANEL_DEVICE_TOKENS
API_TOKEN
DEVICE_TOKEN
SWITCHBOT_TOKEN
SWITCHBOT_SECRET
OCTOPUS_EMAIL
OCTOPUS_PASSWORD
OCTOPUS_ACCOUNT_NUMBER
UPDATE_SIGNING_SECRET
SPOTIFY_CLIENT_ID
SPOTIFY_CLIENT_SECRET
SPOTIFY_REDIRECT_URI
SPOTIFY_TOKEN_ENCRYPTION_KEY
```

## R2

- Cloudflare Dashboard で最初に R2 を有効化
- 既定の更新配信用バケット名は `homepanel-updates`
- GitHub Variables に `HOMEPANEL_UPDATE_BUCKET` を設定
- ワーカーは `updates/latest/update-manifest.json` を読み、実ファイルは `updates/releases/<yymmddhhmm>/` から配信

## ローカル検証

```powershell
cd cloud
npm install --no-audit --no-fund
npm run check
npm test
npm run migrate:local
```

## GitHub Actions 側で必要なもの

- Secret: `CLOUDFLARE_API_TOKEN`
- Secret: `HOMEPANEL_D1_DATABASE_ID`
- Secret: `CLOUDFLARE_BUILDS_API_TOKEN`
- Variable: `HOMEPANEL_UPDATE_BUCKET`

`CLOUDFLARE_ACCOUNT_ID` は、トークンから参照できるアカウントが1つだけなら自動解決されます。複数アカウントが見えるトークンを使う場合だけ、追加で `CLOUDFLARE_ACCOUNT_ID` を設定してください。

## 公開チェック

- 実 URL、実メールアドレス、実アカウント ID をコミットしない
- `.env`、`.dev.vars`、ローカル DB、ログを Git に含めない
- Secrets は設定画面だけに置く
