import { sanitizeFailureDetail } from './collector-failure.js';

const MAX_RESULT_DEPTH = 5;

function nonEmpty(value) {
  return value != null && String(value).trim() !== '';
}

export function findSoftFailure(value, path = 'result') {
  let current = value;
  let currentPath = path;
  for (let depth = 0; depth < MAX_RESULT_DEPTH; depth += 1) {
    if (!current || typeof current !== 'object') return null;
    const hasError = nonEmpty(current.error);
    if (current.failed === true || current.ok === false || hasError) {
      const fallback = current.failed === true
        ? 'returned failed=true'
        : current.ok === false
          ? 'returned ok=false'
          : 'returned an error';
      return {
        path: currentPath,
        error: sanitizeFailureDetail(hasError ? current.error : `${currentPath} ${fallback}`),
      };
    }
    current = current.result;
    currentPath = `${currentPath}.result`;
  }
  return null;
}

export function throwIfSoftFailure(value, context = 'operation') {
  const failure = findSoftFailure(value, context);
  if (!failure) return value;
  throw new Error(`${failure.path} failed: ${failure.error || 'unknown failure'}`);
}
