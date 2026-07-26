import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activeVersionIdsFromDeploymentPayload,
  durableObjectBindingsFromPayload,
  queueOnlyRuntimeDeployConfig,
  schedulesFromPayload,
  verifyRuntimeDeployment,
} from '../scripts/verify-runtime-deployment.mjs';

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function deployment(version) {
  return {
    success: true,
    result: {
      deployments: [{
        id: `deployment-${version}`,
        versions: [{ version_id: version, percentage: 100 }],
      }],
    },
  };
}

test('temporary runtime deploy config explicitly retires cron and Durable Object surfaces', () => {
  const source = {
    name: 'sh-runtime-orchestrator',
    durable_objects: { bindings: [{ name: 'SCHEDULER_COORDINATOR' }] },
    migrations: [{ tag: 'v1' }],
    vars: { KEEP: true },
  };
  const deployed = queueOnlyRuntimeDeployConfig(source);
  assert.deepEqual(deployed.triggers, { crons: [] });
  assert.equal(deployed.durable_objects, undefined);
  assert.equal(deployed.migrations, undefined);
  assert.deepEqual(deployed.vars, { KEEP: true });
  assert.notEqual(deployed, source);
  assert.notEqual(deployed.vars, source.vars);
});

test('runtime deployment payload keeps only traffic-bearing versions', () => {
  assert.deepEqual(
    [...activeVersionIdsFromDeploymentPayload({
      result: {
        deployments: [{ versions: [
          { version_id: 'old', percentage: 0 },
          { version_id: 'active', percentage: 100 },
        ] }],
      },
    })],
    ['active'],
  );
  assert.deepEqual(schedulesFromPayload({ result: { schedules: [{ cron: '* * * * *' }] } }), [{ cron: '* * * * *' }]);
  assert.equal(durableObjectBindingsFromPayload({
    result: { bindings: [{ name: 'DB', type: 'd1' }, { name: 'COORDINATOR', type: 'durable_object_namespace' }] },
  }).length, 1);
});

test('runtime deployment verification waits for a new version and enforces queue-only architecture', async () => {
  let deploymentReads = 0;
  const result = await verifyRuntimeDeployment({
    accountId: 'account',
    token: 'token',
    scriptName: 'sh-runtime-orchestrator',
    previousVersionIds: ['v1'],
    delayMs: 1,
    sleep: async () => {},
    fetchImpl: async (url) => {
      if (url.endsWith('/deployments')) {
        deploymentReads += 1;
        return response(deployment(deploymentReads === 1 ? 'v1' : 'v2'));
      }
      if (url.endsWith('/schedules')) return response({ success: true, result: { schedules: [] } });
      if (url.endsWith('/settings')) {
        return response({ success: true, result: { bindings: [{ name: 'MINUTE_DB', type: 'd1' }] } });
      }
      throw new Error(`unexpected URL: ${url}`);
    },
  });

  assert.deepEqual(result.previous_version_ids, ['v1']);
  assert.deepEqual(result.active_version_ids, ['v2']);
  assert.equal(result.version_changed, true);
  assert.equal(result.cron_triggers, 0);
  assert.equal(result.durable_object_bindings, 0);
});

test('runtime deployment verification rejects an unchanged active version', async () => {
  await assert.rejects(
    verifyRuntimeDeployment({
      accountId: 'account',
      token: 'token',
      previousVersionIds: ['v1'],
      attempts: 2,
      delayMs: 1,
      sleep: async () => {},
      fetchImpl: async () => response(deployment('v1')),
    }),
    /did not activate a new version/,
  );
});

test('runtime deployment verification rejects retired cron and Durable Object surfaces', async () => {
  await assert.rejects(
    verifyRuntimeDeployment({
      accountId: 'account',
      token: 'token',
      previousVersionIds: ['v1'],
      fetchImpl: async (url) => {
        if (url.endsWith('/deployments')) return response(deployment('v2'));
        if (url.endsWith('/schedules')) {
          return response({ success: true, result: { schedules: [{ cron: '* * * * *' }] } });
        }
        throw new Error(`unexpected URL: ${url}`);
      },
    }),
    /still has cron triggers/,
  );

  await assert.rejects(
    verifyRuntimeDeployment({
      accountId: 'account',
      token: 'token',
      previousVersionIds: ['v1'],
      fetchImpl: async (url) => {
        if (url.endsWith('/deployments')) return response(deployment('v2'));
        if (url.endsWith('/schedules')) return response({ success: true, result: [] });
        if (url.endsWith('/settings')) {
          return response({
            success: true,
            result: { bindings: [{ name: 'SCHEDULER_COORDINATOR', type: 'durable_object_namespace' }] },
          });
        }
        throw new Error(`unexpected URL: ${url}`);
      },
    }),
    /still has Durable Object bindings/,
  );
});
