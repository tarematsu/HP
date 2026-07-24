const RUNTIME_ENVS = new WeakMap();

export function registerRuntimeEnv(env) {
  const db = env?.DB;
  if (db && (typeof db === 'object' || typeof db === 'function')) {
    RUNTIME_ENVS.set(db, env);
  }
}

export function runtimeEnvForDb(db) {
  return db && (typeof db === 'object' || typeof db === 'function')
    ? RUNTIME_ENVS.get(db) || null
    : null;
}
