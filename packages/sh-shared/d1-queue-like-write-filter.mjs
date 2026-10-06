const SKIP_QUEUE_ITEM_LIKE_MIRROR = Symbol('skip-queue-item-like-mirror');
const QUEUE_ITEM_LIKE_UPDATE = /UPDATE\s+sh_queue_items\s+SET\s+bite_count\s*=\s*\?/i;

function skippedStatement(statement) {
  return new Proxy(statement, {
    get(target, property) {
      if (property === SKIP_QUEUE_ITEM_LIKE_MIRROR) return true;
      if (property === 'bind') {
        return (...args) => skippedStatement(target.bind(...args));
      }
      if (property === 'run') {
        return async () => ({ success: true, meta: { changes: 0 } });
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export function withoutQueueItemLikeMirrors(db) {
  if (!db?.prepare) return db;
  return new Proxy(db, {
    get(target, property) {
      if (property === 'prepare') {
        return (sql) => {
          const statement = target.prepare(sql);
          return QUEUE_ITEM_LIKE_UPDATE.test(String(sql))
            ? skippedStatement(statement)
            : statement;
        };
      }
      if (property === 'batch') {
        return async (statements) => {
          const source = Array.isArray(statements) ? statements : [];
          const active = [];
          const activeIndexes = [];
          const results = source.map((statement, index) => {
            if (statement?.[SKIP_QUEUE_ITEM_LIKE_MIRROR]) {
              return { success: true, meta: { changes: 0 } };
            }
            active.push(statement);
            activeIndexes.push(index);
            return null;
          });
          const activeResults = active.length ? await target.batch(active) : [];
          for (let index = 0; index < activeIndexes.length; index += 1) {
            results[activeIndexes[index]] = activeResults[index];
          }
          return results;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
