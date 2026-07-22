import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd(), '..');
const workflow = readFileSync(resolve(root, '.github/workflows/fetch-cloudflare-observability.yml'), 'utf8');
const daily = readFileSync(resolve(root, '.github/scripts/audit-cloudflare-daily-usage.py'), 'utf8');
const telemetry = readFileSync(resolve(root, '.github/scripts/audit-cloudflare-telemetry.py'), 'utf8');

describe('Cloudflare observability policy', () => {
  it('uses lightweight hourly budgets and post-deploy plus daily deep checks', () => {
    expect(workflow).toMatch(/workflows: \["Deploy unified homepanel-cloud Worker"\]/);
    expect(workflow).toMatch(/cron: "23 \* \* \* \*"/);
    expect(workflow).toMatch(/cron: "47 2 \* \* \*"/);
    expect(workflow).not.toMatch(/^\s+pull_request:/m);
    expect(workflow).not.toMatch(/^\s+push:/m);
    expect(workflow).toMatch(/github\.event\.schedule == '47 2 \* \* \*'/);
    expect(workflow).toMatch(/LIVE_TAIL_SECONDS: "90"/);
    expect(workflow).toMatch(/LIVE_TAIL_LOG: live-tail\.log/);
  });

  it('enforces the requested HP daily limits without an artificial request reserve', () => {
    expect(workflow).toMatch(/DAILY_REQUEST_BUDGET: "3000"/);
    expect(workflow).toMatch(/DAILY_REQUEST_RESERVE: "0"/);
    expect(workflow).toMatch(/DAILY_D1_READ_BUDGET: "50000"/);
    expect(workflow).toMatch(/DAILY_D1_WRITE_BUDGET: "3000"/);
    expect(daily).toMatch(/workersInvocationsAdaptive/);
    expect(daily).toMatch(/d1AnalyticsAdaptiveGroups/);
    expect(daily).toMatch(/rowsRead rowsWritten/);
    expect(daily).toMatch(/apply_request_reserve/);
  });

  it('propagates policy failures and avoids hourly success artifacts', () => {
    expect(workflow.match(/set -o pipefail/g)).toHaveLength(2);
    expect(workflow).toMatch(/failure\(\) \|\| github\.event_name != 'schedule'/);
    expect(workflow).toMatch(/retention-days: 1/);
  });

  it('audits only the newest deployed version with live-tail coverage', () => {
    expect(telemetry).toMatch(/scriptVersion/);
    expect(telemetry).toMatch(/fromisoformat/);
    expect(telemetry).toMatch(/old_version_invocations_excluded/);
    expect(telemetry).toMatch(/LIVE_TAIL_EVENT=/);
    expect(telemetry).toMatch(/missing_workers/);
    expect(telemetry).toMatch(/DURABLE_OBJECT_CPU_BUDGET_MS/);
    expect(telemetry).not.toMatch(/R2_BUCKET|aws s3/);
  });
});
