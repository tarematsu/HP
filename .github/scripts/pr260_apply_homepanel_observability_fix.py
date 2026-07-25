#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one occurrence, found {count}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))


def replace_regex(path: str, pattern: str, replacement: str) -> None:
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{path}: regex did not match exactly once: {pattern[:160]!r}")
    write(path, updated)


audit = ".github/scripts/audit-cloudflare-telemetry.py"
replace_once(
    audit,
    '''STATELESS_CPU_BUDGET_MS = float(os.environ.get("CPU_BUDGET_MS", "10"))
DURABLE_OBJECT_CPU_BUDGET_MS = float(os.environ.get("DURABLE_OBJECT_CPU_BUDGET_MS", "30000"))
''',
    '''STATELESS_CPU_BUDGET_MS = float(os.environ.get("CPU_BUDGET_MS", "10"))
QUEUE_CPU_BUDGET_MS = float(os.environ.get("QUEUE_CPU_BUDGET_MS", "30000"))
DURABLE_OBJECT_CPU_BUDGET_MS = float(os.environ.get("DURABLE_OBJECT_CPU_BUDGET_MS", "30000"))
''',
)
replace_once(
    audit,
    '''def request_id(event: dict[str, Any]) -> str:
    metadata, workers = fields(event)
    return str(metadata.get("requestId") or workers.get("requestId") or "")
''',
    '''def request_id(event: dict[str, Any]) -> str:
    metadata, workers = fields(event)
    identifier = str(metadata.get("requestId") or workers.get("requestId") or "")
    return f"{worker_name(event)}:{identifier}" if identifier else ""
''',
)
replace_once(
    audit,
    '''def worker_name(event: dict[str, Any]) -> str:
    metadata, workers = fields(event)
    return str(metadata.get("service") or workers.get("scriptName") or "unknown")


def live_tail_events()''',
    '''def worker_name(event: dict[str, Any]) -> str:
    metadata, workers = fields(event)
    return str(metadata.get("service") or workers.get("scriptName") or "unknown")


def invocation_class(event: dict[str, Any]) -> str:
    metadata, workers = fields(event)
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
    return STATELESS_CPU_BUDGET_MS


def cpu_limit_outcome(event: dict[str, Any]) -> bool:
    _, workers = fields(event)
    normalized = "".join(character for character in str(workers.get("outcome") or "").lower() if character.isalnum())
    return normalized == "exceededcpu"


def live_tail_events()''',
)
replace_regex(
    audit,
    r'''def detail\(event: dict\[str, Any\]\) -> dict\[str, Any\]:.*?\n\ndef exempt\(''',
    '''def detail(event: dict[str, Any]) -> dict[str, Any]:
    metadata, workers = fields(event)
    worker_event = workers.get("event") if isinstance(workers.get("event"), dict) else {}
    request = worker_event.get("request") if isinstance(worker_event.get("request"), dict) else {}
    source = event.get("source") if isinstance(event.get("source"), dict) else {}
    model = str(workers.get("executionModel") or "stateless")
    message = metadata.get("error") or metadata.get("message") or source.get("message") or "-"
    return {
        "time": str(event.get("timestamp") or metadata.get("timestamp") or "-")[:48],
        "worker": worker_name(event)[:80],
        "version": version_id(event)[:80],
        "source": str(event.get("_diagnostic_source") or "persisted"),
        "cpu_ms": finite(workers.get("cpuTimeMs")),
        "budget_ms": cpu_budget_ms(event),
        "budget_class": invocation_class(event),
        "model": model[:40],
        "outcome": str(workers.get("outcome") or "")[:40],
        "event_type": str(workers.get("eventType") or "-")[:40],
        "message": " ".join(str(message).split())[:220],
        "url": clean_url(metadata.get("url") or request.get("url") or worker_event.get("url")),
    }


def exempt(''',
)
replace_regex(
    audit,
    r'''def evaluate\(.*?\n\ndef self_test\(''',
    '''def evaluate(
    events: list[dict[str, Any]],
    truncated: bool,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], dict[str, list[float]], list[str], bool]:
    violations: list[dict[str, Any]] = []
    exempted: list[dict[str, Any]] = []
    error_items: dict[str, tuple[int, dict[str, Any]]] = {}
    samples: dict[str, list[float]] = {worker: [] for worker in WORKERS}
    for event in events:
        item = detail(event)
        cpu_ms = item["cpu_ms"]
        if item["worker"] in samples and cpu_ms is not None:
            samples[item["worker"]].append(cpu_ms)
        if error_event(event):
            key = request_id(event) or event_key(event)
            priority = error_priority(event)
            current = error_items.get(key)
            if current is None or priority > current[0]:
                error_items[key] = (priority, item)
        terminal_cpu = cpu_limit_outcome(event)
        numeric_overage = cpu_ms is not None and cpu_ms > item["budget_ms"]
        if not terminal_cpu and not numeric_overage:
            continue
        if not terminal_cpu and exempt(event):
            exempted.append(item)
        else:
            violations.append(item)
    errors = [item for _, item in error_items.values()]
    missing = [worker for worker, values in samples.items() if not values]
    return violations, exempted, errors, samples, missing, not truncated and not missing


def stats(values: list[float]) -> dict[str, float | int | None]:
    return {
        "samples": len(values),
        "avg_ms": (sum(values) / len(values)) if values else None,
        "max_ms": max(values) if values else None,
    }


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


def self_test(''',
)
replace_regex(
    audit,
    r'''def self_test\(\) -> int:.*?\n\ndef main\(''',
    '''def self_test() -> int:
    def event(
        identifier: str,
        *,
        timestamp: str,
        version: str,
        cpu: float | None,
        event_type: str,
        model: str = "stateless",
        outcome: str = "ok",
        request: str | None = None,
        level: str | None = None,
        error: str | None = None,
    ) -> dict[str, Any]:
        metadata: dict[str, Any] = {
            "id": identifier,
            "service": "a",
            "requestId": request or identifier,
            "origin": event_type,
        }
        if level:
            metadata["level"] = level
        if error:
            metadata["error"] = error
        workers: dict[str, Any] = {
            "scriptVersion": {"id": version},
            "outcome": outcome,
            "eventType": event_type,
            "executionModel": model,
        }
        if cpu is not None:
            workers["cpuTimeMs"] = cpu
        return {"timestamp": timestamp, "$metadata": metadata, "$workers": workers}

    old = event("old", timestamp="2026-07-22T00:00:00Z", version="v1", cpu=99, event_type="cron")
    persisted_current = event(
        "persisted-current",
        timestamp="2026-07-22T01:00:00Z",
        version="v2",
        cpu=4,
        event_type="fetch",
    )
    live_error = event(
        "live-error",
        timestamp="2026-07-22T01:02:00Z",
        version="v3",
        cpu=3,
        event_type="fetch",
        outcome="exception",
        request="shared-request",
    )
    live_error["_diagnostic_source"] = "live_tail"
    live_error_log = event(
        "live-error-log",
        timestamp="2026-07-22T01:02:00.100Z",
        version="v3",
        cpu=None,
        event_type="fetch",
        request="shared-request",
        level="error",
        error="duplicate console error",
    )
    live_error_log["_diagnostic_source"] = "live_tail"
    cron_overage = event(
        "cron-overage",
        timestamp="2026-07-22T01:03:00Z",
        version="v3",
        cpu=12,
        event_type="cron",
    )
    queue_ok = event(
        "queue-ok",
        timestamp="2026-07-22T01:04:00Z",
        version="v3",
        cpu=37,
        event_type="queue",
    )
    durable_ok = event(
        "durable-ok",
        timestamp="2026-07-22T01:05:00Z",
        version="v3",
        cpu=45,
        event_type="fetch",
        model="durableObject",
    )
    queue_terminal = event(
        "queue-terminal",
        timestamp="2026-07-22T01:06:00Z",
        version="v3",
        cpu=1,
        event_type="queue",
        outcome="exceededCpu",
    )
    original = globals()["WORKERS"]
    globals()["WORKERS"] = ("a",)
    try:
        selected, versions, excluded = current_events(
            [old, persisted_current],
            [live_error, live_error_log, cron_overage, queue_ok, durable_ok, queue_terminal],
        )
        assert versions == {"a": "v3"}
        assert excluded == 2
        assert {version_id(item) for item in selected if version_id(item)} == {"v3"}
        violations, exempted, errors, samples, missing, coverage = evaluate(selected, False)
        assert {item["outcome"] for item in violations} == {"ok", "exceededCpu"}
        assert {item["budget_class"] for item in violations} == {"cron", "queue"}
        assert not exempted
        assert {item["outcome"] for item in errors} == {"exception", "exceededCpu"}
        assert len(errors) == 2
        assert sorted(samples["a"]) == [1.0, 3.0, 12.0, 37.0, 45.0]
        assert not missing and coverage
        assert detail(queue_ok)["budget_class"] == "queue"
        assert detail(queue_ok)["budget_ms"] == QUEUE_CPU_BUDGET_MS
        assert detail(durable_ok)["budget_ms"] == DURABLE_OBJECT_CPU_BUDGET_MS
        assert detail(cron_overage)["budget_ms"] == STATELESS_CPU_BUDGET_MS
        assert timestamp_ms(queue_terminal) > timestamp_ms(persisted_current) > timestamp_ms(old)
    finally:
        globals()["WORKERS"] = original
    print("invocation-aware telemetry audit self-test passed")
    return 0


def main(''',
)
replace_regex(
    audit,
    r'''def main\(\) -> int:.*?\n\nif __name__ == "__main__":''',
    '''def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    if not TOKEN or not ACCOUNT_ID or not WORKERS:
        raise RuntimeError("Cloudflare token, account ID, and Worker list are required")
    end = dt.datetime.now(dt.timezone.utc)
    start = parse_start(end)
    persisted, matching, truncated = query_events(
        ACCOUNT_ID,
        int(start.timestamp() * 1000),
        int(end.timestamp() * 1000),
    )
    live = live_tail_events()
    events, versions, old_versions = current_events(persisted, live)
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
            "stateless_budget_ms": STATELESS_CPU_BUDGET_MS,
            "http_cron_budget_ms": STATELESS_CPU_BUDGET_MS,
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
        f"CPU_POLICY http_cron_budget_ms={STATELESS_CPU_BUDGET_MS:g} "
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
                else STATELESS_CPU_BUDGET_MS
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
        f"- HTTP and Cron CPU policy: `<= {STATELESS_CPU_BUDGET_MS:g} ms` per invocation",
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
                else STATELESS_CPU_BUDGET_MS
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


if __name__ == "__main__":''',
)

workflow = ".github/workflows/hp-observability.yml"
replace_once(
    workflow,
    '''      - '.github/scripts/audit-cloudflare-telemetry.py'
      - '.github/scripts/query-cloudflare-observability.py'
''',
    '''      - '.github/scripts/audit-cloudflare-telemetry.py'
      - '.github/scripts/audit-deployed-cloudflare-telemetry.py'
      - '.github/scripts/query-cloudflare-observability.py'
''',
)
replace_once(
    workflow,
    '''jobs:
  observability:
    if: github.event_name != 'workflow_run' || github.event.workflow_run.conclusion == 'success'
''',
    '''jobs:
  classify:
    name: Select safe diagnostic trigger
    runs-on: ubuntu-latest
    outputs:
      run: ${{ steps.decision.outputs.run }}
    steps:
      - name: Check out push history
        if: github.event_name == 'push'
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
          show-progress: false

      - name: Defer deploy-affecting pushes to workflow_run
        id: decision
        shell: bash
        env:
          EVENT_NAME: ${{ github.event_name }}
          BEFORE_SHA: ${{ github.event.before || '' }}
          HEAD_SHA: ${{ github.sha }}
        run: |
          set -euo pipefail
          if [[ "$EVENT_NAME" != 'push' ]]; then
            echo "run=true" >> "$GITHUB_OUTPUT"
            exit 0
          fi

          if [[ -z "$BEFORE_SHA" || "$BEFORE_SHA" =~ ^0+$ ]]; then
            changed_files="$(git ls-files)"
          else
            changed_files="$(git diff --name-only "$BEFORE_SHA" "$HEAD_SHA")"
          fi
          printf '%s\n' "$changed_files"

          if grep -Eq '^(hp/cloud/|hp/video/src/|hp/video/public/|hp/video/package\.json$|\.github/actions/cloudflare-context/action\.yml$|\.github/scripts/resolve-cloudflare-account\.mjs$|\.github/workflows/cloud-deploy\.yml$|\.github/scripts/assert-actions-only-cloudflare\.mjs$)' <<<"$changed_files"; then
            echo "run=false" >> "$GITHUB_OUTPUT"
            echo "Deferring HomePanel diagnostics until unified Worker deployment completes."
          else
            echo "run=true" >> "$GITHUB_OUTPUT"
          fi

  observability:
    needs: classify
    if: >-
      needs.classify.outputs.run == 'true' &&
      (github.event_name != 'workflow_run' || github.event.workflow_run.conclusion == 'success')
''',
)
replace_once(
    workflow,
    '''      CPU_BUDGET_MS: "10"
      DURABLE_OBJECT_CPU_BUDGET_MS: "30000"
''',
    '''      CPU_BUDGET_MS: "10"
      QUEUE_CPU_BUDGET_MS: "30000"
      DURABLE_OBJECT_CPU_BUDGET_MS: "30000"
''',
)
replace_once(
    workflow,
    '''      - name: Enforce current-version persisted and live CPU policy
        id: telemetry-policy
        continue-on-error: true
        env:
          LIVE_TAIL_LOG: live-tail.log
        shell: bash
        run: |
          set -o pipefail
          actual_summary="$GITHUB_STEP_SUMMARY"
          GITHUB_STEP_SUMMARY=telemetry-summary.md \
            python3 .github/scripts/audit-cloudflare-telemetry.py 2>&1 | tee telemetry-audit.log
          status=${PIPESTATUS[0]}
          if [[ -f telemetry-summary.md ]]; then
            cat telemetry-summary.md >> "$actual_summary"
          fi
          exit "$status"
''',
    '''      - name: Enforce current-deployment persisted and live CPU policy
        id: telemetry-policy
        continue-on-error: true
        env:
          LIVE_TAIL_LOG: live-tail.log
          ACTIVE_WORKER_DEPLOYMENTS_OUTPUT: active-worker-deployments.json
        shell: bash
        run: |
          set -o pipefail
          actual_summary="$GITHUB_STEP_SUMMARY"
          GITHUB_STEP_SUMMARY=telemetry-summary.md \
            python3 .github/scripts/audit-deployed-cloudflare-telemetry.py 2>&1 | tee telemetry-audit.log
          status=${PIPESTATUS[0]}
          if [[ -f telemetry-summary.md ]]; then
            cat telemetry-summary.md >> "$actual_summary"
          fi
          exit "$status"
''',
)
replace_once(
    workflow,
    '''            telemetry-summary.md
            telemetry-audit.log
            live-tail.log
''',
    '''            telemetry-summary.md
            telemetry-audit.log
            active-worker-deployments.json
            live-tail.log
''',
)

publisher = ".github/scripts/publish-homepanel-observability-status.mjs"
replace_once(
    publisher,
    '''  publishCommitStatuses,
  readOptionalText,
''',
    '''  publishCommitStatuses,
  readOptionalJson,
  readOptionalText,
''',
)
replace_once(
    publisher,
    '''const STATUS_CONTEXTS = {
  daily: 'observability/daily-usage-budget',
  d1Insights: 'observability/d1-query-insights',
  query: 'observability/cloudflare-query',
  telemetry: 'observability/telemetry-policy',
};

export function buildIssueBody({
''',
    '''const STATUS_CONTEXTS = {
  daily: 'observability/daily-usage-budget',
  d1Insights: 'observability/d1-query-insights',
  query: 'observability/cloudflare-query',
  telemetry: 'observability/telemetry-policy',
};

function deploymentSummary(activeDeployments) {
  const entries = Object.entries(activeDeployments || {});
  const rows = entries.length
    ? entries.map(([worker, deployment]) => {
        const versions = Array.isArray(deployment?.version_ids)
          ? deployment.version_ids.join(', ')
          : String(deployment?.version_ids || 'unknown');
        return `| \`${worker}\` | \`${deployment?.status || 'unknown'}\` | \`${deployment?.deployment_id || 'unknown'}\` | \`${versions || 'unknown'}\` | ${deployment?.created_on || 'unknown'} |`;
      }).join('\n')
    : '| - | not captured | not captured | not captured | not captured |';
  return `### Active Worker deployments\n\n| Worker | Status | Deployment | Traffic-bearing versions | Deployed at |\n|---|---|---|---|---|\n${rows}`;
}

export function buildIssueBody({
''',
)
replace_once(
    publisher,
    '''  outcomes,
  summaries = {},
}) {
''',
    '''  outcomes,
  summaries = {},
  activeDeployments = {},
}) {
''',
)
replace_once(
    publisher,
    '''- **Commit:** \`${targetSha}\`
- **Workflow run:** ${runUrl}
- **Telemetry and D1 insights lookback:** ${lookbackMinutes} minutes

| Gate | Outcome |
''',
    '''- **Workflow source commit:** \`${targetSha}\`
- **Workflow run:** ${runUrl}
- **Telemetry and D1 insights lookback:** ${lookbackMinutes} minutes

${deploymentSummary(activeDeployments)}

| Gate | Outcome |
''',
)
replace_once(
    publisher,
    '''  const [daily, d1Insights, observability, telemetry] = await Promise.all([
    readOptionalText('daily-usage/summary.md'),
    readOptionalText('d1-insights/summary.md'),
    readOptionalText('observability-summary.md'),
    readOptionalText('telemetry-summary.md'),
  ]);
''',
    '''  const [daily, d1Insights, observability, telemetry, activeDeployments] = await Promise.all([
    readOptionalText('daily-usage/summary.md'),
    readOptionalText('d1-insights/summary.md'),
    readOptionalText('observability-summary.md'),
    readOptionalText('telemetry-summary.md'),
    readOptionalJson('active-worker-deployments.json', {}),
  ]);
''',
)
replace_once(
    publisher,
    '''    outcomes,
    summaries: { daily, d1Insights, observability, telemetry },
  });
''',
    '''    outcomes,
    summaries: { daily, d1Insights, observability, telemetry },
    activeDeployments,
  });
''',
)

unified = ".github/workflows/homepanel-unified-ci.yml"
replace_once(
    unified,
    '''          python3 .github/scripts/audit-cloudflare-telemetry.py --self-test
          python3 .github/scripts/query-cloudflare-d1-costs.py --self-test
''',
    '''          python3 .github/scripts/audit-cloudflare-telemetry.py --self-test
          python3 .github/scripts/audit-deployed-cloudflare-telemetry.py --self-test
          python3 .github/scripts/query-cloudflare-d1-costs.py --self-test
''',
)

api_test = "tests/cloudflare-observability-api.test.mjs"
replace_once(
    api_test,
    '''const deployedAuditScript = readSource('.github/scripts/audit-deployed-cloudflare-telemetry.py');
''',
    '''const deployedAuditScript = readSource('.github/scripts/audit-deployed-cloudflare-telemetry.py');
const deployedAuditUrl = new URL('../.github/scripts/audit-deployed-cloudflare-telemetry.py', import.meta.url);
''',
)
replace_once(
    api_test,
    '''    'DURABLE_OBJECT_CPU_BUDGET_MS',
    'coverage_ok',
''',
    '''    'QUEUE_CPU_BUDGET_MS',
    'DURABLE_OBJECT_CPU_BUDGET_MS',
    'invocation_class',
    'cpu_limit_outcome',
    'budget_class',
    'queue_consumer_budget_ms',
    'coverage_ok',
''',
)
replace_once(
    api_test,
    '''test('telemetry audit filters live and persisted events to one version and deduplicates invocation errors', () => {
  const result = spawnSync('python3', [fileURLToPath(auditUrl), '--self-test'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
''',
    '''test('telemetry audits enforce invocation-specific budgets, deployed versions, and deduplicated errors', () => {
  for (const url of [auditUrl, deployedAuditUrl]) {
    const result = spawnSync('python3', [fileURLToPath(url), '--self-test'], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  }
});
''',
)

contract = "tests/homepanel-observability-contract.test.mjs"
replace_once(
    contract,
    '''import { expectAll, expectNone, readSource } from './helpers/source-contract.mjs';
''',
    '''import { buildIssueBody } from '../.github/scripts/publish-homepanel-observability-status.mjs';
import { expectAll, expectNone, readSource } from './helpers/source-contract.mjs';
''',
)
replace_once(
    contract,
    '''    'DAILY_QUEUE_BUDGET: "10000"',
    'Enforce projected UTC daily Worker, D1, and Queue budgets',
''',
    '''    'DAILY_QUEUE_BUDGET: "10000"',
    'QUEUE_CPU_BUDGET_MS: "30000"',
    'Select safe diagnostic trigger',
    'Defer deploy-affecting pushes to workflow_run',
    'Deferring HomePanel diagnostics until unified Worker deployment completes.',
    'needs.classify.outputs.run',
    'Enforce projected UTC daily Worker, D1, and Queue budgets',
''',
)
replace_once(
    contract,
    '''    'telemetry-summary.md',
    'Publish persistent observability status',
''',
    '''    'telemetry-summary.md',
    'audit-deployed-cloudflare-telemetry.py',
    'ACTIVE_WORKER_DEPLOYMENTS_OUTPUT: active-worker-deployments.json',
    'active-worker-deployments.json',
    'Publish persistent observability status',
''',
)
replace_once(
    contract,
    '''    'python3 .github/scripts/audit-cloudflare-telemetry.py --self-test',
    'python3 .github/scripts/query-cloudflare-d1-costs.py --self-test',
''',
    '''    'python3 .github/scripts/audit-cloudflare-telemetry.py --self-test',
    'python3 .github/scripts/audit-deployed-cloudflare-telemetry.py --self-test',
    'python3 .github/scripts/query-cloudflare-d1-costs.py --self-test',
''',
)
replace_once(
    contract,
    '''    "readOptionalText('telemetry-summary.md')",
    "process.env.LOOKBACK_MINUTES || '60'",
''',
    '''    "readOptionalText('telemetry-summary.md')",
    "readOptionalJson('active-worker-deployments.json', {})",
    'Active Worker deployments',
    'Workflow source commit',
    "process.env.LOOKBACK_MINUTES || '60'",
''',
)
replace_once(
    contract,
    '''  assert.doesNotMatch(publisher, /process\.env\.POLICY_OUTCOME/);
  expectAll(usageDocumentation, [
''',
    '''  assert.doesNotMatch(publisher, /process\.env\.POLICY_OUTCOME/);
  const issueBody = buildIssueBody({
    generatedAt: '2026-07-25T00:00:00.000Z',
    targetSha: 'abc123',
    runUrl: 'https://github.com/tarematsu/HP/actions/runs/1',
    trigger: 'workflow_run',
    lookbackMinutes: '60',
    outcomes: { daily: 'success', d1Insights: 'success', query: 'success', telemetry: 'success' },
    activeDeployments: {
      'homepanel-cloud': {
        status: 'active',
        deployment_id: 'deployment-1',
        version_ids: ['version-1'],
        created_on: '2026-07-25T00:00:00Z',
      },
    },
  });
  assert.match(issueBody, /Workflow source commit.*abc123/s);
  assert.match(issueBody, /Active Worker deployments/);
  assert.match(issueBody, /deployment-1/);
  assert.match(issueBody, /version-1/);
  expectAll(usageDocumentation, [
''',
)

print("Applied HomePanel observability contract fixes")
