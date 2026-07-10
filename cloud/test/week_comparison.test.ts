import { describe, expect, it } from "vitest";
import {
  alignedWeekComparison,
  isoWeekInfoJst,
  isoWeeksInYear,
} from "../src/week_comparison";

describe("energy week comparison", () => {
  it("aligns the current and previous ISO week by weekday in JST", () => {
    const comparison = alignedWeekComparison(Date.parse("2026-07-10T18:00:00Z"));

    expect(comparison.current).toEqual({ year: 2026, week: 28, weekday: 6 });
    expect(comparison.previousYear).toEqual({ year: 2025, week: 28, weekday: 6 });
    expect(comparison.currentWeekStart.toISOString()).toBe("2026-07-05T15:00:00.000Z");
    expect(comparison.currentWeekEnd.toISOString()).toBe("2026-07-12T15:00:00.000Z");
    expect(comparison.previousYearWeekStart.toISOString()).toBe("2025-07-06T15:00:00.000Z");
    expect(comparison.previousYearWeekEnd.toISOString()).toBe("2025-07-13T15:00:00.000Z");

    for (let index = 0; index < 7; index += 1) {
      const currentDay = comparison.currentWeekStart.getTime() + index * 86_400_000;
      const previousDay = comparison.previousYearWeekStart.getTime() + index * 86_400_000;
      expect(isoWeekInfoJst(currentDay).weekday).toBe(index + 1);
      expect(isoWeekInfoJst(previousDay).weekday).toBe(index + 1);
    }
  });

  it("uses the final available prior-year week when week 53 does not exist", () => {
    expect(isoWeeksInYear(2020)).toBe(53);
    expect(isoWeeksInYear(2019)).toBe(52);

    const comparison = alignedWeekComparison(Date.parse("2020-12-31T03:00:00Z"));
    expect(comparison.current).toEqual({ year: 2020, week: 53, weekday: 4 });
    expect(comparison.previousYear).toEqual({ year: 2019, week: 52, weekday: 4 });
    expect(comparison.previousYearWeekStart.toISOString()).toBe("2019-12-22T15:00:00.000Z");
  });

  it("uses JST when UTC and local dates fall on different weekdays", () => {
    expect(isoWeekInfoJst(Date.parse("2026-07-05T16:00:00Z"))).toEqual({
      year: 2026,
      week: 28,
      weekday: 1,
    });
  });
});
