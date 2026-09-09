import { describe, expect, it } from "vitest";
import {
  selectRadarForecastEntries,
  selectTerminalForecastEntries,
  type RadarTimeEntry,
} from "../src/radar_source";

const hrpns = ["hrpns"];

function entry(basetime: string, validtime = basetime): RadarTimeEntry {
  return { basetime, validtime, elements: hrpns };
}

describe("radar forecast frame selection", () => {
  it("selects the current frame and forecasts through 60 minutes from the latest coherent observed cycle", () => {
    const observed = [
      entry("20260717102000"),
      entry("20260717102500"),
      entry("20260717103000"),
    ];
    const forecast = [
      entry("20260717102000", "20260717105000"),
      entry("20260717102500", "20260717103000"),
      entry("20260717102500", "20260717105000"),
      entry("20260717102500", "20260717105500"),
      entry("20260717102500", "20260717110000"),
      entry("20260717102500", "20260717112500"),
      entry("20260717102500", "20260717113000"),
    ];

    const selected = selectRadarForecastEntries(observed, forecast);

    expect(selected.map(frame => frame.validtime)).toEqual([
      "20260717102500",
      "20260717103000",
      "20260717105000",
      "20260717105500",
      "20260717110000",
      "20260717112500",
    ]);
    expect(selected.every(frame => frame.basetime === "20260717102500")).toBe(true);
  });

  it("returns no animation when a coherent future cycle is unavailable", () => {
    const observed = [entry("20260717102500")];
    const forecast = [entry("20260717102000", "20260717105500")];

    expect(selectRadarForecastEntries(observed, forecast)).toEqual([]);
  });

  it("does not return a current-only cycle when the matching forecast has no future frame", () => {
    const observed = [entry("20260717102500")];
    const forecast = [entry("20260717102500", "20260717102500")];

    expect(selectRadarForecastEntries(observed, forecast)).toEqual([]);
  });

  it("ignores non-radar elements and duplicate forecast valid times", () => {
    const observed = [entry("20260717102500")];
    const forecast: RadarTimeEntry[] = [
      entry("20260717102500", "20260717105500"),
      entry("20260717102500", "20260717105500"),
      { basetime: "20260717102500", validtime: "20260717110000", elements: ["other"] },
    ];

    expect(selectRadarForecastEntries(observed, forecast).map(frame => frame.validtime)).toEqual([
      "20260717102500",
      "20260717105500",
    ]);
  });

  it("uses the final short-term forecast and the preceding two-hour window", () => {
    const rasrf = (basetime: string, validtime: string, member = "none"): RadarTimeEntry => ({
      basetime,
      validtime,
      member,
      elements: ["rasrf"],
    });
    const selected = selectTerminalForecastEntries([
      rasrf("20260909120000", "20260909200000"),
      rasrf("20260909120000", "20260910000000"),
      rasrf("20260909120000", "20260910010000"),
      rasrf("20260909120000", "20260910020000"),
      rasrf("20260909120000", "20260910030000"),
      rasrf("20260909125000", "20260909185000", "immed"),
    ]);

    expect(selected.map(frame => frame.validtime)).toEqual([
      "20260910010000",
      "20260910020000",
      "20260910030000",
    ]);
    expect(selected.every(frame => frame.basetime === "20260909120000")).toBe(true);
  });

  it("ignores non-RASRF entries when finding the terminal forecast", () => {
    expect(selectTerminalForecastEntries([
      { basetime: "20260909120000", validtime: "20260910030000", elements: ["other"] },
    ])).toEqual([]);
  });
});
