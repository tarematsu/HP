#!/usr/bin/env python3
"""Audit deployed Worker telemetry against invocation-specific CPU limits."""

from __future__ import annotations

import datetime as dt
import importlib.util
import json
import os
import sys
from pathlib import Path
from typing import Any

CORE_PATH = Path(__file__).with_name("audit-cloudflare-telemetry-core.py")
SPEC = importlib.util.spec_from_file_location("cloudflare_telemetry_core", CORE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Could not load telemetry audit from {CORE_PATH}")
core = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(core)

# Preserve the original module API because the deployed-version selector imports
# this file and replaces current_events/evaluate at runtime.
for _name in dir(core):
    if not _name.startswith("__"):
        globals()[_name] = getattr(core, _name)

WORKERS = core.WORKERS
HTTP_CRON_CPU_BUDGET_MS = core.STATELESS_CPU_BUDGET_MS
QUEUE_CPU_BUDGET_MS = float(os.environ.get("QUEUE_CPU_BUDGET_MS", "30000"))
DURABLE_OBJECT_CPU_BUDGET_MS = core.DURABLE_OBJECT_CPU_BUDGET_MS
_CORE_DETAIL = core.detail


def _sync_runtime_overrides() -> None:
    core.WORKERS = globals().get("WORKERS", core.WORKERS)
    core.current_events = globals().get("current_events", core.current_events)


def invocation_class(event: dict[str, Any]) -> str:
    metadata, workers = core.fields(event)
    model = str(workers.get("executionModel") or "stateless")
    if model == "durableObject":
        return "durableObject"
    event_type = str(workers.get("eventType") or metadata.get("origin") or "").strip().lower()
    if event_type == "queue":
        return "queue"
    if event_type == "cron":
        return "cron"
    if event_type == "fetch":
        return "http"
    return "stateless"


def cpu_budget_ms(event: dict[str, Any]) -> float:
    policy = invocation_class(event)
    if policy == "queue":
        return QUEUE_CPU_BUDGET_MS
    if policy == "durableObject":
        return DURABLE_OBJECT_CPU_BUDGET_MS
    return HTTP_CRON_CPU_BUDGET_MS


def detail(event: dict[str, Any]) -> dict[str, Any]:
    item = dict(_CORE_DETAIL(event))
    item["budget_class"] = invocation_class(event)
    item["budget_ms"] = cpu_budget_ms(event)
    return item


def cpu_limit_outcome(event: dict[str, Any]) -> bool:
    _, workers = core.fields(event)
    normalized = "".join(character for character in str(workers.get("outcome") or "").lower() if character.isalnum())
    return normalized == "exceededcpu"


def evaluate(events, truncated):
    """Apply hard limits by invocation type without text-marker exemptions."""
    _sync_runtime_overrides()
    violations: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    samples: dict[str, list[float]] = {worker: [] for worker in WORKERS}
    for event in events:
        item = detail(event)
        cpu_ms = item["cpu_ms"]
        if item["worker"] in samples and cpu_ms is not None:
            samples[item["worker"]].append(cpu_ms)
        if core.error_event(event):
            errors.append(item)
        if cpu_limit_outcome(event) or (cpu_ms is not None and cpu_ms > item["budget_ms"]):
            violations.append(item)
    missing = [worker for worker, values in samples.items() if not values]
    return violations, [], errors, samples, missing, not truncated and not missing


def grouped_cpu_stats(events: list[dict[str, Any]]) -> tuple[dict[str, int], dict[str, dict[str, list[float]]]]:
    class_counts: dict[str, int] = {}
    grouped: dict[str, dict[str, list[float]]] = {worker: {} for worker in WORKERS}
    for event in events:
        item = detail(event)
        cpu_ms = item["cpu_ms"]
        if cpu_ms is None:
            continue
        policy = item["budget_class"]
        class_counts[policy] = class_counts.get(policy, 0) + 1
        worker = item["worker"]
        if worker in grouped:
            grouped[worker].setdefault(policy, []).append(cpu_ms)
    return class_counts, grouped


def stats(values: list[float]) -> dict[str, float | int | None]:
    return {
        "samples": len(values),
        "avg_ms": (sum(values) / len(values)) if values else None,
        "max_ms": max(values) if values else None,
    }


def self_test() -> int:
    original_workers = WORKERS
    globals()["WORKERS"] = ("a",)
    core.WORKERS = ("a",)

    def event(identifier: str, *, cpu: float, event_type: str, model: str = "stateless", outcome: str = "ok"):
        return {
            "timestamp": "2026-07-23T00:00:00Z",
            "$metadata": {"id": identifier, "service": "a", "origin": event_type},
            "$workers": {
                "scriptVersion": {"id": "v1"},
                "cpuTimeMs": cpu,
                "outcome": outcome,
                "eventType": event_type,
                "executionModel": model,
            },
        }

    cron_overage = event("cron-overage", cpu=12, event_type="cron")
    queue_ok = event("queue-ok", cpu=37, event_type="queue")
    durable_ok = event("durable-ok", cpu=45, event_type="fetch", model="durableObject")
    http_ok = event("http-ok", cpu=9, event_type="fetch")
    queue_terminal = event("queue-terminal", cpu=12, event_type="queue", outcome="exceededCpu")
    try:
        violations, exempted, errors, samples, missing, coverage = evaluate(
            [cron_overage, queue_ok, durable_ok, http_ok, queue_terminal], False
        )
        assert {item["time"] + item["outcome"] for item in violations} == {
            detail(cron_overage)["time"] + "ok",
            detail(queue_terminal)["time"] + "exceededCpu",
        }
        assert not exempted and len(errors) == 1
        assert samples["a"] == [12.0, 37.0, 45.0, 9.0, 12.0]
        assert not missing and coverage
        assert detail(queue_ok)["budget_class"] == "queue"
        assert detail(queue_ok)["budget_ms"] == QUEUE_CPU_BUDGET_MS
        assert detail(cron_overage)["budget_ms"] == HTTP_CRON_CPU_BUDGET_MS
        assert detail(durable_ok)["budget_ms"] == DURABLE_OBJECT_CPU_BUDGET_MS
    finally:
        globals()["WORKERS"] = original_workers
        core.WORKERS = original_workers
    print("invocation-aware telemetry audit self-test passed")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    _sync_runtime_overrides()
    if not core.TOKEN or not WORKERS:
        raise RuntimeError("Cloudflare token and Worker list are required")
    account = core.account_id()
    end = dt.datetime.now(dt.timezone.utc)
    start = core.parse_start(end)
    persisted, matching, truncated = core.query_events(
        account,
        int(start.timestamp() * 1000),
        int(end.timestamp() * 1000),
    )
    live = core.live_tail_events()
    events, versions, old_versions = core.current_events(persisted, live)
    violations, exempted, errors, samples, missing, coverage_ok = evaluate(events, truncated)
    class_counts, grouped = grouped_cpu_stats(events)
    model_counts: dict[str, int] = {}
    for event in events:
        item = detail(event)
        if item["cpu_ms"] is not None:
            model_counts[item["model"]] = model_counts.get(item["model"], 0) + 1
    worker_stats = {
        worker: {
            "version": versions.get(worker),
            **stats(values),
            "classes": {policy: stats(class_values) for policy, class_values in grouped[worker].items()},
        }
        for worker, values in samples.items()
    }
    report = {
        "window": {
            "from": start.isoformat().replace("+00:00", "Z"),
            "to": end.isoformat().replace("+00:00", "Z"),
        },
        "events": {
            "persisted_matching": matching,
            "persisted_fetched": len(persisted),
            "live_fetched": len(live),
            "current_version_events": len(events),
            "old_version_invocations_excluded": old_versions,
            "truncated": truncated,
        },
        "cpu_policy": {
            "stateless_budget_ms": HTTP_CRON_CPU_BUDGET_MS,
            "http_cron_budget_ms": HTTP_CRON_CPU_BUDGET_MS,
            "queue_consumer_budget_ms": QUEUE_CPU_BUDGET_MS,
            "durable_object_budget_ms": DURABLE_OBJECT_CPU_BUDGET_MS,
            "coverage_ok": coverage_ok,
            "missing_workers": missing,
            "models": model_counts,
            "classes": class_counts,
            "workers": worker_stats,
            "violations": len(violations),
            "exempted": len(exempted),
            "samples": violations[:20],
        },
        "errors": {"count": len(errors), "samples": errors[:20]},
    }
    print("TELEMETRY_AUDIT=" + json.dumps(report, ensure_ascii=False, separators=(",", ":")))
    print(
        f"CPU_POLICY http_cron_budget_ms={HTTP_CRON_CPU_BUDGET_MS:g} "
        f"queue_consumer_budget_ms={QUEUE_CPU_BUDGET_MS:g} "
        f"durable_object_budget_ms={DURABLE_OBJECT_CPU_BUDGET_MS:g} "
        f"samples={sum(len(values) for values in samples.values())} "
        f"violations={len(violations)} exempted={len(exempted)} old_versions={old_versions} "
        f"truncated={truncated} coverage_ok={coverage_ok}"
    )
    for worker, worker_values in grouped.items():
        for policy, values in worker_values.items():
            item_stats = stats(values)
            budget = (
                QUEUE_CPU_BUDGET_MS if policy == "queue"
                else DURABLE_OBJECT_CPU_BUDGET_MS if policy == "durableObject"
                else HTTP_CRON_CPU_BUDGET_MS
            )
            print(
                f"CPU_CLASS worker={worker} version={versions.get(worker)} class={policy} "
                f"budget_ms={budget:g} samples={item_stats['samples']} "
                f"avg_ms={item_stats['avg_ms']} max_ms={item_stats['max_ms']}"
            )
    for worker, item_stats in worker_stats.items():
        print(
            f"CPU_WORKER worker={worker} version={item_stats['version']} samples={item_stats['samples']} "
            f"avg_ms={item_stats['avg_ms']} max_ms={item_stats['max_ms']}"
        )
    for item in violations[:20]:
        print(
            "::error title=Worker CPU policy violation::"
            f"worker={item['worker']} version={item['version']} cpu_ms={item['cpu_ms']} "
            f"budget_ms={item['budget_ms']} class={item['budget_class']} model={item['model']} "
            f"source={item['source']} outcome={item['outcome']} event={item['event_type']} url={item['url']}"
        )
    for item in errors[:20]:
        print(
            "::error title=Cloudflare Worker error::"
            f"worker={item['worker']} version={item['version']} source={item['source']} "
            f"outcome={item['outcome']} message={item['message']} url={item['url']}"
        )
    if not coverage_ok:
        print(
            "::error title=Worker CPU policy has incomplete coverage::"
            f"missing_workers={','.join(missing)} truncated={truncated}"
        )

    summary = [
        "## Cloudflare Telemetry audit",
        "",
        f"- Window: `{report['window']['from']}` to `{report['window']['to']}`",
        f"- HTTP and Cron CPU policy: `<= {HTTP_CRON_CPU_BUDGET_MS:g} ms` per invocation",
        f"- Queue consumer CPU policy: `<= {QUEUE_CPU_BUDGET_MS:g} ms` per invocation",
        f"- Durable Object CPU policy: `<= {DURABLE_OBJECT_CPU_BUDGET_MS:g} ms` per invocation",
        f"- Current-version CPU samples: `{sum(len(values) for values in samples.values())}`",
        f"- Live-tail samples received: `{len(live)}`",
        f"- Old-version invocations excluded: `{old_versions}`",
        f"- CPU coverage: `{'OK' if coverage_ok else 'MISSING'}`",
        f"- CPU violations: `{len(violations)}`",
        f"- Error invocations: `{len(errors)}`",
        "",
        "| Worker | Class | Budget ms | Samples | Average ms | Maximum ms |",
        "|---|---|---:|---:|---:|---:|",
    ]
    for worker, worker_values in grouped.items():
        version = (versions.get(worker) or "-")[:12]
        for policy, values in worker_values.items():
            item_stats = stats(values)
            budget = (
                QUEUE_CPU_BUDGET_MS if policy == "queue"
                else DURABLE_OBJECT_CPU_BUDGET_MS if policy == "durableObject"
                else HTTP_CRON_CPU_BUDGET_MS
            )
            summary.append(
                f"| `{worker}` (`{version}`) | `{policy}` | {budget:g} | "
                f"{item_stats['samples']} | {item_stats['avg_ms']} | {item_stats['max_ms']} |"
            )
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as output:
            output.write("\n".join(summary) + "\n")
    return 1 if violations or errors or not coverage_ok else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(
            "::error title=Cloudflare Telemetry audit::"
            + str(error).replace("\n", " ")[:1000]
        )
        raise
