import { radarBundleShardResponse } from "./radar_bundle";
import type { Env } from "./sources";

export class RadarBundleCoordinator {
  constructor(
    private readonly _state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ error: "method_not_allowed" }, {
        status: 405,
        headers: { Allow: "POST" },
      });
    }
    if (new URL(request.url).pathname !== "/shard") {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    return radarBundleShardResponse(request, this.env);
  }
}
