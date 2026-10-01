import test from 'node:test';
import assert from 'node:assert/strict';
import { deploymentState } from '../scripts/wait-for-production-deploy.mjs';
const sha = 'a'.repeat(40);
const run = { id:1,head_sha:sha,head_branch:'main',path:'.github/workflows/deploy-split-pipeline.yml',event:'push',status:'completed',conclusion:'success' };
test('recollection waits for the exact official production deployment', () => {
  assert.equal(deploymentState([run],sha),'ready');
  for (const override of [{head_sha:'b'.repeat(40)},{head_branch:'feature'},{path:'.github/workflows/other.yml'},{event:'pull_request'},{status:'in_progress'}]) {
    assert.equal(deploymentState([{...run,...override}],sha),'waiting');
  }
});
test('a failed or cancelled deployment cannot start recollection', () => {
  for (const conclusion of ['failure','cancelled']) assert.throws(()=>deploymentState([{...run,conclusion}],sha),/Production deployment/);
});
