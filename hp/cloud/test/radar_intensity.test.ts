import { describe, expect, it } from "vitest";
import {
  compareRadarFrameScores,
  mergeRadarFrameScores,
  scoreRadarPng,
  type RadarFrameScore,
} from "../src/radar_intensity";

function bytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
}

describe("radar representative frame scoring", () => {
  it("scores only visible precipitation samples and weights stronger JMA colors more heavily", async () => {
    const png = bytes(
      "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAIElEQVR4nGP49On/fwZk4IjGpwP4r8GAYucWhgx6uwEAIu8KYzhlNbQAAAAASUVORK5CYII=",
    );

    await expect(scoreRadarPng(png, { left: 0, top: 0, right: 8, bottom: 8 })).resolves.toEqual({
      rainSamples: 4,
      intensityPoints: 48,
      maxIntensityRank: 8,
      score: 176,
    });
  });

  it("merges tile scores into a coverage-first weighted impact score", () => {
    expect(mergeRadarFrameScores([
      { rainSamples: 3, intensityPoints: 5, maxIntensityRank: 2, score: 0 },
      { rainSamples: 2, intensityPoints: 18, maxIntensityRank: 7, score: 0 },
    ])).toEqual({
      rainSamples: 5,
      intensityPoints: 23,
      maxIntensityRank: 7,
      score: 183,
    });
  });

  it("prefers the broader/stronger weighted frame and leaves exact ties to the earlier caller order", () => {
    const broader: RadarFrameScore = {
      rainSamples: 20,
      intensityPoints: 20,
      maxIntensityRank: 2,
      score: 660,
    };
    const smallerButStrong: RadarFrameScore = {
      rainSamples: 10,
      intensityPoints: 240,
      maxIntensityRank: 8,
      score: 560,
    };
    expect(compareRadarFrameScores(broader, smallerButStrong)).toBeGreaterThan(0);
    expect(compareRadarFrameScores(broader, broader)).toBe(0);
  });
});
