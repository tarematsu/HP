import { describe, expect, it } from "vitest";
import { changedOctopusReadings } from "../src/octopus_reading_filter";

describe("changedOctopusReadings", () => {
  it("returns changed and new readings", () => {
    expect(changedOctopusReadings([
      { supplyPoint: "A", observedAt: 1, energyKwh: 1 },
      { supplyPoint: "A", observedAt: 2, energyKwh: 3 },
      { supplyPoint: "B", observedAt: 1, energyKwh: 4 },
    ], [
      { supplyPoint: "A", observedAt: 1, energyKwh: 1 },
      { supplyPoint: "A", observedAt: 2, energyKwh: 2 },
    ])).toEqual([
      { supplyPoint: "A", observedAt: 2, energyKwh: 3 },
      { supplyPoint: "B", observedAt: 1, energyKwh: 4 },
    ]);
  });
});
