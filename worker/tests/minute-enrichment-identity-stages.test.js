import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  IDENTITY_ATTACH_STAGE,
  IDENTITY_BITE_STAGE,
  processMinuteIdentityAttach,
  processMinuteIdentityBite,
  processMinuteIdentitySession,
} from '../src/minute-enrichment-identity-stages.js';
import { processOptimizedMinuteEnrichment } from '../src/minute-enrichment-optimized-entry.js';

function identityBody(stage = 'identity') {
  return {
    message_type: 'minute-fact-enrichment',
    message_version: 1,
    stage,
    channel_id: 10,
    station_id: 20,
    minute_at: 120_000,
    observed_at: 125_000,
    provisional_session_id: 25,
    revision_id: 30,
    host_account_id: 40,
    host_handle: 'host',
    broadcast_start_time: 60_000,
    is_broadcasting: 1,
    queue_position: 2,
    track_id: 300,
    queue: {
      queue_id: 50,
      start_time: 60_000,
      tracks: [{ position: 2, spotify_id: 'spotify-2', isrc: 'JPTEST2', bite_count: 9 }],
    },
  };
}

test('identity resolution defers attachment after host and session work', async () => {
  const body = identityBody();
  const events = [];
  let sent = null;
  const result = await processMinuteIdentitySession({ MINUTE_DB: {} }, body, {
    loadCurrentMinute: async () => ({ observed_at: body.observed_at }),
    resolveHost: async () => { events.push('host'); return 41; },
    resolveSession: async () => { events.push('session'); return 26; },
    sendAttachStage: async (_env, message) => { events.push('send'); sent = message; },
  });

  assert.deepEqual(events, ['host', 'session', 'send']);
  assert.equal(result.pending, true);
  assert.equal(result.attach_deferred, true);
  assert.equal(result.session_id, 26);
  assert.equal(sent.stage, IDENTITY_ATTACH_STAGE);
  assert.equal(sent.session_id, 26);
  assert.equal(sent.host_id, 41);
});

test('production identity resolution completes attachment and bite in the same invocation', async () => {
  const body = identityBody();
  const events = [];
  let currentReads = 0;
  const result = await processMinuteIdentitySession({
    MINUTE_DB: {},
    MINUTE_ENRICHMENT_INLINE_PIPELINE_ENABLED: true,
  }, body, {
    loadCurrentMinute: async () => {
      currentReads += 1;
      return { id: 5, observed_at: body.observed_at };
    },
    resolveHost: async () => { events.push('host'); return 41; },
    resolveSession: async () => { events.push('session'); return 26; },
    attachSessionAndFact: async () => { events.push('attach'); },
    writeCurrentBite: async () => { events.push('bite'); return 9; },
    sendAttachStage: async () => { events.push('unexpected-attach-send'); },
    sendBiteStage: async () => { events.push('unexpected-bite-send'); },
  });

  assert.equal(currentReads, 1);
  assert.deepEqual(events, ['host', 'session', 'attach', 'bite']);
  assert.equal(result.pending, false);
  assert.equal(result.stage, IDENTITY_BITE_STAGE);
  assert.equal(result.identity_inlined, true);
  assert.equal(result.attach_inlined, true);
  assert.equal(result.attach_deferred, false);
  assert.equal(result.bite_deferred, false);
  assert.equal(result.bite_count, 9);
});

test('identity attachment commits context then defers bite work by default', async () => {
  const body = {
    ...identityBody(IDENTITY_ATTACH_STAGE),
    session_id: 26,
    host_id: 41,
  };
  const events = [];
  let sent = null;
  const result = await processMinuteIdentityAttach({ MINUTE_DB: {} }, body, {
    loadCurrentMinute: async () => ({ observed_at: body.observed_at }),
    attachSessionAndFact: async () => { events.push('attach'); },
    sendBiteStage: async (_env, message) => { events.push('send'); sent = message; },
  });

  assert.deepEqual(events, ['attach', 'send']);
  assert.equal(result.pending, true);
  assert.equal(result.bite_deferred, true);
  assert.equal(sent.stage, IDENTITY_BITE_STAGE);
  assert.equal(sent.session_id, 26);
  assert.equal(sent.host_id, 41);
  assert.equal(Object.hasOwn(sent, 'host_handle'), false);
});

test('legacy identity-only flag still completes bite work without another Queue message', async () => {
  const body = {
    ...identityBody(IDENTITY_ATTACH_STAGE),
    session_id: 26,
    host_id: 41,
  };
  const events = [];
  const result = await processMinuteIdentityAttach({
    MINUTE_DB: {},
    MINUTE_IDENTITY_INLINE_BITE_ENABLED: true,
  }, body, {
    loadCurrentMinute: async () => ({ id: 5, observed_at: body.observed_at }),
    attachSessionAndFact: async () => { events.push('attach'); },
    writeCurrentBite: async () => { events.push('bite'); return 9; },
    sendBiteStage: async () => { events.push('unexpected-send'); },
  });

  assert.deepEqual(events, ['attach', 'bite']);
  assert.equal(result.pending, false);
  assert.equal(result.stage, IDENTITY_BITE_STAGE);
  assert.equal(result.attach_inlined, true);
  assert.equal(result.bite_deferred, false);
  assert.equal(result.bite_count, 9);
});

test('identity attachment skips writes when canonical session values are already present', async () => {
  const body = {
    ...identityBody(IDENTITY_ATTACH_STAGE),
    session_id: 26,
    host_id: 41,
  };
  const statements = [];
  const db = {
    prepare(sql) {
      return {
        sql,
        params: [],
        bind(...params) { this.params = params; return this; },
      };
    },
    async batch(active) { statements.push(...active); },
  };

  await processMinuteIdentityAttach({ MINUTE_DB: db }, body, {
    loadCurrentMinute: async () => ({ id: 5, observed_at: body.observed_at }),
    sendBiteStage: async () => {},
  });

  assert.equal(statements.length, 3);
  assert.match(statements[0].sql, /broadcast_session_id IS NULL/);
  assert.match(statements[1].sql, /session_id IS NOT \?/);
  assert.match(statements[2].sql, /session_id IS NOT \?/);
  assert.equal(statements[1].params.at(-1), 26);
  assert.equal(statements[2].params.at(-1), 26);
});

test('identity bite stage performs only the canonical counter write', async () => {
  const body = {
    ...identityBody(IDENTITY_BITE_STAGE),
    session_id: 26,
    host_id: 41,
  };
  let input = null;
  const result = await processMinuteIdentityBite({ MINUTE_DB: {} }, body, {
    loadCurrentMinute: async () => ({ observed_at: body.observed_at }),
    writeCurrentBite: async (_db, value) => { input = value; return 9; },
  });

  assert.equal(result.pending, false);
  assert.equal(result.bite_count, 9);
  assert.equal(result.session_id, 26);
  assert.equal(result.queue_position, 2);
  assert.equal(result.track_id, 300);
  assert.equal(input.revisionId, 30);
  assert.equal(input.position, 2);
  assert.equal(input.trackId, 300);
});

test('all identity stages reject an older minute winner before mutation', async () => {
  let mutations = 0;
  const stale = async () => ({ observed_at: 126_000 });
  const session = await processMinuteIdentitySession({ MINUTE_DB: {} }, identityBody(), {
    loadCurrentMinute: stale,
    resolveHost: async () => { mutations += 1; },
  });
  const attach = await processMinuteIdentityAttach({ MINUTE_DB: {} }, {
    ...identityBody(IDENTITY_ATTACH_STAGE),
    session_id: 26,
    host_id: 41,
  }, {
    loadCurrentMinute: stale,
    attachSessionAndFact: async () => { mutations += 1; },
  });
  const bite = await processMinuteIdentityBite({ MINUTE_DB: {} }, identityBody(IDENTITY_BITE_STAGE), {
    loadCurrentMinute: stale,
    writeCurrentBite: async () => { mutations += 1; },
  });
  assert.equal(session.reason, 'stale-minute-winner');
  assert.equal(attach.reason, 'stale-minute-winner');
  assert.equal(bite.reason, 'stale-minute-winner');
  assert.equal(mutations, 0);
});

test('optimized router sends production identity through all supported stages', async () => {
  const body = identityBody();
  let sessionCalls = 0;
  let attachCalls = 0;
  let biteCalls = 0;
  await processOptimizedMinuteEnrichment({}, body, {
    processMinuteIdentitySession: async (_env, value) => {
      sessionCalls += 1;
      assert.equal(value.queue.tracks[0].spotify_id, 'spotify-2');
      return { stage: 'identity', pending: true };
    },
  });
  await processOptimizedMinuteEnrichment({}, {
    ...body,
    stage: IDENTITY_ATTACH_STAGE,
  }, {
    processMinuteIdentityAttach: async (_env, value) => {
      attachCalls += 1;
      assert.equal(value.queue.tracks[0].isrc, 'JPTEST2');
      return { stage: IDENTITY_ATTACH_STAGE, pending: true };
    },
  });
  await processOptimizedMinuteEnrichment({}, {
    ...body,
    stage: IDENTITY_BITE_STAGE,
  }, {
    processMinuteIdentityBite: async (_env, value) => {
      biteCalls += 1;
      assert.equal(value.queue.tracks[0].bite_count, 9);
      return { stage: IDENTITY_BITE_STAGE, pending: false };
    },
  });
  assert.equal(sessionCalls, 1);
  assert.equal(attachCalls, 1);
  assert.equal(biteCalls, 1);
});

test('runtime enables one-invocation enrichment completion', () => {
  const runtime = JSON.parse(readFileSync(new URL('../wrangler.runtime.jsonc', import.meta.url), 'utf8'));
  assert.equal(runtime.vars.MINUTE_ENRICHMENT_INLINE_PIPELINE_ENABLED, true);
  assert.equal(Object.hasOwn(runtime.vars, 'MINUTE_IDENTITY_INLINE_BITE_ENABLED'), false);
});
