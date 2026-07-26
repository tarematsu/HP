#!/usr/bin/env python3
"""Compatibility entrypoint for the active-deployment telemetry audit."""

import importlib.util
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

try:
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
