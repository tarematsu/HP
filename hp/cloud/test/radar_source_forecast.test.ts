import { describe, expect, it } from "vitest";
import {
  nextJstRadarTargetMillis,
  selectLatestObservedRadarEntry,
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
