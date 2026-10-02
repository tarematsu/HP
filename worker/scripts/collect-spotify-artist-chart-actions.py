#!/usr/bin/env python3
"""Fetch Spotify Japan Daily Top Artist without a native browser.

The Charts web app requires an authenticated Spotify web session. This script
uses the same OAuth2 PKCE flow as charts.spotify.com, seeded only by an sp_dc
cookie supplied through the environment. It emits the normalized capture shape
already consumed by this repository's Spotify artist-chart pipeline.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import secrets
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from curl_cffi import requests

CLIENT_ID = "44407c71b3b24071865aaa4fea948a15"
REDIRECT_URI = "https://charts.spotify.com"
AUTH_URL = "https://accounts.spotify.com/oauth2/v2/auth"
TOKEN_URL = "https://accounts.spotify.com/api/token"
CHART_URL = "https://charts-spotify-com-service.spotify.com/auth/v0/charts/artist-jp-daily/latest"
SCOPES = "user-read-email user-read-private ugc-image-upload"
CHART_ID = "artist-jp-daily"
MIN_ENTRIES = 50
MAX_ENTRIES = 200
MAX_RESPONSE_BYTES = 512 * 1024
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ARTIST_URI_PREFIX = "spotify:artist:"


class CollectorError(RuntimeError):
    pass


def pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)[:128]
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def authenticated_session(sp_dc: str) -> tuple[requests.Session, str]:
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
        raise CollectorError(f"Spotify Charts auth returned HTTP {response.status_code}")
    location = response.headers.get("location", "")
    query = parse_qs(urlparse(location).query)
    if (query.get("state", [state])[0] != state):
        raise CollectorError("Spotify Charts auth state mismatch")
    error = (query.get("error") or [""])[0]
    if error:
        if error == "login_required":
            raise CollectorError("SPOTIFY_CHARTS_SP_DC is expired or invalid (login_required)")
        raise CollectorError(f"Spotify Charts auth failed: {error}")
    code = (query.get("code") or [""])[0]
    if not code:
        raise CollectorError("Spotify Charts auth redirect did not contain a code")

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
    if token_response.status_code != 200:
        raise CollectorError(f"Spotify Charts token exchange returned HTTP {token_response.status_code}")
    token = str(token_response.json().get("access_token") or "").strip()
    if not token:
        raise CollectorError("Spotify Charts token response did not contain an access token")
    return session, token


def optional_int(value: Any, minimum: int, maximum: int) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    if str(value).strip() not in {str(number), f"{number}.0"} and not isinstance(value, int):
        try:
            if float(value) != number:
                return None
        except (TypeError, ValueError):
            return None
    return number if minimum <= number <= maximum else None


def artist_id_from_uri(value: Any) -> str:
    uri = str(value or "").strip()
    if ARTIST_URI_PREFIX in uri:
        artist_id = uri.split(ARTIST_URI_PREFIX, 1)[1].split("?", 1)[0].split("#", 1)[0]
    elif "/artist/" in uri:
        artist_id = uri.split("/artist/", 1)[1].split("/", 1)[0].split("?", 1)[0].split("#", 1)[0]
    else:
        return ""
    return artist_id[:80]


def find_chart_date(payload: Any) -> str:
    if isinstance(payload, dict):
        for key in ("chartDate", "displayDate", "latestDate", "date"):
            value = str(payload.get(key) or "")[:10]
            if DATE_RE.fullmatch(value):
                return value
        for value in payload.values():
            found = find_chart_date(value)
            if found:
                return found
    elif isinstance(payload, list):
        for value in payload:
            found = find_chart_date(value)
            if found:
                return found
    elif isinstance(payload, str):
        match = re.search(r"\b\d{4}-\d{2}-\d{2}\b", payload)
        if match:
            return match.group(0)
    return ""


def normalized_capture(payload: dict[str, Any], observed_at: int) -> dict[str, Any]:
    raw_entries = payload.get("entries")
    if not isinstance(raw_entries, list):
        raise CollectorError("Spotify artist chart response has no entries array")

    entries: list[dict[str, Any]] = []
    for raw in raw_entries[:MAX_ENTRIES]:
        if not isinstance(raw, dict):
            continue
        chart = raw.get("chartEntryData")
        if not isinstance(chart, dict):
            continue
        rank = optional_int(chart.get("currentRank"), 1, 200)
        if rank is None:
            continue
        metadata = next(
            (raw.get(key) for key in ("artistMetadata", "metadata", "trackMetadata") if isinstance(raw.get(key), dict)),
            None,
        )
        if not isinstance(metadata, dict):
            continue
        artist_name = str(metadata.get("artistName") or metadata.get("name") or metadata.get("displayName") or "").strip()[:240]
        if not artist_name:
            continue
        artist_id = artist_id_from_uri(metadata.get("artistUri") or metadata.get("uri"))
        row: dict[str, Any] = {"rank": rank, "artist_name": artist_name}
        if artist_id:
            row["artist_id"] = artist_id
        previous_rank = optional_int(chart.get("previousRank"), 1, 200)
        peak_rank = optional_int(chart.get("peakRank"), 1, 200)
        streak = optional_int(chart.get("consecutiveAppearancesOnChart"), 0, 100_000)
        if streak is None:
            streak = optional_int(chart.get("appearancesOnChart"), 0, 100_000)
        if previous_rank is not None:
            row["previous_rank"] = previous_rank
        if peak_rank is not None:
            row["peak_rank"] = peak_rank
        if streak is not None:
            row["streak"] = streak
        entries.append(row)

    if len(entries) < MIN_ENTRIES:
        raise CollectorError(f"Spotify artist chart normalized only {len(entries)} entries")
    chart_date = find_chart_date(payload)
    if not chart_date:
        raise CollectorError("Spotify artist chart response did not contain a chart date")
    jst_today = (datetime.now(timezone.utc) + timedelta(hours=9)).date()
    if chart_date < (jst_today - timedelta(days=1)).isoformat():
        raise CollectorError(f"Spotify artist chart is stale: {chart_date}")

    return {
        "version": 1,
        "chart_id": CHART_ID,
        "chart_date": chart_date,
        "observed_at": observed_at,
        "received_at": observed_at,
        "entry_count": len(entries),
        "source": "spotify-charts-actions",
        "entries": entries,
    }


def fetch_chart(sp_dc: str) -> dict[str, Any]:
    session, token = authenticated_session(sp_dc)
    response = session.get(
        CHART_URL,
        headers={
            "authorization": f"Bearer {token}",
            "accept": "application/json",
            "accept-language": "ja-JP,ja;q=0.9,en;q=0.7",
            "origin": "https://charts.spotify.com",
            "referer": "https://charts.spotify.com/",
        },
        timeout=30,
    )
    if response.status_code != 200:
        raise CollectorError(f"Spotify artist chart returned HTTP {response.status_code}")
    if len(response.content) > MAX_RESPONSE_BYTES:
        raise CollectorError("Spotify artist chart response exceeded 512 KiB")
    payload = response.json()
    if not isinstance(payload, dict):
        raise CollectorError("Spotify artist chart response was not an object")
    return normalized_capture(payload, int(time.time() * 1000))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    sp_dc = os.environ.get("SPOTIFY_CHARTS_SP_DC", "").strip()
    if not sp_dc:
        raise CollectorError("SPOTIFY_CHARTS_SP_DC is not configured")
    capture = fetch_chart(sp_dc)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.write_text(json.dumps(capture, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    temporary.replace(output)
    print(json.dumps({
        "ok": True,
        "event": "spotify_artist_chart_fetched",
        "chart_date": capture["chart_date"],
        "entry_count": capture["entry_count"],
        "source": capture["source"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except CollectorError as error:
        print(json.dumps({"ok": False, "event": "spotify_artist_chart_fetch_failed", "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
