import { describe, expect, it } from "vitest";
import {
  nextJstRadarTargetMillis,
  selectLatestObservedRadarEntry,
  selectNextNowcastEntry,
  selectNextRadarForecast,
  selectNextShortTermEntry,
  type RadarTimeEntry,
} from "../src/radar_source";

function observed(validtime: string): RadarTimeEntry {
  return { basetime: validtime, validtime, elements: ["hrpns"] };
}

function rasrf(basetime: string, validtime: string, member = "none"): RadarTimeEntry {
  return { basetime, validtime, member, elements: ["rasrf"] };
}

const utc = (stamp: string): number => Date.UTC(
  Number(stamp.slice(0, 4)),
  Number(stamp.slice(4, 6)) - 1,
  Number(stamp.slice(6, 8)),
  Number(stamp.slice(8, 10)),
  Number(stamp.slice(10, 12)),
  Number(stamp.slice(12, 14)),
);

describe("cloud radar three-panel timing", () => {
  it("selects the latest observed frame without requiring an N2 +60-minute forecast", () => {
    expect(selectLatestObservedRadarEntry([
      observed("20261008135300"),
      observed("20261008135800"),
      observed("20261008135500"),
      { basetime: "20261008135900", validtime: "20261008140000", elements: ["hrpns"] },
      { basetime: "20261008140000", validtime: "20261008140000", elements: ["other"] },
    ])?.validtime).toBe("20261008135800");
    expect(selectLatestObservedRadarEntry([])).toBeUndefined();
  });

  it("finds the next 22:00 and 09:00 JST independently across midnight", () => {
    // 2026-10-08 23:02 JST: both requested hours occur tomorrow.
    const now = utc("20261008140200");
    expect(nextJstRadarTargetMillis(now, 22)).toBe(utc("20261009130000"));
    expect(nextJstRadarTargetMillis(now, 9)).toBe(utc("20261009000000"));
  });

  it("uses today's 22:00 and tomorrow's 09:00 when the reference is 21:59 JST", () => {
    const now = utc("20261008125900");
    expect(nextJstRadarTargetMillis(now, 22)).toBe(utc("20261008130000"));
    expect(nextJstRadarTargetMillis(now, 9)).toBe(utc("20261009000000"));
  });

  it("uses today's 09:00 and 22:00 when the reference is 08:59 JST", () => {
    const now = utc("20261007235900");
    expect(nextJstRadarTargetMillis(now, 9)).toBe(utc("20261008000000"));
    expect(nextJstRadarTargetMillis(now, 22)).toBe(utc("20261008130000"));
  });

  it("treats the exact 09:00 or 22:00 JST boundary as tomorrow's next occurrence", () => {
    expect(nextJstRadarTargetMillis(utc("20261008000000"), 9)).toBe(utc("20261009000000"));
    expect(nextJstRadarTargetMillis(utc("20261008130000"), 22)).toBe(utc("20261009130000"));
  });

  it("handles leap-day, month, and year rollover in JST", () => {
    expect(nextJstRadarTargetMillis(utc("20280229140000"), 9)).toBe(utc("20280301000000"));
    expect(nextJstRadarTargetMillis(utc("20261231140000"), 22)).toBe(utc("20270101130000"));
  });

  it("selects exact next 22:00 and 09:00 frames even when later frames exist", () => {
    const now = utc("20261008110000"); // 20:00 JST
    const frames = [
      rasrf("20261008110000", "20261008130000"), // Today 22:00
      rasrf("20261008110000", "20261009000000"), // Tomorrow 09:00
      rasrf("20261008120000", "20261009000000"), // Same valid time, newer base
      rasrf("20261008110000", "20261009010000"),
    ];
    expect(selectNextShortTermEntry(frames, 22, now)?.validtime).toBe("20261008130000");
    expect(selectNextShortTermEntry(frames, 9, now)).toEqual(frames[2]);
  });

  it("falls back to the latest available valid time separately when targets are not published", () => {
    const now = utc("20261008140200"); // 23:02 JST
    const frames = [
      rasrf("20261008130000", "20261008150000"),
      rasrf("20261008140000", "20261008230000"),
      rasrf("20261008140000", "20261008200000"),
    ];
    // Tomorrow 22:00 is beyond this horizon; tomorrow 09:00 is missing as well.
    expect(selectNextShortTermEntry(frames, 22, now)?.validtime).toBe("20261008230000");
    expect(selectNextShortTermEntry(frames, 9, now)?.validtime).toBe("20261008230000");
  });

  it("can select tomorrow 09:00 while falling back for tomorrow 22:00", () => {
    const now = utc("20261008140200");
    const frames = [
      rasrf("20261008140000", "20261009000000"), // Tomorrow 09:00
      rasrf("20261008140000", "20261009020000"),
    ];
    expect(selectNextShortTermEntry(frames, 22, now)?.validtime).toBe("20261009020000");
    expect(selectNextShortTermEntry(frames, 9, now)?.validtime).toBe("20261009000000");
  });

  it("uses the exact 22:00 nowcast at 21:25 JST instead of the RASRF horizon maximum", () => {
    const now = utc("20261009122500"); // 2026-10-09 21:25 JST
    const shortTerm = [
      rasrf("20261009060000", "20261010030000"), // Tomorrow 12:00 JST
      rasrf("20261009060000", "20261010000000"), // Tomorrow 09:00 JST
    ];
    const earlier = { basetime: "20261009120500", validtime: "20261009130000", elements: ["hrpns"] };
    const latest = { basetime: "20261009122000", validtime: "20261009130000", elements: ["hrpns"] };
    const nowcast = [
      earlier,
      latest,
      { basetime: "20261009122000", validtime: "20261009130500", elements: ["hrpns"] },
    ];
    expect(selectNextShortTermEntry(shortTerm, 22, now)?.validtime).toBe("20261010030000");
    expect(selectNextNowcastEntry(nowcast, 22, now)).toEqual(latest);
    expect(selectNextRadarForecast(shortTerm, nowcast, 22, now)).toEqual({
      product: "jma",
      entry: latest,
    });
    expect(selectNextRadarForecast(shortTerm, nowcast, 9, now)).toEqual({
      product: "rasrf",
      entry: shortTerm[1],
    });
  });

  it("prefers the exact nowcast when both sources publish the target hour", () => {
    const now = utc("20261009122000"); // 21:20 JST
    const nearTerm = { basetime: "20261009121000", validtime: "20261009130000", elements: ["hrpns"] };
    const hourly = rasrf("20261009020000", "20261009130000");
    expect(selectNextRadarForecast([hourly], [nearTerm], 22, now)).toEqual({
      product: "jma",
      entry: nearTerm,
    });
    expect(selectNextRadarForecast([hourly], [], 22, now)).toEqual({
      product: "rasrf",
      entry: hourly,
    });
  });

  it("falls back to the latest short-term forecast only if neither source has the target hour", () => {
    const now = utc("20261009140000"); // 23:00 JST; next 22:00 is tomorrow
    const latest = rasrf("20261009130000", "20261010030000");
    const nowcast = { basetime: "20261009135500", validtime: "20261009145500", elements: ["hrpns"] };
    expect(selectNextRadarForecast([latest], [nowcast], 22, now)).toEqual({
      product: "rasrf",
      entry: latest,
    });
    expect(selectNextRadarForecast([], [], 22, now)).toBeUndefined();
  });

  it("ignores expired, future-base, invalid, or non-hrpns nowcast entries", () => {
    const now = utc("20261009122500");
    const valid = { basetime: "20261009121500", validtime: "20261009130000", elements: ["hrpns"] };
    expect(selectNextNowcastEntry([
      { basetime: "20261009123500", validtime: "20261009130000", elements: ["hrpns"] },
      { basetime: "20261009121500", validtime: "20261009130000", elements: ["other"] },
      { basetime: "invalid", validtime: "20261009130000", elements: ["hrpns"] },
      valid,
    ], 22, now)).toEqual(valid);
  });

  it("ignores non-RASRF elements, invalid entries, and non-none members", () => {
    const now = utc("20261008110000");
    const frames: RadarTimeEntry[] = [
      rasrf("20261008110000", "20261008120000"),
      rasrf("20261008110000", "20261008130000", "immed"),
      { basetime: "20261008110000", validtime: "20261008130000", elements: ["other"] },
      { basetime: "invalid", validtime: "20261008130000", elements: ["rasrf"] },
    ];
    expect(selectNextShortTermEntry(frames, 22, now)?.validtime).toBe("20261008120000");
    expect(selectNextShortTermEntry([], 9, now)).toBeUndefined();
  });
});
