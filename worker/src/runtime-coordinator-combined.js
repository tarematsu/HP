import { RuntimeCoordinator as ScheduledRuntimeCoordinator } from './runtime-do-orchestrator.js';
import { RuntimeStateCoordinator } from './runtime-state-do.js';

export class RuntimeCoordinator extends ScheduledRuntimeCoordinator {
  constructor(state, env, dependencies = {}) {
    super(state, env, dependencies);
    this.runtimeStateCoordinator = new RuntimeStateCoordinator(state);
  }

  async fetch(request) {
    if (request?.method === 'POST') {
      try {
        const body = await request.clone().json();
        if (body?.action === 'record-runtime-state') {
          return Response.json(await this.runtimeStateCoordinator.record({
            ...body,
            action: 'record',
          }));
        }
        if (body?.action === 'read-runtime-state') {
          return Response.json(await this.runtimeStateCoordinator.read(body?.task));
        }
        if (body?.action === 'record' || body?.action === 'read') {
          return Response.json({ error: 'ambiguous-runtime-state-action' }, { status: 400 });
        }
      } catch {
        // Preserve the parent coordinator's invalid JSON response contract.
      }
    }
    return super.fetch(request);
  }
}
