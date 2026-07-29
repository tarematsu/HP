import { authorizedDevice, deviceIdFromRequest } from "./auth";
import * as deviceSync from "./device_sync";
import * as deviceSyncCoordinator from "./device_sync_coordinator_client";
import {
  buildDeviceExchangeResponse,
  validDeviceExchangeInput,
} from "./device_exchange_payload";
import { queueSchedulerWatchdog } from "./scheduler_coordinator";
import type { Env } from "./sources";

export async function deviceExchangeResponse(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const deviceId = deviceIdFromRequest(request);
  if (!deviceId) return Response.json({ error: "valid deviceId is required" }, { status: 400 });
  if (!authorizedDevice(request, env, deviceId)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  queueSchedulerWatchdog(env, ctx);
  const coordinatedExchange = await deviceSyncCoordinator.requestCoordinatedDeviceExchange(
    env,
    deviceId,
    request,
  );
  if (coordinatedExchange) return coordinatedExchange;

  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const input = validDeviceExchangeInput(value);
  if (!input) return Response.json({ error: "body must be an object" }, { status: 400 });

  return buildDeviceExchangeResponse(input, env, deviceId, async versions => {
    const coordinated = await deviceSyncCoordinator.requestCoordinatedDeviceSync(env, deviceId, versions);
    return coordinated ?? deviceSync.buildDeviceSyncPayloadForDevice(env, deviceId, versions);
  });
}
