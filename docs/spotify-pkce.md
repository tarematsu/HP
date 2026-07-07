# Spotify PKCE 設定

Spotify の Redirect URI には、自分の Worker URL に合わせたコールバックを登録します。

```text
https://<your-worker-domain>/v1/spotify/callback
```

`SPOTIFY_CLIENT_ID`、`SPOTIFY_CLIENT_SECRET`、`SPOTIFY_REDIRECT_URI` はリポジトリに書かず、Cloudflare の設定画面で管理してください。
