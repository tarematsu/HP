import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { stripJsonc } from "../../hp/cloud/scripts/jsonc.mjs";

async function readConfig() {
  const file = path.resolve("hp/cloud", "wrangler.jsonc");
  return JSON.parse(stripJsonc(await readFile(file, "utf8")));
}

function updateBucket(config) {
  const configured = String(process.env.HOMEPANEL_UPDATE_BUCKET || "").trim();
  if (configured) return configured;
  const declared = String(
    config?.r2_buckets?.find((entry) => entry?.binding === "UPDATE_BUCKET")?.bucket_name || "",
  ).trim();
  return declared === "replace-with-your-r2-bucket-name" ? "" : declared;
}

const update_bucket = updateBucket(await readConfig());
const output = process.env.GITHUB_OUTPUT;
if (output) {
  await appendFile(output, `update_bucket=${update_bucket}\n`, "utf8");
} else {
  process.stdout.write(JSON.stringify({ update_bucket }, null, 2));
}
