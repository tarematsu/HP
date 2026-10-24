#!/usr/bin/env python3
"""Run the account-wide Cloudflare included-usage audit."""

from __future__ import annotations

import sys

from cloudflare_d1_storage import append_d1_storage_diagnostics, self_test as d1_storage_self_test
from cloudflare_queue_dimension_compat import main, self_test


def exit_status_for_storage_coverage(budget_status: int, storage: dict) -> int:
    if budget_status != 0:
        return budget_status
    return 0 if storage.get("complete") is True else 1


def run() -> int:
    budget_status = main()
    try:
        storage = append_d1_storage_diagnostics()
    except Exception as error:
        print(
            "::error title=D1 storage diagnostics unavailable::"
            + str(error).replace("\n", " ")[:1000]
        )
        return 1 if budget_status == 0 else budget_status
    if not storage.get("complete"):
        available = int(storage.get("availableCount") or 0)
        total = int(storage.get("databaseCount") or 0)
        print(
            "::error title=D1 storage coverage incomplete::"
            f"available={available} total={total}; capacity totals are not complete"
        )
    return exit_status_for_storage_coverage(budget_status, storage)


if __name__ == "__main__":
    try:
        if "--self-test" in sys.argv:
            self_test()
            assert exit_status_for_storage_coverage(0, {"complete": True}) == 0
            assert exit_status_for_storage_coverage(0, {"complete": False}) == 1
            assert exit_status_for_storage_coverage(2, {"complete": False}) == 2
            raise SystemExit(d1_storage_self_test())
        raise SystemExit(run())
    except Exception as error:
        print(
            "::error title=Cloudflare free-tier budget audit::"
            + str(error).replace("\n", " ")[:1000]
        )
        raise
