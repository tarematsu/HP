import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const hpRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = resolve(hpRoot, "native/scripts/ui");
const destinationDirectory = resolve(hpRoot, "video/public/radar-cloud");

await mkdir(destinationDirectory, { recursive: true });
await copyFile(
  resolve(sourceDirectory, "radar-satellite.png"),
  resolve(destinationDirectory, "radar-satellite.png"),
);
