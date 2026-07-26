#!/usr/bin/env python3
"""Build missing minute facts locally from a scoped buddies D1 export."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import time
from pathlib import Path


MINUTE_MS = 60_000
MAX_CARRY_MINUTES = 5
MAX_UPLOAD_BYTES = 90_000

QUEUE_MISSING = 2
COMMENTS_DEGRADED = 32
DELAYED_PAYLOAD = 128
OFFLINE = 256
LEGACY_QUALITY_REDUCED = 1024


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--buddies-export", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--recent-guard-ms", type=int, default=300_000)
    parser.add_argument("--now-ms", type=int, default=None)
    return parser.parse_args()


def execute_dump(connection: sqlite3.Connection, path: Path) -> int:
    statements = 0
    buffer = ""
    with path.open("r", encoding="utf-8") as source:
        for line in source:
            buffer += line
            if not sqlite3.complete_statement(buffer):
                continue
            statement = buffer.strip()
            buffer = ""
            if not statement or statement in {"BEGIN TRANSACTION;", "COMMIT;"}:
                continue
            connection.executescript(statement)
            statements += 1
    if buffer.strip():
        connection.executescript(buffer)
        statements += 1
    connection.commit()
    return statements


def integer(value: object) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def boolean(value: object) -> int | None:
    if value is None:
        return None
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"false", "0", "no", "off", ""}:
            return 0
        if normalized in {"true", "1", "yes", "on"}:
            return 1
    parsed = integer(value)
    return None if parsed is None else int(parsed != 0)


def literal(value: object) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def minute_bucket(value: int) -> int:
    return value // MINUTE_MS * MINUTE_MS


def compact_snapshot(row: sqlite3.Row) -> dict[str, object]:
    return {
        "id": integer(row["id"]),
        "observed_at": integer(row["observed_at"]),
        "channel_id": integer(row["channel_id"]),
        "station_id": integer(row["station_id"]),
        "is_broadcasting": boolean(row["is_broadcasting"]),
        "listener_count": integer(row["listener_count"]),
        "online_member_count": integer(row["online_member_count"]),
        "total_member_count": integer(row["total_member_count"]),
        "guest_count": integer(row["guest_count"]),
        "total_listens": integer(row["total_listens"]),
        "current_stream_count": integer(row["current_stream_count"]),
        "broadcast_start_time": integer(row["broadcast_start_time"]),
    }


def candidate(row: dict[str, object], minute_at: int, mode: str) -> dict[str, object]:
    observed_at = integer(row["observed_at"]) if mode == "exact" else minute_at + 30_000
    return {
        "minute_at": minute_at,
        "observed_at": observed_at,
        "mode": mode,
        "snapshot": row,
    }


def build_candidates(connection: sqlite3.Connection, cutoff: int) -> list[dict[str, object]]:
    connection.row_factory = sqlite3.Row
    rows = connection.execute(
        """SELECT id,observed_at,channel_id,station_id,is_broadcasting,listener_count,
                  online_member_count,total_member_count,guest_count,total_listens,
                  current_stream_count,broadcast_start_time
             FROM sh_channel_snapshots
            WHERE observed_at<?
            ORDER BY observed_at ASC,id ASC""",
        (cutoff,),
    )
    candidates: dict[tuple[int, int], dict[str, object]] = {}
    previous_by_channel: dict[int, dict[str, object]] = {}
    for raw in rows:
        row = compact_snapshot(raw)
        channel_id = integer(row["channel_id"])
        observed_at = integer(row["observed_at"])
        if channel_id is None or observed_at is None:
            continue
        current_minute = minute_bucket(observed_at)
        previous = previous_by_channel.get(channel_id)
        if previous and previous["station_id"] == row["station_id"]:
            previous_minute = minute_bucket(integer(previous["observed_at"]) or 0)
            gap_minutes = (current_minute - previous_minute) // MINUTE_MS
            same_broadcast = (
                previous["is_broadcasting"] == row["is_broadcasting"]
                and previous["broadcast_start_time"] == row["broadcast_start_time"]
            )
            if same_broadcast and 1 < gap_minutes <= MAX_CARRY_MINUTES:
                for minute_at in range(previous_minute + MINUTE_MS, current_minute, MINUTE_MS):
                    candidates[(channel_id, minute_at)] = candidate(previous, minute_at, "carry_forward")
        candidates[(channel_id, current_minute)] = candidate(row, current_minute, "exact")
        previous_by_channel[channel_id] = row
    return sorted(candidates.values(), key=lambda item: (item["minute_at"], item["snapshot"]["channel_id"]))


def comment_count(connection: sqlite3.Connection, station_id: int | None, minute_at: int) -> int | None:
    if station_id is None:
        return None
    row = connection.execute(
        "SELECT comment_count FROM sh_comment_minute_counts WHERE station_id=? AND bucket_start=?",
        (station_id, minute_at),
    ).fetchone()
    return integer(row[0]) if row else None


def score_code(flags: int) -> int:
    score = 100
    if flags & QUEUE_MISSING:
        score -= 20
    if flags & COMMENTS_DEGRADED:
        score -= 10
    if flags & DELAYED_PAYLOAD:
        score -= 10
    return max(0, score)


FACT_COLUMNS = (
    "channel_id", "minute_at", "observed_at", "received_at", "source_code",
    "source_priority", "source_record_id", "collector_code", "broadcast_session_id",
    "is_broadcasting", "listener_count", "online_member_count", "total_member_count",
    "guest_count", "reported_total_listens", "reported_current_stream_count",
    "is_paused", "track_detection_code", "track_confidence_code", "schedule_valid",
    "comment_count", "comment_total", "comments_degraded", "quality_score_code",
    "quality_flags",
)


def fact_statements(
    connection: sqlite3.Connection,
    item: dict[str, object],
    received_at: int,
) -> list[str]:
    snapshot = item["snapshot"]
    channel_id = integer(snapshot["channel_id"])
    station_id = integer(snapshot["station_id"])
    minute_at = integer(item["minute_at"])
    observed_at = integer(item["observed_at"])
    mode = str(item["mode"])
    comments = comment_count(connection, station_id, minute_at)
    broadcasting = boolean(snapshot["is_broadcasting"])
    flags = LEGACY_QUALITY_REDUCED
    if broadcasting == 0:
        flags |= OFFLINE
    elif broadcasting != 0:
        flags |= QUEUE_MISSING
    if comments is None:
        flags |= COMMENTS_DEGRADED
    if mode == "carry_forward":
        flags |= DELAYED_PAYLOAD
    priority = 90 if mode == "exact" else 85
    quality = score_code(flags)
    source_record_id = (
        f"snapshot:{integer(snapshot['id']) or 0}:minute:{minute_at}:{mode}"
    )
    current_stream_count = integer(snapshot["current_stream_count"])
    if current_stream_count is not None and current_stream_count < 0:
        current_stream_count = None
    values = (
        channel_id, minute_at, observed_at, received_at, 2, priority,
        source_record_id, 2, None, broadcasting, integer(snapshot["listener_count"]),
        integer(snapshot["online_member_count"]), None, integer(snapshot["guest_count"]),
        integer(snapshot["total_listens"]), current_stream_count, 0, 0, 0, 0,
        comments, None, int(comments is None), quality, flags,
    )
    assignments = ",".join(f"{column}=excluded.{column}" for column in FACT_COLUMNS[1:])
    fact = (
        f"INSERT INTO sh_minute_facts({','.join(FACT_COLUMNS)}) "
        f"VALUES({','.join(literal(value) for value in values)}) "
        f"ON CONFLICT(channel_id,minute_at) DO UPDATE SET {assignments} "
        "WHERE excluded.source_priority>sh_minute_facts.source_priority "
        "OR (excluded.source_priority=sh_minute_facts.source_priority "
        "AND excluded.quality_score_code>sh_minute_facts.quality_score_code) "
        "OR (excluded.source_priority=sh_minute_facts.source_priority "
        "AND excluded.quality_score_code=sh_minute_facts.quality_score_code "
        "AND excluded.observed_at>=sh_minute_facts.observed_at);"
    )
    context = (
        "INSERT INTO sh_minute_fact_context_v2("
        "fact_id,station_id_override,broadcast_start_time_override,queue_available) "
        f"SELECT id,{literal(station_id)},{literal(integer(snapshot['broadcast_start_time']))},0 "
        "FROM sh_minute_facts "
        f"WHERE channel_id={literal(channel_id)} AND minute_at={literal(minute_at)} "
        f"AND source_code=2 AND source_record_id={literal(source_record_id)} "
        "ON CONFLICT(fact_id) DO UPDATE SET "
        "station_id_override=excluded.station_id_override,"
        "broadcast_start_time_override=excluded.broadcast_start_time_override,"
        "queue_available=0;"
    )
    statements = [fact, context]
    total_members = integer(snapshot["total_member_count"])
    if total_members is not None and total_members >= 0:
        day_at = (observed_at // 86_400_000) * 86_400_000
        statements.append(
            "INSERT INTO sh_total_member_daily("
            "channel_id,day_at,host_key,host_id,first_observed_at,last_observed_at,"
            "first_total_member_count,last_total_member_count,min_total_member_count,"
            "max_total_member_count,source_code,source_priority,quality_score_code) "
            f"VALUES({channel_id},{day_at},0,NULL,{observed_at},{observed_at},"
            f"{total_members},{total_members},{total_members},{total_members},2,{priority},{quality}) "
            "ON CONFLICT(channel_id,day_at,host_key) DO UPDATE SET "
            "first_total_member_count=CASE WHEN excluded.first_observed_at<first_observed_at "
            "THEN excluded.first_total_member_count ELSE first_total_member_count END,"
            "first_observed_at=MIN(first_observed_at,excluded.first_observed_at),"
            "last_total_member_count=CASE WHEN excluded.last_observed_at>=last_observed_at "
            "THEN excluded.last_total_member_count ELSE last_total_member_count END,"
            "last_observed_at=MAX(last_observed_at,excluded.last_observed_at),"
            "min_total_member_count=MIN(min_total_member_count,excluded.min_total_member_count),"
            "max_total_member_count=MAX(max_total_member_count,excluded.max_total_member_count),"
            "source_code=excluded.source_code,source_priority=excluded.source_priority,"
            "quality_score_code=excluded.quality_score_code "
            "WHERE excluded.first_observed_at<first_observed_at "
            "OR excluded.last_observed_at>=last_observed_at;"
        )
    return statements


def write_chunks(
    connection: sqlite3.Connection,
    candidates: list[dict[str, object]],
    out_dir: Path,
    received_at: int,
) -> list[dict[str, object]]:
    for old in out_dir.glob("minute-facts-*.sql"):
        old.unlink()
    chunks: list[dict[str, object]] = []
    current: list[str] = []
    current_bytes = 0

    def flush() -> None:
        nonlocal current, current_bytes
        if not current:
            return
        path = out_dir / f"minute-facts-{len(chunks) + 1:04d}.sql"
        payload = "\n".join(current) + "\n"
        path.write_text(payload, encoding="utf-8")
        chunks.append({
            "file": path.name,
            "bytes": len(payload.encode("utf-8")),
            "statements": len(current),
        })
        current = []
        current_bytes = 0

    for item in candidates:
        statements = fact_statements(connection, item, received_at)
        statement_bytes = sum(len((statement + "\n").encode("utf-8")) for statement in statements)
        if statement_bytes > MAX_UPLOAD_BYTES:
            raise ValueError("one minute fact exceeds the D1 upload size limit")
        if current and current_bytes + statement_bytes > MAX_UPLOAD_BYTES:
            flush()
        current.extend(statements)
        current_bytes += statement_bytes
    flush()
    return chunks


def main() -> None:
    args = parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    local_path = args.out_dir / "buddies.sqlite"
    if local_path.exists():
        local_path.unlink()
    connection = sqlite3.connect(local_path)
    statements = execute_dump(connection, args.buddies_export)
    required = {"sh_channel_snapshots", "sh_comment_minute_counts"}
    present = {
        row[0] for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    }
    missing = sorted(required - present)
    if missing:
        raise RuntimeError(f"buddies export is missing required tables: {', '.join(missing)}")
    now_ms = args.now_ms if args.now_ms is not None else int(time.time() * 1000)
    cutoff = now_ms - max(0, args.recent_guard_ms)
    candidates = build_candidates(connection, cutoff)
    chunks = write_chunks(connection, candidates, args.out_dir, now_ms)
    manifest = {
        "ok": True,
        "source_statements": statements,
        "source_sha256": hashlib.sha256(args.buddies_export.read_bytes()).hexdigest(),
        "cutoff_ms": cutoff,
        "candidates": len(candidates),
        "exact": sum(item["mode"] == "exact" for item in candidates),
        "carry_forward": sum(item["mode"] == "carry_forward" for item in candidates),
        "chunks": chunks,
    }
    (args.out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    main()
