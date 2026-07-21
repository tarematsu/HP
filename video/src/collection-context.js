const collectionContexts = new WeakMap();

export function setCollectionContext(env, context) {
  if (env && (typeof env === 'object' || typeof env === 'function')) {
    collectionContexts.set(env, context);
  }
}

export function getCollectionContext(env) {
  return env && (typeof env === 'object' || typeof env === 'function')
    ? collectionContexts.get(env) || null
    : null;
}

export function clearCollectionContext(env) {
  if (env && (typeof env === 'object' || typeof env === 'function')) {
    collectionContexts.delete(env);
  }
}
