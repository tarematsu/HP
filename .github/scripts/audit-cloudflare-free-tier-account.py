#!/usr/bin/env python3
"""Run the account-wide Cloudflare budget audit without resource enumeration."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

TARGET = Path(__file__).with_name("audit-cloudflare-free-tier.py")
SPEC = importlib.util.spec_from_file_location("cloudflare_account_budget_audit", TARGET)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Could not load account-wide audit from {TARGET}")
audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit)


def configured_resource_ids(_account: str, queue_names: set[str]):
    """Return configured identities; account-wide GraphQL does not filter by IDs."""
    return (
        set(queue_names),
        set(audit.core.DO_BINDINGS),
        set(audit.core.KV_BINDINGS),
    )


def self_test() -> int:
    assert configured_resource_ids("account", {"queue"}) == (
        {"queue"},
        set(audit.core.DO_BINDINGS),
        set(audit.core.KV_BINDINGS),
    )
    assert audit.self_test() == 0
    print("account-wide discovery-free audit self-test passed")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    audit.core.resource_ids = configured_resource_ids
    print(
        "::notice title=Account-wide Cloudflare audit::"
        "Skipping Queue/DO/KV REST enumeration; GraphQL meters are account-wide"
    )
    return audit.main()


if __name__ == "__main__":
    raise SystemExit(main())
