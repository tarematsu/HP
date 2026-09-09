export interface RadarPixelArea {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface RadarFrameScore {
  rainSamples: number;
  intensityPoints: number;
  maxIntensityRank: number;
  score: number;
}

const SAMPLE_STEP = 4;
const COVERAGE_WEIGHT = 32;
const PRECIPITATION_COLORS = [
  { r: 242, g: 242, b: 255, weight: 1 },
  { r: 160, g: 210, b: 255, weight: 2 },
  { r: 33, g: 140, b: 255, weight: 3 },
  { r: 0, g: 65, b: 255, weight: 5 },
  { r: 250, g: 245, b: 0, weight: 8 },
  { r: 255, g: 153, b: 0, weight: 12 },
  { r: 255, g: 40, b: 0, weight: 18 },
  { r: 180, g: 0, b: 104, weight: 24 },
] as const;

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16)
      | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

function chunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
}

function paeth(left: number, above: number, upperLeft: number): number {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function precipitationRank(red: number, green: number, blue: number): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < PRECIPITATION_COLORS.length; index += 1) {
    const candidate = PRECIPITATION_COLORS[index]!;
    const dr = red - candidate.r;
    const dg = green - candidate.g;
    const db = blue - candidate.b;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex + 1;
}

function sampleWeight(rank: number): number {
  return PRECIPITATION_COLORS[Math.max(0, Math.min(PRECIPITATION_COLORS.length - 1, rank - 1))]!.weight;
}

function paletteIndex(row: Uint8Array, x: number, bitDepth: number): number {
  if (bitDepth === 8) return row[x]!;
  const perByte = 8 / bitDepth;
  const byte = row[Math.floor(x / perByte)]!;
  const shift = (perByte - 1 - (x % perByte)) * bitDepth;
  return byte >>> shift & ((1 << bitDepth) - 1);
}

function normalizedArea(area: RadarPixelArea, width: number, height: number): RadarPixelArea {
  const left = Math.max(0, Math.min(width, Math.trunc(area.left)));
  const top = Math.max(0, Math.min(height, Math.trunc(area.top)));
  const right = Math.max(left, Math.min(width, Math.trunc(area.right)));
  const bottom = Math.max(top, Math.min(height, Math.trunc(area.bottom)));
  return { left, top, right, bottom };
}

async function inflatePngData(chunks: Uint8Array[], byteLength: number): Promise<Uint8Array> {
  const compressed = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    compressed.set(chunk, offset);
    offset += chunk.length;
  }
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function emptyRadarFrameScore(): RadarFrameScore {
  return { rainSamples: 0, intensityPoints: 0, maxIntensityRank: 0, score: 0 };
}

export function mergeRadarFrameScores(scores: readonly RadarFrameScore[]): RadarFrameScore {
  const merged = emptyRadarFrameScore();
  for (const current of scores) {
    merged.rainSamples += current.rainSamples;
    merged.intensityPoints += current.intensityPoints;
    merged.maxIntensityRank = Math.max(merged.maxIntensityRank, current.maxIntensityRank);
  }
  merged.score = merged.rainSamples * COVERAGE_WEIGHT + merged.intensityPoints;
  return merged;
}

export function compareRadarFrameScores(left: RadarFrameScore, right: RadarFrameScore): number {
  if (left.score !== right.score) return left.score - right.score;
  if (left.rainSamples !== right.rainSamples) return left.rainSamples - right.rainSamples;
  if (left.intensityPoints !== right.intensityPoints) return left.intensityPoints - right.intensityPoints;
  return left.maxIntensityRank - right.maxIntensityRank;
}

export async function scoreRadarPng(
  png: Uint8Array,
  requestedArea: RadarPixelArea,
): Promise<RadarFrameScore> {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10] as const;
  if (png.length < 33 || signature.some((value, index) => png[index] !== value)) {
    throw new Error("radar tile is not a PNG");
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = -1;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idatChunks: Uint8Array[] = [];
  let idatBytes = 0;

  for (let offset = 8; offset + 12 <= png.length;) {
    const length = readUint32(png, offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > png.length) throw new Error("radar PNG chunk exceeds file length");
    const type = chunkType(png, offset + 4);
    if (type === "IHDR") {
      if (length !== 13) throw new Error("radar PNG has invalid IHDR");
      width = readUint32(png, dataStart);
      height = readUint32(png, dataStart + 4);
      bitDepth = png[dataStart + 8]!;
      colorType = png[dataStart + 9]!;
      if (png[dataStart + 10] !== 0 || png[dataStart + 11] !== 0) {
        throw new Error("radar PNG uses unsupported compression or filtering");
      }
      interlace = png[dataStart + 12]!;
    } else if (type === "PLTE") {
      palette = png.slice(dataStart, dataEnd);
    } else if (type === "tRNS") {
      transparency = png.slice(dataStart, dataEnd);
    } else if (type === "IDAT") {
      const chunk = png.slice(dataStart, dataEnd);
      idatChunks.push(chunk);
      idatBytes += chunk.length;
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }

  if (width <= 0 || height <= 0 || !idatChunks.length || interlace !== 0) {
    throw new Error("radar PNG layout is unsupported");
  }
  if (colorType === 3) {
    if (![1, 2, 4, 8].includes(bitDepth) || !palette || palette.length % 3 !== 0) {
      throw new Error("radar indexed PNG layout is unsupported");
    }
  } else if (colorType === 6) {
    if (bitDepth !== 8) throw new Error("radar RGBA PNG bit depth is unsupported");
  } else if (colorType === 4) {
    if (bitDepth !== 8) throw new Error("radar grayscale-alpha PNG bit depth is unsupported");
  } else if (colorType === 2) {
    if (bitDepth !== 8) throw new Error("radar RGB PNG bit depth is unsupported");
  } else {
    throw new Error(`radar PNG color type ${colorType} is unsupported`);
  }

  const channels = colorType === 6 ? 4 : colorType === 4 ? 2 : colorType === 2 ? 3 : 1;
  const bitsPerPixel = channels * bitDepth;
  const rowBytes = Math.ceil(width * bitsPerPixel / 8);
  const bytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const inflated = await inflatePngData(idatChunks, idatBytes);
  const expectedBytes = (rowBytes + 1) * height;
  if (inflated.length < expectedBytes) throw new Error("radar PNG decompressed data is truncated");

  const area = normalizedArea(requestedArea, width, height);
  const result = emptyRadarFrameScore();
  let previous = new Uint8Array(rowBytes);
  let current = new Uint8Array(rowBytes);
  let sourceOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset++]!;
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = inflated[sourceOffset++]!;
      const left = x >= bytesPerPixel ? current[x - bytesPerPixel]! : 0;
      const above = previous[x]!;
      const upperLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel]! : 0;
      let reconstructed = raw;
      if (filter === 1) reconstructed += left;
      else if (filter === 2) reconstructed += above;
      else if (filter === 3) reconstructed += Math.floor((left + above) / 2);
      else if (filter === 4) reconstructed += paeth(left, above, upperLeft);
      else if (filter !== 0) throw new Error(`radar PNG filter ${filter} is unsupported`);
      current[x] = reconstructed & 0xff;
    }

    if (y >= area.top && y < area.bottom && (y - area.top) % SAMPLE_STEP === 0) {
      for (let x = area.left; x < area.right; x += SAMPLE_STEP) {
        let red = 0;
        let green = 0;
        let blue = 0;
        let alpha = 255;
        if (colorType === 6) {
          const at = x * 4;
          red = current[at]!;
          green = current[at + 1]!;
          blue = current[at + 2]!;
          alpha = current[at + 3]!;
        } else if (colorType === 4) {
          const at = x * 2;
          red = green = blue = current[at]!;
          alpha = current[at + 1]!;
        } else if (colorType === 2) {
          const at = x * 3;
          red = current[at]!;
          green = current[at + 1]!;
          blue = current[at + 2]!;
        } else {
          const index = paletteIndex(current, x, bitDepth);
          const at = index * 3;
          if (!palette || at + 2 >= palette.length) continue;
          red = palette[at]!;
          green = palette[at + 1]!;
          blue = palette[at + 2]!;
          alpha = transparency && index < transparency.length ? transparency[index]! : 255;
        }
        if (alpha === 0) continue;
        const rank = precipitationRank(red, green, blue);
        result.rainSamples += 1;
        result.intensityPoints += sampleWeight(rank);
        result.maxIntensityRank = Math.max(result.maxIntensityRank, rank);
      }
    }

    const swap = previous;
    previous = current;
    current = swap;
    current.fill(0);
  }

  result.score = result.rainSamples * COVERAGE_WEIGHT + result.intensityPoints;
  return result;
}
