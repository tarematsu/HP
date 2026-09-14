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

function rasrf(basetime: string, validtime: string, member = "none"): RadarTimeEntry {
  return { basetime, validtime, member, elements: ["rasrf"] };
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

  it("caps the right panel at exactly 09:00 JST when the latest available time is later than 09:00", () => {
    const shortTerm: RadarTimeEntry[] = [
      rasrf("20260914230000", "20260915000000"),
      rasrf("20260915000000", "20260915000000"),
      rasrf("20260915010000", "20260915030000"),
      rasrf("20260915020000", "20260915060000"),
    ];

    expect(selectLatestShortTermEntry(shortTerm)).toEqual(
      expect.objectContaining({
        basetime: "20260915000000",
        validtime: "20260915000000",
      }),
    );
  });

  it("caps the right panel at exactly 22:00 JST when the latest available time is later than 22:00", () => {
    const shortTerm: RadarTimeEntry[] = [
      rasrf("20260915110000", "20260915120000"),
      rasrf("20260915120000", "20260915130000"),
      rasrf("20260915130000", "20260915140000"),
    ];

    expect(selectLatestShortTermEntry(shortTerm)).toEqual(
      expect.objectContaining({
        validtime: "20260915130000",
      }),
    );
  });

  it("keeps the latest RASRF time when it has not passed 09:00 JST", () => {
    const shortTerm: RadarTimeEntry[] = [
      rasrf("20260914210000", "20260914220000"),
      rasrf("20260914220000", "20260914230000"),
    ];

    expect(selectLatestShortTermEntry(shortTerm)).toEqual(
      expect.objectContaining({
        validtime: "20260914230000",
      }),
    );
  });

  it("keeps exact 09:00 and 22:00 JST boundary frames unchanged", () => {
    expect(selectLatestShortTermEntry([
      rasrf("20260914230000", "20260915000000"),
    ])?.validtime).toBe("20260915000000");

    expect(selectLatestShortTermEntry([
      rasrf("20260915120000", "20260915130000"),
    ])?.validtime).toBe("20260915130000");
  });

  it("does not substitute a nearby frame when an exact 09:00 or 22:00 JST cap is missing", () => {
    const shortTerm: RadarTimeEntry[] = [
      rasrf("20260914230000", "20260914233000"),
      rasrf("20260915010000", "20260915030000"),
    ];

    expect(selectLatestShortTermEntry(shortTerm)).toBeUndefined();
  });

  it("ignores non-none RASRF members and non-RASRF elements", () => {
    const shortTerm: RadarTimeEntry[] = [
      rasrf("20260914220000", "20260914230000"),
      rasrf("20260915010000", "20260915030000", "immed"),
      { basetime: "20260915020000", validtime: "20260915040000", member: "none", elements: ["other"] },
    ];

    expect(selectLatestShortTermEntry(shortTerm)).toEqual(
      expect.objectContaining({ validtime: "20260914230000", member: "none" }),
    );
  });
});
