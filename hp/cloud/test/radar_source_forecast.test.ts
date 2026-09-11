import { describe, expect, it } from "vitest";
import {
  selectLatestShortTermEntry,
  selectOneHourForecastEntry,
  selectRadarForecastEntries,
  type RadarTimeEntry,
} from "../src/radar_source";

const hrpns = ["hrpns"];

function entry(basetime: string, validtime = basetime): RadarTimeEntry {
  return { basetime, validtime, elements: hrpns };
}

describe("radar fixed endpoint selection", () => {
  it("uses the latest observation and available forecast valid times through 60 minutes", () => {
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
      "20260717103000",
      "20260717105000",
      "20260717105500",
      "20260717110000",
      "20260717112500",
      "20260717113000",
    ]);
    expect(selected[0]?.validtime).toBe("20260717103000");
    expect(selectOneHourForecastEntry(selected)?.validtime).toBe("20260717113000");
  });

  it("keeps the newest observation when N1 and N2 basetimes have rolled over independently", () => {
    const observed = [
      entry("20260911104500"),
      entry("20260911105000"),
    ];
    const forecast = [
      entry("20260911110000", "20260911110000"),
      entry("20260911110000", "20260911112000"),
      entry("20260911110000", "20260911115000"),
    ];

    const selected = selectRadarForecastEntries(observed, forecast);

    expect(selected[0]).toEqual(expect.objectContaining({
      basetime: "20260911105000",
      validtime: "20260911105000",
    }));
    expect(selectOneHourForecastEntry(selected)).toEqual(expect.objectContaining({
      basetime: "20260911110000",
      validtime: "20260911115000",
    }));
  });

  it("requires an exact +60 minute nowcast frame", () => {
    const selected = [
      entry("20260717102500"),
      entry("20260717102500", "20260717112000"),
    ];

    expect(selectOneHourForecastEntry(selected)).toBeUndefined();
  });

  it("returns no endpoints when a +60 minute future frame is unavailable", () => {
    const observed = [entry("20260717102500")];
    const forecast = [entry("20260717102000", "20260717105500")];

    expect(selectRadarForecastEntries(observed, forecast)).toEqual([]);
  });

  it("does not return a current-only cycle", () => {
    const observed = [entry("20260717102500")];
    const forecast = [entry("20260717102500", "20260717102500")];

    expect(selectRadarForecastEntries(observed, forecast)).toEqual([]);
  });

  it("ignores non-radar elements and keeps the newest basetime for duplicate valid times", () => {
    const observed = [entry("20260717102500")];
    const forecast: RadarTimeEntry[] = [
      entry("20260717102000", "20260717105500"),
      entry("20260717102500", "20260717105500"),
      entry("20260717102500", "20260717112500"),
      { basetime: "20260717102500", validtime: "20260717110000", elements: ["other"] },
    ];

    const selected = selectRadarForecastEntries(observed, forecast);
    expect(selected.map(frame => frame.validtime)).toEqual([
      "20260717102500",
      "20260717105500",
      "20260717112500",
    ]);
    expect(selected[1]?.basetime).toBe("20260717102500");
  });

  it("uses the latest available RASRF valid time without rain scoring", () => {
    const shortTerm: RadarTimeEntry[] = [
      { basetime: "20260909120000", validtime: "20260910010000", member: "none", elements: ["rasrf"] },
      { basetime: "20260909120000", validtime: "20260910030000", member: "none", elements: ["rasrf"] },
      { basetime: "20260909130000", validtime: "20260910030000", member: "none", elements: ["rasrf"] },
      { basetime: "20260909140000", validtime: "20260910040000", member: "immed", elements: ["rasrf"] },
      { basetime: "20260909140000", validtime: "20260910050000", member: "none", elements: ["other"] },
    ];

    expect(selectLatestShortTermEntry(shortTerm)).toEqual(
      expect.objectContaining({
        basetime: "20260909130000",
        validtime: "20260910030000",
        member: "none",
      }),
    );
  });
});
