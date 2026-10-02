#!/usr/bin/env python3
"""Exchange a one-time Spotify web session cookie for a PKCE refresh token."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import secrets
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from curl_cffi import requests

CLIENT_ID = "44407c71b3b24071865aaa4fea948a15"
REDIRECT_URI = "https://charts.spotify.com"
AUTH_URL = "https://accounts.spotify.com/oauth2/v2/auth"
TOKEN_URL = "https://accounts.spotify.com/api/token"
SCOPES = "user-read-email user-read-private ugc-image-upload"


def pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)[:128]
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def exchange(sp_dc: str) -> str:
    session = requests.Session(impersonate="chrome")
    session.cookies.set("sp_dc", sp_dc, domain=".spotify.com", path="/")
    verifier, challenge = pkce_pair()
    state = secrets.token_urlsafe(18)
    response = session.get(
        AUTH_URL,
        params={
            "client_id": CLIENT_ID,
            "response_type": "code",
            "redirect_uri": REDIRECT_URI,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "scope": SCOPES,
            "state": state,
            "prompt": "none",
        },
        allow_redirects=False,
        timeout=30,
    )
    if response.status_code not in (302, 303):
        raise RuntimeError(f"Spotify auth returned HTTP {response.status_code}")
    query = parse_qs(urlparse(response.headers.get("location", "")).query)
    if (query.get("state") or [state])[0] != state:
        raise RuntimeError("Spotify auth state mismatch")
    error = (query.get("error") or [""])[0]
    if error:
        raise RuntimeError(f"Spotify auth failed: {error}")
    code = (query.get("code") or [""])[0]
    if not code:
        raise RuntimeError("Spotify auth redirect did not contain a code")

    token_response = session.post(
        TOKEN_URL,
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "client_id": CLIENT_ID,
            "code_verifier": verifier,
        },
        timeout=30,
    )
    data = token_response.json()
    if token_response.status_code != 200:
        raise RuntimeError(f"Spotify token exchange failed: {data.get('error') or token_response.status_code}")
    refresh_token = str(data.get("refresh_token") or "").strip()
    if not refresh_token:
        raise RuntimeError("Spotify token response did not contain refresh_token")
    return refresh_token


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    sp_dc = os.environ.get("SPOTIFY_CHARTS_SP_DC", "").strip()
    if not sp_dc:
        raise RuntimeError("SPOTIFY_CHARTS_SP_DC is not configured")
    refresh_token = exchange(sp_dc)
    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(refresh_token, encoding="utf-8")
    temporary.replace(path)
    print(json.dumps({"ok": True, "event": "spotify_charts_refresh_token_bootstrapped"}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(json.dumps({
            "ok": False,
            "event": "spotify_charts_refresh_token_bootstrap_failed",
            "error": str(error),
        }), file=sys.stderr)
        raise SystemExit(1)
