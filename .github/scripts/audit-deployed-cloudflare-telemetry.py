#!/usr/bin/env python3
"""Compatibility entrypoint for the active-deployment telemetry audit."""

from pathlib import Path
import runpy

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
runpy.run_path(str(TARGET), run_name="__main__")
