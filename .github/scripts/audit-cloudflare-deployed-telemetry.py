#!/usr/bin/env python3
"""Audit active Worker versions and currently registered Cron triggers."""

from __future__ import annotations

import datetime as dt
import importlib.util
import json
import os
import sys
import urllib.parse
from pathlib import Path
from typing import Any, Iterable

SCRIPT_DIR = Path(__file__).resolve().parent
AUDIT_PATH = SCRIPT_DIR / "audit-cloudflare-telemetry.py"
SPEC = importlib.util.spec_from_file_location("cloudflare_telemetry_audit", AUDIT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Could not load telemetry audit from {AUDIT_PATH}")
audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit)

DEPLOYMENT_COVERAGE_GRACE_SECONDS = max(
    0,
    int(os.environ.get("DEPLOYMENT_COVERAGE_GRACE_SECONDS", "900")),
)


def deployment_versions(response: dict[str, Any]) -> tuple[str, set[str], str]:
    result = response.get("result") if isinstance(response, dict) else None
    deployments = result.get("deployments") if isinstance(result, dict) else None
    if not isinstance(deployments, list) or not deployments:
        raise RuntimeError("Cloudflare returned no active Worker deployment")
    deployment = deployments[0]
    if not isinstance(deployment, dict):
        raise RuntimeError("Cloudflare returned an invalid active Worker deployment")
    active = {
        str(item.get("version_id") or "")
        for item in deployment.get("versions") or []
        if isinstance(item, dict)
        and float(item.get("percentage") or 0) > 0
        and str(item.get("version_id") or "")
    }
    if not active:
        raise RuntimeError("Cloudflare active Worker deployment has no traffic-bearing version")
    created_on = str(deployment.get("created_on") or deployment.get("created_at") or "")
    return str(deployment.get("id") or ""), active, created_on


def schedule_values(response: dict[str, Any]) -> set[str]:
    result = response.get("result") if isinstance(response, dict) else None
    schedules = result.get("schedules") if isinstance(result, dict) else None
    if not isinstance(schedules, list):
        raise RuntimeError("Cloudflare returned invalid Worker Cron schedules")
    return {
        str(item.get("cron") or "").strip()
        for item in schedules
        if isinstance(item, dict) and str(item.get("cron") or "").strip()
    }


def failure_detail(error: Exception) -> str:
    return " ".join(str(error).split())[:500]


def active_worker_state(
    account: str,
) -> tuple[
    dict[str, set[str]],
    dict[str, dict[str, Any]],
    dict[str, set[str] | None],
    dict[str, str],
]:
    versions: dict[str, set[str]] = {}
    metadata: dict[str, dict[str, Any]] = {}
    schedules: dict[str, set[str] | None] = {}
    failures: dict[str, str] = {}
    for worker in audit.WORKERS:
        encoded = urllib.parse.quote(worker, safe="")
        worker_metadata: dict[str, Any] = {"deployment_id": "", "created_on": ""}
        try:
            response = audit.request_json(
                f"{audit.API_BASE}/accounts/{account}/workers/scripts/{encoded}/deployments"
            )
            deployment_id, active, created_on = deployment_versions(response)
            versions[worker] = active
            worker_metadata.update({"deployment_id": deployment_id, "created_on": created_on})
        except Exception as error:
            detail = failure_detail(error)
            versions[worker] = set()
            worker_metadata["error"] = detail
            failures[f"{worker}:deployment"] = detail
        try:
            response = audit.request_json(
                f"{audit.API_BASE}/accounts/{account}/workers/scripts/{encoded}/schedules"
            )
            schedules[worker] = schedule_values(response)
        except Exception as error:
            detail = failure_detail(error)
            schedules[worker] = None
            worker_metadata["schedule_error"] = detail
            failures[f"{worker}:schedules"] = detail
        metadata[worker] = worker_metadata
    return versions, metadata, schedules, failures


def deployment_payload(
    active: dict[str, set[str]],
    metadata: dict[str, dict[str, Any]],
    schedules: dict[str, set[str] | None],
) -> dict[str, dict[str, Any]]:
    payload: dict[str, dict[str, Any]] = {}
    for worker in audit.WORKERS:
        worker_metadata = metadata.get(worker, {})
        versions = sorted(active.get(worker, set()))
        cron_values = schedules.get(worker)
        item: dict[str, Any] = {
            "status": "active" if versions else "unavailable",
            "deployment_id": worker_metadata.get("deployment_id", ""),
            "version_ids": versions,
            "created_on": worker_metadata.get("created_on", ""),
            "cron_triggers": sorted(cron_values) if cron_values is not None else None,
        }
        for key in ("error", "schedule_error"):
            value = worker_metadata.get(key, "")
            if value:
                item[key] = value
        payload[worker] = item
    return payload


def cron_expression(event: dict[str, Any]) -> str:
    metadata, workers = audit.fields(event)
    worker_event = workers.get("event") if isinstance(workers.get("event"), dict) else {}
    source = event.get("source") if isinstance(event.get("source"), dict) else {}
    candidates = (
        worker_event.get("cron"),
        worker_event.get("schedule"),
        metadata.get("cron"),
        metadata.get("message"),
        source.get("message"),
    )
    for value in candidates:
        text = " ".join(str(value or "").split())
        if text:
            return text
    return ""


def recovery_key(event: dict[str, Any]) -> tuple[str, str, str] | None:
    if audit.invocation_class(event) != "cron":
        return None
    expression = cron_expression(event)
    if not expression:
        return None
    return audit.worker_name(event), audit.version_id(event), expression


def mark_recovered_cron_errors(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    latest_success: dict[tuple[str, str, str], float] = {}
    for event in events:
        key = recovery_key(event)
        if key is None or audit.error_event(event):
            continue
        latest_success[key] = max(latest_success.get(key, 0), audit.timestamp_ms(event))

    result: list[dict[str, Any]] = []
    for event in events:
        key = recovery_key(event)
        recoverable = (
            key is not None
            and audit.error_event(event)
            and not audit.cpu_limit_outcome(event)
            and latest_success.get(key, 0) > audit.timestamp_ms(event)
        )
        if recoverable:
            copied = dict(event)
            copied["_diagnostic_recovered"] = True
            result.append(copied)
        else:
            result.append(event)
    return result


def deployed_current_events(
    persisted: list[dict[str, Any]],
    live: list[dict[str, Any]],
    active: dict[str, set[str]],
    schedules: dict[str, set[str] | None],
) -> tuple[list[dict[str, Any]], dict[str, str], int]:
    selected_persisted: list[dict[str, Any]] = []
    selected_live: list[dict[str, Any]] = []
    persisted_invocations = 0
    selected_invocations = 0
    inactive_cron_events = 0

    def include(event: dict[str, Any], *, persisted_event: bool) -> bool:
        nonlocal persisted_invocations, selected_invocations, inactive_cron_events
        worker = audit.worker_name(event)
        cpu_ms = audit.detail(event)["cpu_ms"]
        if persisted_event and cpu_ms is not None:
            persisted_invocations += 1
        if worker not in audit.WORKERS:
            return False
        active_versions = active.get(worker, set())
        if not active_versions:
            return False
        version = audit.version_id(event)
        if persisted_event and (not version or version not in active_versions):
            return False
        if not persisted_event and version and version not in active_versions:
            return False
        if audit.invocation_class(event) == "cron":
            registered = schedules.get(worker)
            expression = cron_expression(event)
            if registered is not None and expression and expression not in registered:
                inactive_cron_events += 1
                return False
        if persisted_event and cpu_ms is not None:
            selected_invocations += 1
        return True

    for event in persisted:
        if include(event, persisted_event=True):
            selected_persisted.append(event)
    for event in live:
        if include(event, persisted_event=False):
            selected_live.append(event)

    if inactive_cron_events:
        print(f"INACTIVE_CRON_EVENTS_EXCLUDED count={inactive_cron_events}")
    merged = audit.merge_events(selected_persisted, selected_live)
    recovered = mark_recovered_cron_errors(merged)
    recovered_items = [audit.detail(event) for event in recovered if event.get("_diagnostic_recovered")]
    for item in recovered_items[:20]:
        print(
            "::warning title=Recovered Cloudflare Worker error::"
            f"worker={item['worker']} version={item['version']} outcome={item['outcome']} "
            f"event={item['event_type']} message={item['message']}"
        )
    labels = {worker: ",".join(sorted(active.get(worker, set()))) for worker in audit.WORKERS}
    return recovered, labels, persisted_invocations - selected_invocations


def deployment_time(value: str) -> dt.datetime | None:
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def coverage_grace_workers(
    metadata: dict[str, dict[str, Any]],
    now: dt.datetime | None = None,
    grace_seconds: int = DEPLOYMENT_COVERAGE_GRACE_SECONDS,
) -> set[str]:
    if grace_seconds <= 0:
        return set()
    current = now or dt.datetime.now(dt.timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=dt.timezone.utc)
    current = current.astimezone(dt.timezone.utc)
    pending: set[str] = set()
    for worker in audit.WORKERS:
        created = deployment_time(str((metadata.get(worker) or {}).get("created_on") or ""))
        if created is None:
            continue
        age = (current - created).total_seconds()
        if 0 <= age < grace_seconds:
            pending.add(worker)
    return pending


def coverage_after_grace(
    missing: Iterable[str],
    truncated: bool,
    grace_workers: set[str],
) -> tuple[list[str], list[str], bool]:
    missing_set = set(missing)
    pending = sorted(missing_set & grace_workers)
    remaining = sorted(missing_set - grace_workers)
    return remaining, pending, not truncated and not remaining


def self_test() -> int:
    deployment = {
        "result": {
            "deployments": [{
                "id": "deployment-1",
                "created_on": "2026-07-23T12:34:56.000Z",
                "versions": [
                    {"version_id": "v2", "percentage": 100},
                    {"version_id": "v1", "percentage": 0},
                ],
            }]
        }
    }
    deployment_id, active, created_on = deployment_versions(deployment)
    assert deployment_id == "deployment-1"
    assert active == {"v2"}
    assert created_on == "2026-07-23T12:34:56.000Z"
    assert schedule_values({"result": {"schedules": [{"cron": "* * * * *"}]}}) == {"* * * * *"}

    def event(identifier: str, timestamp: str, cron: str, outcome: str) -> dict[str, Any]:
        return {
            "timestamp": timestamp,
            "$metadata": {"id": identifier, "service": "a", "requestId": identifier},
            "$workers": {
                "scriptVersion": {"id": "v2"},
                "cpuTimeMs": 2,
                "outcome": outcome,
                "eventType": "cron",
                "executionModel": "stateless",
                "event": {"cron": cron},
            },
        }

    inactive = event("inactive", "2026-07-23T12:00:00Z", "*/12 * * * *", "exception")
    failed = event("failed", "2026-07-23T12:01:00Z", "* * * * *", "exception")
    recovered = event("recovered", "2026-07-23T12:02:00Z", "* * * * *", "ok")
    original_workers = audit.WORKERS
    audit.WORKERS = ("a",)
    try:
        selected, labels, excluded = deployed_current_events(
            [inactive, failed, recovered],
            [],
            {"a": {"v2"}},
            {"a": {"* * * * *"}},
        )
        assert labels == {"a": "v2"}
        assert excluded == 1
        assert {audit.event_key(item) for item in selected} == {"failed", "recovered"}
        assert any(item.get("_diagnostic_recovered") for item in selected)
        original_error_event = audit.error_event
        audit.error_event = lambda item: False if item.get("_diagnostic_recovered") else original_error_event(item)
        try:
            violations, _, errors, samples, missing, coverage = audit.evaluate(selected, False)
        finally:
            audit.error_event = original_error_event
        assert not violations and not errors
        assert samples["a"] == [2.0, 2.0]
        assert not missing and coverage
    finally:
        audit.WORKERS = original_workers
    print("active-deployment and Cron-aware telemetry audit self-test passed")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    if not audit.TOKEN or not audit.ACCOUNT_ID or not audit.WORKERS:
        raise RuntimeError("Cloudflare token, account ID, and Worker list are required")

    active, deployment_metadata, schedules, state_failures = active_worker_state(audit.ACCOUNT_ID)
    payload = deployment_payload(active, deployment_metadata, schedules)
    output_path = str(os.environ.get("ACTIVE_WORKER_DEPLOYMENTS_OUTPUT") or "").strip()
    if output_path:
        target = Path(output_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")
    print("ACTIVE_WORKER_DEPLOYMENTS=" + json.dumps(payload, separators=(",", ":")))
    for target, detail_text in state_failures.items():
        print(f"::error title=Cloudflare Worker state unavailable::target={target} detail={detail_text}")

    grace_workers = coverage_grace_workers(deployment_metadata)
    original_current_events = audit.current_events
    original_evaluate = audit.evaluate
    original_error_event = audit.error_event

    def evaluate_with_deployment_grace(
        events: list[dict[str, Any]],
        truncated: bool,
    ) -> tuple[
        list[dict[str, Any]],
        list[dict[str, Any]],
        list[dict[str, Any]],
        dict[str, list[float]],
        list[str],
        bool,
    ]:
        violations, exempted, errors, samples, missing, _coverage = original_evaluate(events, truncated)
        remaining, pending, coverage = coverage_after_grace(missing, truncated, grace_workers)
        if pending:
            print(
                "CPU_COVERAGE_GRACE "
                f"workers={','.join(pending)} grace_seconds={DEPLOYMENT_COVERAGE_GRACE_SECONDS}"
            )
        return violations, exempted, errors, samples, remaining, coverage

    audit.current_events = lambda persisted, live: deployed_current_events(
        persisted,
        live,
        active,
        schedules,
    )
    audit.error_event = lambda event: (
        False if event.get("_diagnostic_recovered") else original_error_event(event)
    )
    audit.evaluate = evaluate_with_deployment_grace
    try:
        audit_result = audit.main()
    finally:
        audit.current_events = original_current_events
        audit.evaluate = original_evaluate
        audit.error_event = original_error_event
    return 1 if state_failures or audit_result else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(
            "::error title=Cloudflare active-deployment telemetry audit::"
            + str(error).replace("\n", " ")[:1000]
        )
        raise
