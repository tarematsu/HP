# Mobile Spotify OAuth feasibility experiment

This is an **isolated, non-production** Cloudflare Worker proof of concept. It does not replace the Spotify Charts authentication workflow.

## Deploy and test

1. Create or use a Spotify Developer app you control. Register the exact HTTPS redirect URI `https://<your-protected-worker-host>/callback` in its Spotify dashboard.
2. Deploy `worker.mjs` as a **separate Worker** protected by Cloudflare Access. Set `SPOTIFY_CLIENT_ID` and `REDIRECT_URI` as Worker environment variables. Do not publish this endpoint without access controls.
3. On Android Firefox, visit the protected Worker URL and tap **Authorize with Spotify**.
4. After approval, the callback exchanges the code server-side using PKCE and calls the **official** `/v1/me` endpoint. The page reports success/failure, never outputs tokens.
5. No access/refresh tokens are saved. The production Charts collector remains unchanged.

## Findings / limitations

- Existing playback OAuth tokens and app client credentials are not interchangeable with the Spotify Charts site's own client.
- The Spotify Charts site's redirect URI is not under our control. A callback hosted by us cannot be substituted for that client.
- A successful official Web API probe **does not demonstrate** that the undocumented Charts API accepts this token.
- The callback is a one-time functional prototype, not a production authentication system. Before production use, implement durable session binding, one-time state consumption, deployment configuration, access controls, monitoring, and encrypted token persistence.
- Do not paste Spotify session cookies or refresh tokens into issues, logs, or chat.

## Acceptance

The experiment is successful only when the OAuth callback completes on a phone and the official `/v1/me` check returns HTTP 200. Charts compatibility remains a separate unresolved question.
