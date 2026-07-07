import { describe, expect, it } from "vitest";
import { failSafeSwitchBotState } from "../src/switchbot_state";
import type { SwitchBotState } from "../src/switchbot_types";

const previous: SwitchBotState = {
  provider: "SwitchBot OpenAPI v1.1",
  observedAt: 1000,
  presence: "away",
  doorOpen: false,
  motion: false,
  brightness: "bright",
  lastActivityAt: 500,
  awayCandidateAt: 900,
  lastPowerPollAt: 800,
  devices: [],
  controlPlugIds: [],
};

describe("presence fallback", () => {
  it("uses home while the external service is unavailable", () => {
    const result = failSafeSwitchBotState(previous, 2000, [], "timeout");
    expect(result.presence).toBe("home");
    expect(result.awayCandidateAt).toBe(0);
    expect(result.serviceAvailable).toBe(false);
  });

  it("respects the last known dim room state", () => {
    const result = failSafeSwitchBotState({ ...previous, brightness: "dim" }, 2000, [], "timeout");
    expect(result.brightness).toBe("dim");
  });
});
