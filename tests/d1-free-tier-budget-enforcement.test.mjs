import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const dailyScript = fileURLToPath(
  new URL('../scripts/enforce-d1-free-tier-budget.mjs', import.meta.url),
);
const hourlyScript = fileURLToPath(
  new URL('../scripts/enforce-d1-hourly-free-tier-budget.mjs', import.meta.url),
);

function withTempDirectory(run) {
  const directory = mkdtempSync(join(tmpdir(), 'sh-d1-budget-'));
  try {
    return run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runHourly(directory, report) {
  const outputDirectory = join(directory, 'd1-usage');
  mkdirSync(outputDirectory);
  writeFileSync(join(outputDirectory, 'hourly-summary.json'), JSON.stringify(report));
  const result = spawnSync(process.execPath, [hourlyScript], {
    cwd: directory,
    encoding: 'utf8',
  });
  const updated = JSON.parse(readFileSync(join(outputDirectory, 'hourly-summary.json'), 'utf8'));
  return { result, updated };
}

test('daily D1 planning usage must stay strictly below 100 percent free-tier ceiling', () => {
  withTempDirectory((directory) => {
    const reportPath = join(directory, 'summary.json');
    writeFileSync(reportPath, JSON.stringify({
      limits: { free: { rowsRead: 1_000, rowsWritten: 100 } },
      planningEstimate: { rowsRead: 1_000, rowsWritten: 99 },
    }));
    const result = spawnSync(process.execPath, [dailyScript], {
      cwd: directory,
      env: { ...process.env, D1_USAGE_REPORT: reportPath },
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /rows read 1000 >= 1000/);
  });
});

test('daily D1 planning usage below 100 percent free-tier ceiling passes', () => {
  withTempDirectory((directory) => {
    const reportPath = join(directory, 'summary.json');
    writeFileSync(reportPath, JSON.stringify({
      limits: { free: { rowsRead: 1_000, rowsWritten: 100 } },
      planningEstimate: { rowsRead: 999, rowsWritten: 99 },
    }));
    const result = spawnSync(process.execPath, [dailyScript], {
      cwd: directory,
      env: { ...process.env, D1_USAGE_REPORT: reportPath },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
  });
});

test('reported rolling-window D1 usage at 100 percent free-tier ceiling fails', () => {
  withTempDirectory((directory) => {
    const { result } = runHourly(directory, {
      observed: { rowsRead: 1_000, rowsWritten: 99 },
      limits: { targetPerWindow: { rowsRead: 1_000, rowsWritten: 100 } },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /rows read 1000 >= 1000/);
  });
});

test('reported rolling-window D1 usage below 100 percent free-tier ceiling passes', () => {
  withTempDirectory((directory) => {
    const { result } = runHourly(directory, {
      observed: { rowsRead: 999, rowsWritten: 99 },
      limits: { targetPerWindow: { rowsRead: 1_000, rowsWritten: 100 } },
    });
    assert.equal(result.status, 0, result.stderr);
  });
});

test('post-deploy writes use the hourly allowance while reads stay window-proportional', () => {
  withTempDirectory((directory) => {
    const { result, updated } = runHourly(directory, {
      generatedAt: '2026-07-22T00:20:00.000Z',
      window: {
        start: '2026-07-22T00:14:00.000Z',
        end: '2026-07-22T00:20:00.000Z',
      },
      limits: {
        freePerDay: { rowsRead: 5_000_000, rowsWritten: 100_000 },
        targetRatio: 1,
        targetPerHour: { rowsRead: 208_333.34, rowsWritten: 4_166.67 },
      },
      buckets: [{
        bucket: '2026-07-22T00:15:00.000Z',
        rowsRead: 8_000,
        rowsWritten: 258,
        readQueries: 10,
        writeQueries: 20,
      }],
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(updated.budgetGate.targetBasis.rowsRead, 'measured-window');
    assert.equal(updated.budgetGate.targetBasis.rowsWritten, 'hourly-burst-allowance');
    assert.equal(Math.floor(updated.budgetGate.target.rowsRead), 17_361);
    assert.equal(Math.floor(updated.budgetGate.target.rowsWritten), 4_166);
  });
});

test('post-deploy full scans still fail the proportional read allowance', () => {
  withTempDirectory((directory) => {
    const { result } = runHourly(directory, {
      generatedAt: '2026-07-22T00:20:00.000Z',
      window: {
        start: '2026-07-22T00:14:00.000Z',
        end: '2026-07-22T00:20:00.000Z',
      },
      limits: {
        freePerDay: { rowsRead: 5_000_000, rowsWritten: 100_000 },
        targetRatio: 1,
      },
      buckets: [{
        bucket: '2026-07-22T00:15:00.000Z',
        rowsRead: 2_300_000,
        rowsWritten: 258,
      }],
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /rows read 2300000 >= 17361/);
  });
});

test('post-deploy writes at the hourly allowance fail strictly', () => {
  withTempDirectory((directory) => {
    const { result } = runHourly(directory, {
      generatedAt: '2026-07-22T00:20:00.000Z',
      window: {
        start: '2026-07-22T00:14:00.000Z',
        end: '2026-07-22T00:20:00.000Z',
      },
      limits: {
        freePerDay: { rowsRead: 5_000_000, rowsWritten: 100_000 },
        targetRatio: 1,
      },
      buckets: [{
        bucket: '2026-07-22T00:15:00.000Z',
        rowsRead: 1,
        rowsWritten: 4_167,
      }],
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /rows written 4167 >= 4166/);
  });
});
