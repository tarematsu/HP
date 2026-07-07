# HomePanel

このリポジトリは HomePanel の単一リポジトリ構成です。

- `cloud/`
  Cloudflare Workers / D1 側
- `native/`
  Windows ネイティブアプリ側

## 方針

- 実運用のトークン、鍵、URL、アカウント ID はコミットしません
- Cloud 側の設定は Cloudflare / GitHub の Secrets と Variables で管理します
- Native 側の更新は端末認証付きの Cloudflare update endpoint 経由で配布されます

## Cloud 開発

```powershell
cd cloud
npm install --no-audit --no-fund
npm run check
npm test
```

## Native 開発

```powershell
cmake -S native -B native/build-ci -G "Visual Studio 17 2022" -A x64
cmake --build native/build-ci --config Release --parallel
```

Cloud 側の設定は [cloud/README.md](/C:/HomePanel/cloud/README.md) を参照してください。
