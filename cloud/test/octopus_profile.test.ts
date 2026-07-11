import { describe, expect, it } from "vitest";
import {
  buildOctopusDailyProfile,
  completeDayProfileRanges,
  type OctopusProfileRanges,
} from "../src/octopus_source";
import type { OctopusReading } from "../src/octopus_history";

const HALF_HOUR_MS = 30 * 60_000;
const DAY_MS = 86_400_000;

function fullDayReadings(startMs: number, days: number, value: number): OctopusReading[] {
  const readings: OctopusReading[] = [];
  for (let day = 0; day < days; day += 1) {
    for (let slot = 0; slot < 48; slot += 1) {
      readings.push({
        supplyPoint: "spin-1",
        startAt: new Date(startMs + day * DAY_MS + slot * HALF_HOUR_MS).toISOString(),
        value,
      });
    }
  }
  return readings;
}

describe("Octopus complete-day profile", () => {
  it("excludes today and yesterday and compares the two preceding seven-day blocks", () => {
    const now = Date.parse("2026-07-10T18:17:00Z");
    const ranges = completeDayProfileRanges(now);

    expect(ranges.currentStart.toISOString()).toBe("2026-07-02T15:00:00.000Z");
    expect(ranges.currentEnd.toISOString()).toBe("2026-07-09T15:00:00.000Z");
    expect(ranges.previousStart.toISOString()).toBe("2026-06-25T15:00:00.000Z");
    expect(ranges.previousEnd.toISOString()).toBe("2026-07-02T15:00:00.000Z");

    const readings = [
      ...fullDayReadings(ranges.previousStart.getTime(), 7, 0.2),
      ...fullDayReadings(ranges.currentStart.getTime(), 7, 0.4),
      ...fullDayReadings(ranges.currentEnd.getTime(), 2, 9.9),
    ];
    const profile = buildOctopusDailyProfile(readings, ranges);

    expect(profile).toHaveLength(48);
    expect(profile[0]).toEqual({
      time: "00:00",
      currentAverage: 0.4,
      previousAverage: 0.2,
      currentDays: 7,
      previousDays: 7,
    });
    expect(profile[47]).toEqual({
      time: "23:30",
      currentAverage: 0.4,
      previousAverage: 0.2,
      currentDays: 7,
      previousDays: 7,
    });
  });

  it("averages each half-hour from available complete days without mixing time slots", () => {
    const ranges: OctopusProfileRanges = {
      previousStart: new Date("2026-06-25T15:00:00.000Z"),
      previousEnd: new Date("2026-07-02T15:00:00.000Z"),
      currentStart: new Date("2026-07-02T15:00:00.000Z"),
      currentEnd: new Date("2026-07-09T15:00:00.000Z"),
    };
    const readings: OctopusReading[] = [];
    for (let day = 0; day < 7; day += 1) {
      readings.push({
        supplyPoint: "spin-1",
        startAt: new Date(ranges.currentStart.getTime() + day * DAY_MS).toISOString(),
        value: day + 1,
      });
    }
    readings.push({
      supplyPoint: "spin-1",
      startAt: new Date(ranges.currentStart.getTime() + HALF_HOUR_MS).toISOString(),
      value: 10,
    });

    const profile = buildOctopusDailyProfile(readings, ranges);
    expect(profile[0]?.currentAverage).toBe(4);
    expect(profile[0]?.currentDays).toBe(7);
    expect(profile[1]?.currentAverage).toBe(10);
    expect(profile[1]?.currentDays).toBe(1);
    expect(profile[2]?.currentAverage).toBeNull();
  });
});
