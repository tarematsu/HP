/**
 * Isolated Spotify OAuth PKCE feasibility probe.
 * Deploy as a SEPARATE Worker behind Cloudflare Access, never as a public Pages route.
 * Required: SPOTIFY_CLIENT_ID (an app you own), REDIRECT_URI (registered callback).
 * Does NOT modify the production Charts collector or persist credentials.
 */
const html = (message, status = 200) => new Response(
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Spotify OAuth probe</title><main style="font:16px system-ui;max-width:40rem;margin:3rem auto;padding:1rem"><h1>Spotify OAuth probe</h1><p>' +
  message + '</p></main>',
  { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" } }
);
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = () => b64(crypto.getRandomValues(new Uint8Array(32)));
const encode = new TextEncoder();
const cookie = (name, value, age) => name + '=' + encodeURIComponent(value) + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + age;
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!env.SPOTIFY_CLIENT_ID || !env.REDIRECT_URI || new URL(env.REDIRECT_URI).origin !== url.origin ||
        new URL(env.REDIRECT_URI).pathname !== '/callback') return html('Configuration error: register this Worker /callback URI in your Spotify app.', 503);
    if (url.pathname === '/') return html('<a href="/start">Authorize with Spotify</a><p>This proof of concept does not save credentials.</p>');
    if (url.pathname === '/start') {
      const state = random(), verifier = random();
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encode.encode(verifier)));
      const authorize = new URL('https://accounts.spotify.com/authorize');
      for (const [k, v] of Object.entries({ response_type:'code', client_id:env.SPOTIFY_CLIENT_ID,
        redirect_uri:env.REDIRECT_URI, code_challenge_method:'S256', code_challenge:b64(digest),
        state, scope:'user-read-private' })) authorize.searchParams.set(k, v);
      const response = Response.redirect(authorize, 302);
      response.headers.append('set-cookie', cookie('oauth_state', state, 600));
      response.headers.append('set-cookie', cookie('oauth_verifier', verifier, 600));
      response.headers.set('cache-control', 'no-store');
      return response;
    }
    if (url.pathname !== '/callback') return html('Not found', 404);
    const cookies = Object.fromEntries((request.headers.get('cookie') || '').split(';').map(p => p.trim().split('=').map(decodeURIComponent)).filter(p => p.length === 2));
    const responseHeaders = new Headers();
    responseHeaders.append('set-cookie', cookie('oauth_state', '', 0));
    responseHeaders.append('set-cookie', cookie('oauth_verifier', '', 0));
    const respond = (msg, status) => { const r = html(msg, status); responseHeaders.forEach((v,k)=>r.headers.append(k,v)); return r; };
    if (!cookies.oauth_state || !cookies.oauth_verifier || cookies.oauth_state !== url.searchParams.get('state') ||
        !url.searchParams.get('code') || url.searchParams.has('error')) return respond('Authorization failed or expired.', 400);
    const token = await fetch('https://accounts.spotify.com/api/token', {
      method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({grant_type:'authorization_code',code:url.searchParams.get('code'),
        redirect_uri:env.REDIRECT_URI,client_id:env.SPOTIFY_CLIENT_ID,code_verifier:cookies.oauth_verifier})
    });
    if (!token.ok) return respond('Token exchange failed (HTTP ' + token.status + ').', 502);
    const data = await token.json();
    if (!data.access_token) return respond('No access token returned.', 502);
    // Probe only official Web API: do not send this token to undocumented Charts endpoints.
    const probe = await fetch('https://api.spotify.com/v1/me', {headers:{authorization:'Bearer '+data.access_token}});
    return respond('OAuth exchange succeeded. Official Web API /v1/me HTTP ' + probe.status +
      '. No token was saved. This does NOT prove compatibility with Spotify Charts.', probe.ok ? 200 : 502);
  }
};
