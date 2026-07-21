import assert from 'node:assert/strict';
import test from 'node:test';

import {
  consumeManualImportMessage,
  MANUAL_IMPORT_QUEUE_BINDING,
  MANUAL_IMPORT_QUEUE_NAME,
  MANUAL_IMPORT_RECOVERY_MESSAGE_TYPE,
  manualImportQueueMessage,
  publishManualImportJob
} from '../src/manual-import-queue.js';

const JOB_ID = '00000000-0000-4000-8000-000000000092';
const SECOND_JOB_ID = '00000000-0000-4000-8000-000000000093';

function queueMessage(body = manualImportQueueMessage(JOB_ID), attempts = 1) {
  return {
    id: 'message-1',
    body,
    attempts,
    acknowledgements: 0,
    retries: [],
    ack() {
      this.acknowledgements += 1;
    },
    retry(options) {
      this.retries.push(options);
    }
  };
}

test('manual import queue publisher sends only the durable D1 job ID', async () => {
  const sent = [];
  const env = {
    [MANUAL_IMPORT_QUEUE_BINDING]: {
      async send(body, options) {
        sent.push({ body, options });
      }
    }
  };

  await publishManualImportJob(env, JOB_ID);
  await publishManualImportJob(env, JOB_ID, { delaySeconds: 5 });

  assert.equal(MANUAL_IMPORT_QUEUE_NAME, 'videoscraper-manual-imports');
  assert.deepEqual(sent, [
    { body: { type: 'manual-import-job', jobId: JOB_ID }, options: undefined },
    { body: { type: 'manual-import-job', jobId: JOB_ID }, options: { delaySeconds: 5 } }
  ]);
  assert.equal('urls' in sent[0].body, false);
});

test('a cutover recovery message republishes active D1 job IDs and then acknowledges', async () => {
  const message = queueMessage({ type: MANUAL_IMPORT_RECOVERY_MESSAGE_TYPE });
  const published = [];
  const result = await consumeManualImportMessage(message, { DB: {} }, {
    async recoverJobs() {
      return [JOB_ID, SECOND_JOB_ID];
    },
    async publish(_env, jobId) {
      published.push(jobId);
    }
  });

  assert.equal(result.recovery, true);
  assert.equal(result.recoveredJobs, 2);
  assert.deepEqual(published, [JOB_ID, SECOND_JOB_ID]);
  assert.equal(message.acknowledgements, 1);
  assert.deepEqual(message.retries, []);
});

test('a failed cutover recovery message is retried without acknowledgement', async () => {
  const message = queueMessage({ type: MANUAL_IMPORT_RECOVERY_MESSAGE_TYPE }, 2);
  const result = await consumeManualImportMessage(message, { DB: {} }, {
    async recoverJobs() {
      throw new Error('temporary D1 failure');
    }
  });

  assert.equal(result.recovery, true);
  assert.equal(result.retry, true);
  assert.equal(message.acknowledgements, 0);
  assert.deepEqual(message.retries, [{ delaySeconds: 30 }]);
});

test('a pending D1 job publishes exactly one next-step message before acknowledgement', async () => {
  const message = queueMessage();
  const calls = [];
  const result = await consumeManualImportMessage(message, { DB: {} }, {
    async runJob(_env, options) {
      calls.push({ kind: 'run', options });
      return { ok: true, idle: false, completed: false, status: 'pending', jobId: JOB_ID };
    },
    async publish(_env, jobId, options) {
      calls.push({ kind: 'publish', jobId, options });
    }
  });

  assert.equal(result.completed, false);
  assert.deepEqual(calls, [
    { kind: 'run', options: { jobId: JOB_ID } },
    { kind: 'publish', jobId: JOB_ID, options: { delaySeconds: 0 } }
  ]);
  assert.equal(message.acknowledgements, 1);
  assert.deepEqual(message.retries, []);
});

test('completed jobs are acknowledged without publishing another message', async () => {
  const message = queueMessage();
  let publishes = 0;
  const result = await consumeManualImportMessage(message, { DB: {} }, {
    async runJob() {
      return { ok: true, idle: false, completed: true, status: 'completed', jobId: JOB_ID };
    },
    async publish() {
      publishes += 1;
    }
  });

  assert.equal(result.completed, true);
  assert.equal(publishes, 0);
  assert.equal(message.acknowledgements, 1);
});

test('an active D1 lock retries the Queue message after the lock TTL instead of orphaning the job', async () => {
  const message = queueMessage();
  const result = await consumeManualImportMessage(message, { DB: {} }, {
    async runJob() {
      return { ok: true, idle: true, processed: false, completed: false };
    },
    async readJob() {
      return { jobId: JOB_ID, status: 'processing' };
    }
  });

  assert.equal(result.retry, true);
  assert.equal(result.status, 'processing');
  assert.equal(message.acknowledgements, 0);
  assert.deepEqual(message.retries, [{ delaySeconds: 300 }]);
});

test('an idle duplicate for a completed D1 job is acknowledged', async () => {
  const message = queueMessage();
  const result = await consumeManualImportMessage(message, { DB: {} }, {
    async runJob() {
      return { ok: true, idle: true, processed: false, completed: false };
    },
    async readJob() {
      return { jobId: JOB_ID, status: 'completed' };
    }
  });

  assert.equal(result.completed, true);
  assert.equal(message.acknowledgements, 1);
  assert.deepEqual(message.retries, []);
});

test('retryable failures use Queue redelivery while D1 remains the source of truth', async () => {
  const message = queueMessage(undefined, 2);
  const result = await consumeManualImportMessage(message, { DB: {} }, {
    async runJob() {
      throw new Error('temporary failure');
    },
    async readJob() {
      return { jobId: JOB_ID, status: 'pending' };
    }
  });

  assert.equal(result.retry, true);
  assert.equal(message.acknowledgements, 0);
  assert.deepEqual(message.retries, [{ delaySeconds: 30 }]);
});

test('jobs already marked failed in D1 are acknowledged and stop redelivery', async () => {
  const message = queueMessage();
  const result = await consumeManualImportMessage(message, { DB: {} }, {
    async runJob() {
      throw new Error('third failure');
    },
    async readJob() {
      return { jobId: JOB_ID, status: 'failed' };
    }
  });

  assert.equal(result.failed, true);
  assert.equal(message.acknowledgements, 1);
  assert.deepEqual(message.retries, []);
});

test('malformed Queue messages are acknowledged without touching D1', async () => {
  const message = queueMessage({ type: 'manual-import-job', jobId: 'invalid' });
  let runs = 0;
  const result = await consumeManualImportMessage(message, { DB: {} }, {
    async runJob() {
      runs += 1;
    }
  });

  assert.equal(result.invalid, true);
  assert.equal(runs, 0);
  assert.equal(message.acknowledgements, 1);
});
