const QUEUE_OPERATION_BY_BINDING = Object.freeze({
  RAW_COLLECTION_QUEUE: 'raw-collection',
  PERSIST_QUEUE: 'buddies-persist',
  INGEST_FINALIZE_QUEUE: 'ingest-finalize',
  COMMENTS_QUEUE: 'comments',
  HOST_MONITOR_QUEUE: 'host-monitor',
  MINUTE_FACT_QUEUE: 'minute-fact',
  MINUTE_DERIVE_QUEUE: 'minute-derive',
  MINUTE_LIVE_DERIVE_QUEUE: 'minute-live-derive',
  MINUTE_ENRICHMENT_QUEUE: 'minute-enrichment',
  MINUTE_REBUILD_QUEUE: 'minute-rebuild',
  TRACK_METADATA_QUEUE: 'track-metadata',
  READ_MODEL_QUEUE: 'read-model',
  PAGES_READ_MODEL_QUEUE: 'pages-read-model',
  SAKURAZAKA_QUEUE: 'sakurazaka-cycle',
});

function attributedBody(body, producerWorker, operationName) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  return {
    ...body,
    producer_worker: body.producer_worker || producerWorker,
    operation_name: body.operation_name || operationName,
  };
}

function attributedQueue(queue, producerWorker, operationName) {
  if (!queue || (typeof queue !== 'object' && typeof queue !== 'function')) return queue;
  return new Proxy(queue, {
    get(target, property) {
      if (property === 'send' && typeof target.send === 'function') {
        return (body, options) => target.send(
          attributedBody(body, producerWorker, operationName),
          options,
        );
      }
      if (property === 'sendBatch' && typeof target.sendBatch === 'function') {
        return (entries) => target.sendBatch((Array.isArray(entries) ? entries : []).map((entry) => ({
          ...entry,
          body: attributedBody(entry?.body, producerWorker, operationName),
        })));
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export function queueAttributedEnv(env = {}, producerWorker = 'unknown') {
  const active = Object.create(env || null);
  for (const [binding, operationName] of Object.entries(QUEUE_OPERATION_BY_BINDING)) {
    const queue = env?.[binding];
    if (!queue) continue;
    Object.defineProperty(active, binding, {
      value: attributedQueue(queue, producerWorker, operationName),
      enumerable: true,
      configurable: true,
    });
  }
  return active;
}

export { QUEUE_OPERATION_BY_BINDING };
