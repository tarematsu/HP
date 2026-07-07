import worker from "./worker_core";
import { authorizedAnyDevice } from "./auth";
import { cachedMeta } from "./meta_cache";
import { etagResponse, unauthorized } from "./response";
import { sha256Hex } from "./snapshot";
import type { Env } from "./sources";

async function metaResponse(request: Request, env: Env): Promise<Response> {
  if (!authorizedAnyDevice(request, env)) return unauthorized();
  const payload = JSON.stringify(await cachedMeta(env));
  return etagResponse(request, payload, "application/json; charset=utf-8", await sha256Hex(payload));
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/v1/meta") return metaResponse(request, env);
    return worker.fetch(request, env, ctx);
  },
  scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    return worker.scheduled(event, env, ctx);
  },
} satisfies ExportedHandler<Env>;
