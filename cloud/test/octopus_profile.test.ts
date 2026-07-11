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

function profileRanges(): OctopusProfileRanges {
  return {
    previousStart: new Date("2026-06-25T15:00:00.000Z"),
    previousEnd: new Date("2026-07-02T15:00:00.000Z"),
    currentStart: new Date("2026-07-02T15:00:00.000Z"),
    currentEnd: new Date("2026-07-09T15:00:00.000Z"),
  };
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

  it("hides a series when the seven complete days are not all present", () => {
    const ranges = profileRanges();
    const readings = [
      ...fullDayReadings(ranges.previousStart.getTime(), 7, 0.2),
      ...fullDayReadings(ranges.currentStart.getTime(), 6, 0.4),
      ...fullDayReadings(ranges.currentStart.getTime() + 6 * DAY_MS, 1, 0.4)
        .filter((_, index) => index !== 17),
    ];

    const profile = buildOctopusDailyProfile(readings, ranges);
    expect(profile.every(point => point.currentAverage === null)).toBe(true);
    expect(profile.every(point => point.currentDays === 6)).toBe(true);
    expect(profile.every(point => point.previousAverage === 0.2)).toBe(true);
    expect(profile.every(point => point.previousDays === 7)).toBe(true);
  });

  it("does not turn one available slot per day into a seven-day average", () => {
    const ranges = profileRanges();
    const readings: OctopusReading[] = [];
    for (let day = 0; day < 7; day += 1) {
      readings.push({
        supplyPoint: "spin-1",
        startAt: new Date(ranges.currentStart.getTime() + day * DAY_MS).toISOString(),
        value: day + 1,
      });
    }

    const profile = buildOctopusDailyProfile(readings, ranges);
    expect(profile.every(point => point.currentAverage === null)).toBe(true);
    expect(profile.every(point => point.currentDays === 0)).toBe(true);
  });
});
