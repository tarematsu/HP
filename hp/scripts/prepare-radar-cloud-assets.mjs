import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const hpRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = resolve(hpRoot, "native/scripts/ui");
const destinationDirectory = resolve(hpRoot, "video/public/radar-cloud");

await mkdir(destinationDirectory, { recursive: true });
await Promise.all([
  "radar-satellite.png",
  "radar-map.png",
].map(name => copyFile(
  resolve(sourceDirectory, name),
  resolve(destinationDirectory, name),
)));
