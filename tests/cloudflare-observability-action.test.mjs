import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const action = read('.github/actions/cloudflare-observability-query/action.yml');
const workflows = {
  sh: read('.github/workflows/sh-observability.yml'),
  hp: read('.github/workflows/hp-observability.yml'),
};

test('shared observability action owns parallel query orchestration', () => {
  assert.match(action, /python3 \.github\/scripts\/query-cloudflare-observability\.py/);
  assert.match(action, /node \.github\/scripts\/capture-cloudflare-live-tail\.mjs/);
  assert.match(action, /wait "\$query_pid" \|\| query_status=\$\?/);
  assert.match(action, /wait "\$tail_pid" \|\| true/);
  assert.match(action, /exit "\$query_status"/);
});

test('SH and HomePanel workflows use and retrigger the shared action', () => {
  for (const [name, workflow] of Object.entries(workflows)) {
    assert.match(
      workflow,
      /^\s{6}- '\.github\/actions\/cloudflare-observability-query\/action\.yml'$/m,
      `${name} trigger path`,
    );
    assert.match(
      workflow,
      /^\s{8}uses: \.\/\.github\/actions\/cloudflare-observability-query$/m,
      `${name} shared action`,
    );
    assert.doesNotMatch(workflow, /query_pid=\$!/, `${name} inline orchestration`);
  }
  assert.match(workflows.sh, /^\s{10}live-tail-worker: sh-runtime-orchestrator$/m);
  assert.match(workflows.hp, /^\s{10}live-tail-worker: homepanel-cloud$/m);
  assert.match(workflows.hp, /^\s{10}live-tail-probes: \/v1\/health,\/$/m);
});
