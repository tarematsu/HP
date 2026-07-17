#!/usr/bin/env python3
"""Build recent JMA radar frames for HomePanel and emit an R2 publish plan."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image

TARGET_TIMES_URL = "https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json"
GSI_TILE_URL = "https://cyberjapandata.gsi.go.jp/xyz/pale/{zoom}/{x}/{y}.png"
JMA_TILE_URL = (
    "https://www.jma.go.jp/bosai/jmatile/data/nowc/"
    "{base_time}/none/{valid_time}/surf/hrpns/{zoom}/{x}/{y}.png"
)
USER_AGENT = "HomePanel-Radar-GitHub-Actions/1.0"
SOURCE_WIDTH = 480
SOURCE_HEIGHT = 320
OUTPUT_WIDTH = 1920
OUTPUT_HEIGHT = 1280
HISTORY_WINDOW_MS = 60 * 60 * 1000
OBJECT_RETENTION_MS = 3 * 60 * 60 * 1000
FRAME_INTERVAL_MS = 5 * 1000
RENDER_VERSION = "gha-v1"
FRAME_PREFIX = "radar/frames/"


@dataclass(frozen=True)
class TimeEntry:
    base_time: str
    valid_time: str
    valid_at: int


@dataclass(frozen=True)
class Tile:
    x: int
    y: int
    dest_x: int
    dest_y: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--existing-manifest", type=Path)
    parser.add_argument("--center-lat", type=float, default=35.8923181)
    parser.add_argument("--center-lon", type=float, default=139.4858691)
    parser.add_argument("--zoom", type=int, default=10)
    return parser.parse_args()


def fetch_bytes(url: str, *, attempts: int = 3) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.read()
        except (OSError, urllib.error.URLError, urllib.error.HTTPError) as error:
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"failed to fetch {url}: {last_error}")


def fetch_json(url: str) -> Any:
    return json.loads(fetch_bytes(url).decode("utf-8"))


def jma_timestamp_ms(value: str) -> int:
    if len(value) != 14 or not value.isdigit():
        return 0
    parsed = datetime.strptime(value, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    return int(parsed.timestamp() * 1000)


def load_entries() -> list[TimeEntry]:
    raw = fetch_json(TARGET_TIMES_URL)
    if not isinstance(raw, list):
        raise RuntimeError("JMA target-times response is not an array")

    entries: list[TimeEntry] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        elements = item.get("elements")
        base_time = item.get("basetime")
        valid_time = item.get("validtime")
        if not isinstance(elements, list) or "hrpns" not in elements:
            continue
        if not isinstance(base_time, str) or not isinstance(valid_time, str):
            continue
        valid_at = jma_timestamp_ms(valid_time)
        if valid_at:
            entries.append(TimeEntry(base_time, valid_time, valid_at))

    entries.sort(key=lambda entry: entry.valid_at)
    if not entries:
        raise RuntimeError("JMA nowcast contains no hrpns frames")
    latest_at = entries[-1].valid_at
    return [
        entry
        for entry in entries
        if latest_at - HISTORY_WINDOW_MS <= entry.valid_at <= latest_at
    ]


def tile_layout(lat: float, lon: float, zoom: int) -> list[Tile]:
    scale = 2**zoom
    world_x = (lon + 180.0) / 360.0 * scale * 256.0
    latitude = max(-85.05112878, min(85.05112878, lat)) * math.pi / 180.0
    world_y = (1.0 - math.asinh(math.tan(latitude)) / math.pi) / 2.0 * scale * 256.0
    left = world_x - SOURCE_WIDTH / 2.0
    top = world_y - SOURCE_HEIGHT / 2.0
    min_x = math.floor(left / 256.0)
    max_x = math.floor((left + SOURCE_WIDTH - 1) / 256.0)
    min_y = math.floor(top / 256.0)
    max_y = math.floor((top + SOURCE_HEIGHT - 1) / 256.0)
    return [
        Tile(x=x, y=y, dest_x=round(x * 256 - left), dest_y=round(y * 256 - top))
        for y in range(min_y, max_y + 1)
        for x in range(min_x, max_x + 1)
    ]


def decode_png(data: bytes) -> Image.Image:
    with Image.open(io.BytesIO(data)) as image:
        return image.convert("RGBA")


def fetch_tiles(urls: list[str]) -> list[Image.Image]:
    with ThreadPoolExecutor(max_workers=min(8, len(urls))) as executor:
        return list(executor.map(lambda url: decode_png(fetch_bytes(url)), urls))


def render_frame(
    entry: TimeEntry,
    layout: list[Tile],
    map_tiles: list[Image.Image],
    zoom: int,
    output: Path,
) -> None:
    canvas = Image.new("RGBA", (SOURCE_WIDTH, SOURCE_HEIGHT), (245, 245, 245, 255))
    for tile, image in zip(layout, map_tiles, strict=True):
        canvas.paste(image, (tile.dest_x, tile.dest_y))

    radar_urls = [
        JMA_TILE_URL.format(
            base_time=entry.base_time,
            valid_time=entry.valid_time,
            zoom=zoom,
            x=tile.x,
            y=tile.y,
        )
        for tile in layout
    ]
    radar_tiles = fetch_tiles(radar_urls)
    for tile, image in zip(layout, radar_tiles, strict=True):
        canvas.alpha_composite(image, (tile.dest_x, tile.dest_y))

    resized = canvas.resize((OUTPUT_WIDTH, OUTPUT_HEIGHT), Image.Resampling.LANCZOS)
    output.parent.mkdir(parents=True, exist_ok=True)
    resized.convert("RGB").save(
        output,
        format="WEBP",
        quality=80,
        method=6,
        lossless=False,
    )


def load_existing_manifest(path: Path | None) -> dict[str, Any]:
    if path is None or not path.is_file():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def valid_existing_objects(manifest: dict[str, Any]) -> dict[str, dict[str, Any]]:
    raw = manifest.get("objects")
    if not isinstance(raw, list):
        raw = manifest.get("frames")
    result: dict[str, dict[str, Any]] = {}
    if not isinstance(raw, list):
        return result
    for item in raw:
        if not isinstance(item, dict):
            continue
        key = item.get("key")
        valid_at = item.get("validAt")
        if isinstance(key, str) and isinstance(valid_at, int):
            result[key] = item
    return result


def variant_for(lat: float, lon: float, zoom: int) -> str:
    material = (
        f"{RENDER_VERSION}|{lat:.7f}|{lon:.7f}|{zoom}|"
        f"{SOURCE_WIDTH}x{SOURCE_HEIGHT}|{OUTPUT_WIDTH}x{OUTPUT_HEIGHT}"
    )
    digest = hashlib.sha256(material.encode("utf-8")).hexdigest()[:16]
    return f"{RENDER_VERSION}-{digest}"


def frame_record(entry: TimeEntry, variant: str) -> dict[str, Any]:
    key = f"{FRAME_PREFIX}{variant}/{entry.valid_time}.webp"
    return {
        "baseTime": entry.base_time,
        "validTime": entry.valid_time,
        "validAt": entry.valid_at,
        "variant": variant,
        "key": key,
        "url": f"/v1/radar/frame/{variant}/{entry.valid_time}.webp",
    }


def write_lines(path: Path, rows: list[tuple[str, ...]]) -> None:
    text = "".join("\t".join(row) + "\n" for row in rows)
    path.write_text(text, encoding="utf-8")


def main() -> int:
    args = parse_args()
    if not (-85.05112878 <= args.center_lat <= 85.05112878):
        raise RuntimeError("center latitude is out of range")
    if not (-180.0 <= args.center_lon <= 180.0):
        raise RuntimeError("center longitude is out of range")
    if not (4 <= args.zoom <= 14):
        raise RuntimeError("zoom must be between 4 and 14")

    output_dir: Path = args.output_dir
    frames_dir = output_dir / "frames"
    output_dir.mkdir(parents=True, exist_ok=True)

    entries = load_entries()
    layout = tile_layout(args.center_lat, args.center_lon, args.zoom)
    variant = variant_for(args.center_lat, args.center_lon, args.zoom)
    existing_manifest = load_existing_manifest(args.existing_manifest)
    existing_objects = valid_existing_objects(existing_manifest)

    map_urls = [
        GSI_TILE_URL.format(zoom=args.zoom, x=tile.x, y=tile.y)
        for tile in layout
    ]
    map_tiles: list[Image.Image] | None = None
    uploads: list[tuple[str, str]] = []
    current_records = [frame_record(entry, variant) for entry in entries]

    for entry, record in zip(entries, current_records, strict=True):
        key = record["key"]
        if key in existing_objects:
            continue
        if map_tiles is None:
            map_tiles = fetch_tiles(map_urls)
        local_path = frames_dir / f"{entry.valid_time}.webp"
        render_frame(entry, layout, map_tiles, args.zoom, local_path)
        uploads.append((str(local_path), key))

    latest_at = entries[-1].valid_at
    retention_cutoff = latest_at - OBJECT_RETENTION_MS
    retained_objects = {
        key: item
        for key, item in existing_objects.items()
        if item.get("validAt", 0) >= retention_cutoff
    }
    for record in current_records:
        retained_objects[record["key"]] = record

    stale_keys = sorted(set(existing_objects) - set(retained_objects))
    manifest = {
        "version": 1,
        "renderVersion": RENDER_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "provider": "JMA radar rendered by GitHub Actions and cached in Cloudflare R2",
        "width": 256,
        "height": 256,
        "outputWidth": OUTPUT_WIDTH,
        "outputHeight": OUTPUT_HEIGHT,
        "center": {"lat": args.center_lat, "lon": args.center_lon},
        "zoom": args.zoom,
        "historyWindowMs": HISTORY_WINDOW_MS,
        "frameIntervalMs": FRAME_INTERVAL_MS,
        "playbackRate": 1,
        "frames": current_records,
        "objects": sorted(
            retained_objects.values(),
            key=lambda item: (item.get("validAt", 0), item.get("key", "")),
        ),
        "legend": [0, 1, 2, 4, 8, 16, 32, 64],
    }

    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    write_lines(output_dir / "uploads.tsv", uploads)
    write_lines(output_dir / "deletes.tsv", [(key,) for key in stale_keys])

    print(
        f"radar frames={len(current_records)} uploads={len(uploads)} "
        f"deletes={len(stale_keys)} variant={variant}"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"radar build failed: {error}", file=sys.stderr)
        raise
