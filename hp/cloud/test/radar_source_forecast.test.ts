import { describe, expect, it } from "vitest";
import { selectRadarForecastEntries, type RadarTimeEntry } from "../src/radar_source";

const hrpns = ["hrpns"];

function entry(basetime: string, validtime = basetime): RadarTimeEntry {
  return { basetime, validtime, elements: hrpns };
}

describe("radar forecast frame selection", () => {
  it("starts at the latest observed frame with a matching forecast cycle", () => {
    const observed = [
      entry("20260717102000"),
      entry("20260717102500"),
      entry("20260717103000"),
    ];
    const forecast = [
      entry("20260717102000", "20260717102500"),
      entry("20260717102500", "20260717103000"),
      entry("20260717102500", "20260717103500"),
      entry("20260717102500", "20260717112500"),
      entry("20260717102500", "20260717113000"),
    ];

    const selected = selectRadarForecastEntries(observed, forecast);

    expect(selected.map(frame => frame.validtime)).toEqual([
      "20260717102500",
      "20260717103000",
      "20260717103500",
      "20260717112500",
    ]);
    expect(selected.every(frame => frame.basetime === "20260717102500")).toBe(true);
  });

  it("returns no animation when a coherent future cycle is unavailable", () => {
    const observed = [entry("20260717102500")];
    const forecast = [entry("20260717102000", "20260717103000")];

    expect(selectRadarForecastEntries(observed, forecast)).toEqual([]);
  });

  it("ignores non-radar elements and duplicate forecast valid times", () => {
    const observed = [entry("20260717102500")];
    const forecast: RadarTimeEntry[] = [
      entry("20260717102500", "20260717103000"),
      entry("20260717102500", "20260717103000"),
      { basetime: "20260717102500", validtime: "20260717103500", elements: ["other"] },
    ];

    expect(selectRadarForecastEntries(observed, forecast).map(frame => frame.validtime)).toEqual([
      "20260717102500",
      "20260717103000",
    ]);
  });
});
