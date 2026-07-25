#!/usr/bin/env python3
"""Run the account-wide Cloudflare included-usage audit."""

from __future__ import annotations

import sys

from cloudflare_free_tier_audit import main, self_test


if __name__ == "__main__":
    try:
        raise SystemExit(self_test() if "--self-test" in sys.argv else main())
    except Exception as error:
        print(
            "::error title=Cloudflare free-tier budget audit::"
            + str(error).replace("\n", " ")[:1000]
        )
        raise
