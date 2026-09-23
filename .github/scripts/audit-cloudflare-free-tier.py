#!/usr/bin/env python3
"""Run the account-wide Cloudflare included-usage audit."""

from __future__ import annotations

import sys

from cloudflare_d1_storage import append_d1_storage_diagnostics, self_test as d1_storage_self_test
from cloudflare_queue_dimension_compat import main, self_test


def run() -> int:
    budget_status = main()
    try:
        append_d1_storage_diagnostics()
    except Exception as error:
        print(
            "::warning title=D1 storage diagnostics::"
            + str(error).replace("\n", " ")[:1000]
        )
    return budget_status


if __name__ == "__main__":
    try:
        if "--self-test" in sys.argv:
            self_test()
            raise SystemExit(d1_storage_self_test())
        raise SystemExit(run())
    except Exception as error:
        print(
            "::error title=Cloudflare free-tier budget audit::"
            + str(error).replace("\n", " ")[:1000]
        )
        raise
