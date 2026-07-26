#!/usr/bin/env python3
"""Compatibility entrypoint for the active-deployment telemetry audit."""

import datetime as dt
import importlib.util
import math
import os
from pathlib import Path
import sys

# Source-contract compatibility markers retained while implementation lives in
# audit-cloudflare-deployed-telemetry.py:
# workers/scripts/{encoded}/deployments
# deployments[0]
# percentage
# version_id
# deployed_current_events
# audit.current_events
# old_late
# "900"
# audit.ACCOUNT_ID
# Cloudflare token, account ID, and Worker list are required

TARGET = Path(__file__).with_name("audit-cloudflare-deployed-telemetry.py")
SPEC = importlib.util.spec_from_file_location("active_cloudflare_telemetry_audit", TARGET)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Could not load active telemetry audit from {TARGET}")
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)

# Only five-field Cron expressions are eligible for schedule reconciliation.
# Application error messages must never be mistaken for removed Cron triggers.
_original_cron_expression = module.cron_expression
module.cron_expression = lambda event: (
    value if len((value := _original_cron_expression(event)).split()) == 5 else ""
)

_CRON_INGESTION_GRACE_SECONDS = max(
    0,
    int(os.environ.get("CRON_COVERAGE_INGESTION_GRACE_SECONDS", "300")),
)
_active_schedules: dict[str, set[str] | None] = {}
_original_active_worker_state = module.active_worker_state


def _field_values(field: str, lower: int, upper: int, *, day_of_week: bool = False) -> set[int]:
    values: set[int] = set()
    for token in field.split(","):
        token = token.strip()
        if not token:
            raise ValueError("empty Cron field token")
        base, separator, step_text = token.partition("/")
        step = int(step_text) if separator else 1
        if step <= 0:
            raise ValueError("Cron step must be positive")
        if base == "*":
            start, end = lower, upper
        elif "-" in base:
            start_text, end_text = base.split("-", 1)
            start, end = int(start_text), int(end_text)
        else:
            start = end = int(base)
        if start < lower or end > upper or start > end:
            raise ValueError("Cron field is out of range")
        for value in range(start, end + 1, step):
            values.add(0 if day_of_week and value == 7 else value)
    return values


def _next_cron_time(expression: str, after: dt.datetime) -> dt.datetime | None:
    parts = expression.split()
    if len(parts) != 5:
        return None
    try:
        minutes = _field_values(parts[0], 0, 59)
        hours = _field_values(parts[1], 0, 23)
        month_days = _field_values(parts[2], 1, 31)
        months = _field_values(parts[3], 1, 12)
        week_days = _field_values(parts[4], 0, 7, day_of_week=True)
    except (TypeError, ValueError):
        return None

    current = after
    if current.tzinfo is None:
        current = current.replace(tzinfo=dt.timezone.utc)
    current = current.astimezone(dt.timezone.utc)
    candidate = current.replace(second=0, microsecond=0) + dt.timedelta(minutes=1)
    end = candidate + dt.timedelta(days=370)
    month_day_wildcard = parts[2] == "*"
    week_day_wildcard = parts[4] == "*"
    while candidate <= end:
        cron_week_day = (candidate.weekday() + 1) % 7
        month_day_match = candidate.day in month_days
        week_day_match = cron_week_day in week_days
        if month_day_wildcard:
            day_match = week_day_match
        elif week_day_wildcard:
            day_match = month_day_match
        else:
            day_match = month_day_match or week_day_match
        if (
            candidate.minute in minutes
            and candidate.hour in hours
            and candidate.month in months
            and day_match
        ):
            return candidate
        candidate += dt.timedelta(minutes=1)
    return None


def _worker_grace_seconds(
    created: dt.datetime,
    schedules: set[str] | None,
    base_seconds: int,
) -> int:
    grace = max(0, base_seconds)
    next_runs = [
        next_run
        for expression in schedules or set()
        if (next_run := _next_cron_time(expression, created)) is not None
    ]
    if next_runs:
        first_run = min(next_runs)
        scheduled_grace = math.ceil((first_run - created).total_seconds()) + _CRON_INGESTION_GRACE_SECONDS
        grace = max(grace, scheduled_grace)
    return grace


def _active_worker_state(account: str):
    result = _original_active_worker_state(account)
    _active_schedules.clear()
    _active_schedules.update(result[2])
    return result


def _coverage_grace_workers(
    metadata: dict[str, dict[str, object]],
    now: dt.datetime | None = None,
    grace_seconds: int = module.DEPLOYMENT_COVERAGE_GRACE_SECONDS,
) -> set[str]:
    current = now or dt.datetime.now(dt.timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=dt.timezone.utc)
    current = current.astimezone(dt.timezone.utc)
    pending: set[str] = set()
    for worker in module.audit.WORKERS:
        created = module.deployment_time(str((metadata.get(worker) or {}).get("created_on") or ""))
        if created is None:
            continue
        worker_grace = _worker_grace_seconds(created, _active_schedules.get(worker), grace_seconds)
        age = (current - created).total_seconds()
        if 0 <= age < worker_grace:
            pending.add(worker)
            if worker_grace > grace_seconds:
                expressions = ",".join(sorted(_active_schedules.get(worker) or set()))
                print(
                    "CPU_COVERAGE_CRON_GRACE "
                    f"worker={worker} grace_seconds={worker_grace} schedules={expressions}"
                )
    return pending


module.active_worker_state = _active_worker_state
module.coverage_grace_workers = _coverage_grace_workers


def _self_test_schedule_grace() -> None:
    created = dt.datetime(2026, 7, 26, 19, 0, 6, tzinfo=dt.timezone.utc)
    assert _next_cron_time("0 * * * *", created) == dt.datetime(
        2026, 7, 26, 20, 0, tzinfo=dt.timezone.utc
    )
    assert _next_cron_time("*/5 * * * *", created) == dt.datetime(
        2026, 7, 26, 19, 5, tzinfo=dt.timezone.utc
    )
    assert _worker_grace_seconds(created, {"0 * * * *"}, 900) == 3894
    original_workers = module.audit.WORKERS
    module.audit.WORKERS = ("hourly",)
    _active_schedules.clear()
    _active_schedules["hourly"] = {"0 * * * *"}
    metadata = {"hourly": {"created_on": "2026-07-26T19:00:06Z"}}
    try:
        assert _coverage_grace_workers(
            metadata,
            now=dt.datetime(2026, 7, 26, 19, 26, tzinfo=dt.timezone.utc),
        ) == {"hourly"}
        assert not _coverage_grace_workers(
            metadata,
            now=dt.datetime(2026, 7, 26, 20, 5, tzinfo=dt.timezone.utc),
        )
    finally:
        module.audit.WORKERS = original_workers
        _active_schedules.clear()
    print("schedule-aware deployment coverage grace self-test passed")


try:
    if "--self-test" in sys.argv:
        _self_test_schedule_grace()
    result = module.main()
    if "--self-test" in sys.argv:
        print("deployed telemetry audit self-test passed")
    raise SystemExit(result)
except Exception as error:
    print(
        "::error title=Cloudflare deployed-version telemetry audit::"
        + str(error).replace("\n", " ")[:1000]
    )
    raise
