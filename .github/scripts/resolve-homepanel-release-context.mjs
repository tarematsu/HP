import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { stripJsonc } from "../../hp/cloud/scripts/jsonc.mjs";
import { resolveCloudflareAccountId } from "./resolve-cloudflare-account.mjs";

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

const apiToken = String(
  process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_BUILDS_API_TOKEN || "",
).trim();
const configuredAccountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
const values = {
  account_id: configuredAccountId
    ? await resolveCloudflareAccountId({ accountId: configuredAccountId })
    : (apiToken ? await resolveCloudflareAccountId({ token: apiToken }) : ""),
  update_bucket: updateBucket(await readConfig()),
};

const output = process.env.GITHUB_OUTPUT;
if (output) {
  await appendFile(
    output,
    `${Object.entries(values).map(([name, value]) => `${name}=${value}`).join("\n")}\n`,
    "utf8",
  );
} else {
  process.stdout.write(JSON.stringify(values, null, 2));
}
