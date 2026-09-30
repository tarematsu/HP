import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectPagesReadModelRevisionDrift,
  REVISION_DRIVEN_VARIANTS,
} from '../scripts/detect-pages-read-model-revision-drift-actions.mjs';

test('revision drift detector targets only unpublished or changed history models', async () => {
  const revisions = new Map([
    ['history:daily', 'compact:history:daily:10:100'],
    ['history:weekly', 'compact:history:weekly:20:200'],
    ['history:monthly', 'compact:history:monthly:30:300'],
  ]);
  const published = new Map([
    ['history:daily', { source_revision: 'compact:history:daily:10:100' }],
    ['history:weekly', { source_revision: 'compact:history:weekly:19:190' }],
  ]);
  const result = await detectPagesReadModelRevisionDrift({
    env: { OTHER_DB: {} },
    variants: [
      { key: 'history:daily', revision_driven: true },
      { key: 'history:weekly', revision_driven: true },
      { key: 'history:monthly', revision_driven: true },
    ],
    loadRevision: async (variant) => revisions.get(variant.key),
    loadPublishedEnvelope: async (key) => published.get(key) || null,
  });

  assert.deepEqual(result.due_keys, ['history:weekly', 'history:monthly']);
  assert.equal(result.states[0].due, false);
  assert.equal(result.states[1].due, true);
  assert.equal(result.states[2].missing, true);
});

test('revision drift detector covers every revision-driven public history model', () => {
  assert.deepEqual(
    REVISION_DRIVEN_VARIANTS.map(({ key }) => key),
    [
      'history:daily',
      'history:weekly',
      'history:monthly',
      'history:broadcasts',
      'host-history:summary',
    ],
  );
});
