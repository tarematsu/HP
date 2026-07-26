import { execFileSync as defaultExecFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';

function jsonStartIndexes(text) {
  const indexes = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '[' || text[index] === '{') indexes.push(index);
  }
  return indexes;
}

export function parseWranglerD1Json(output) {
  const text = String(output || '').trim();
  if (!text) throw new Error('Wrangler returned an empty D1 response');
  for (const index of jsonStartIndexes(text)) {
    try {
      return JSON.parse(text.slice(index));
    } catch {
      // Wrangler may print a banner or warning before its JSON payload.
    }
  }
  throw new Error(`Wrangler did not return valid D1 JSON: ${text.slice(0, 500)}`);
}

function appendResultEntries(value, entries) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) appendResultEntries(item, entries);
    return;
  }
  if (Array.isArray(value.result)) {
    for (const item of value.result) appendResultEntries(item, entries);
    return;
  }
  if (value.result && typeof value.result === 'object'
      && (Array.isArray(value.result.results) || value.result.meta || 'success' in value.result)) {
    appendResultEntries(value.result, entries);
    return;
  }
  if (Array.isArray(value.results) || value.meta || 'success' in value) entries.push(value);
}

export function wranglerD1Results(output) {
  const entries = [];
  appendResultEntries(parseWranglerD1Json(output), entries);
  return entries.map((entry) => ({
    success: entry.success !== false,
    results: Array.isArray(entry.results) ? entry.results : [],
    meta: entry.meta && typeof entry.meta === 'object' ? entry.meta : {},
  }));
}

function sqlValue(value) {
  if (value == null) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('D1 binding must be a finite number');
    return String(value);
  }
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`;
  return `'${String(value).replaceAll('\u0000', '').replaceAll("'", "''")}'`;
}

export function bindD1Sql(sql, bindings = []) {
  const source = String(sql);
  let output = '';
  let state = 'normal';
  let nextAnonymousIndex = 0;
  let maximumIndex = -1;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (state === 'normal') {
      if (char === "'") state = 'single';
      else if (char === '"') state = 'double';
      else if (char === '`') state = 'backtick';
      else if (char === '[') state = 'bracket';
      else if (char === '-' && next === '-') state = 'line-comment';
      else if (char === '/' && next === '*') state = 'block-comment';
      else if (char === '?') {
        let end = index + 1;
        while (/\d/.test(source[end] || '')) end += 1;
        const digits = source.slice(index + 1, end);
        const bindingIndex = digits
          ? Number(digits) - 1
          : nextAnonymousIndex;
        if (digits) nextAnonymousIndex = Math.max(nextAnonymousIndex, bindingIndex + 1);
        else nextAnonymousIndex += 1;
        if (!Number.isSafeInteger(bindingIndex) || bindingIndex < 0 || bindingIndex >= bindings.length) {
          throw new Error(`remote D1 binding index ${bindingIndex + 1} is unavailable`);
        }
        maximumIndex = Math.max(maximumIndex, bindingIndex);
        output += sqlValue(bindings[bindingIndex]);
        index = end - 1;
        continue;
      }
      output += char;
      if ((char === '-' && next === '-') || (char === '/' && next === '*')) {
        output += next;
        index += 1;
      }
      continue;
    }

    output += char;
    if (state === 'single' && char === "'") {
      if (next === "'") {
        output += next;
        index += 1;
      } else state = 'normal';
    } else if (state === 'double' && char === '"') {
      if (next === '"') {
        output += next;
        index += 1;
      } else state = 'normal';
    } else if (state === 'backtick' && char === '`') {
      if (next === '`') {
        output += next;
        index += 1;
      } else state = 'normal';
    } else if (state === 'bracket' && char === ']') {
      state = 'normal';
    } else if (state === 'line-comment' && char === '\n') {
      state = 'normal';
    } else if (state === 'block-comment' && char === '*' && next === '/') {
      output += next;
      index += 1;
      state = 'normal';
    }
  }

  if (maximumIndex + 1 !== bindings.length) {
    throw new Error(`remote D1 binding count mismatch: SQL references ${maximumIndex + 1}, received ${bindings.length}`);
  }
  return output;
}

function statementResult(output) {
  const results = wranglerD1Results(output);
  if (results.length !== 1) {
    throw new Error(`Wrangler returned ${results.length} D1 results for one statement`);
  }
  if (!results[0].success) throw new Error('Wrangler reported an unsuccessful D1 statement');
  return results[0];
}

export function createWranglerRemoteD1({
  database,
  cwd,
  wranglerScript,
  execFileSync = defaultExecFileSync,
}) {
  if (!String(database || '').trim()) throw new Error('remote D1 database name is required');
  if (!String(cwd || '').trim()) throw new Error('remote D1 working directory is required');
  if (!String(wranglerScript || '').trim()) throw new Error('Wrangler script path is required');

  const execute = (tail) => execFileSync(process.execPath, [
    wranglerScript,
    'd1', 'execute', database,
    '--remote', '--yes', '--json',
    ...tail,
  ], {
    cwd,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const createStatement = (sql, bindings = []) => ({
    __sql: String(sql),
    __bindings: bindings,
    bind(...values) { return createStatement(sql, values); },
    async all() {
      return statementResult(execute(['--command', bindD1Sql(sql, bindings)]));
    },
    async first(columnName) {
      const row = statementResult(execute(['--command', bindD1Sql(sql, bindings)])).results[0] || null;
      return columnName == null ? row : row?.[columnName] ?? null;
    },
    async run() {
      return statementResult(execute(['--command', bindD1Sql(sql, bindings)]));
    },
  });

  return {
    prepare(sql) { return createStatement(sql); },
    async batch(statements = []) {
      if (!statements.length) return [];
      const rendered = statements.map((item) => {
        if (!item || typeof item.__sql !== 'string' || !Array.isArray(item.__bindings)) {
          throw new TypeError('remote D1 batch received an incompatible statement');
        }
        return `${bindD1Sql(item.__sql, item.__bindings).replace(/;+\s*$/, '')};`;
      });
      // Remote --file uses D1 import and returns one aggregate result. A multi-query
      // --command preserves the per-statement results expected by the D1 batch API.
      const results = wranglerD1Results(execute(['--command', rendered.join('\n')]));
      if (results.length !== statements.length) {
        throw new Error(`Wrangler returned ${results.length} D1 batch results for ${statements.length} statements`);
      }
      if (results.some((result) => !result.success)) {
        throw new Error('Wrangler reported an unsuccessful D1 batch statement');
      }
      return results;
    },
  };
}
