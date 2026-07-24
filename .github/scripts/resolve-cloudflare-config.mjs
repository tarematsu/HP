import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { stripJsonc } from "../../hp/cloud/scripts/jsonc.mjs";
import { resolveCloudflareAccountId } from "./resolve-cloudflare-account.mjs";

async function readConfig() {
  const file = path.resolve("hp/cloud", "wrangler.jsonc");
  const raw = await readFile(file, "utf8");
  return JSON.parse(stripJsonc(raw));
}

function configuredUpdateBucket(config) {
  const configured = String(process.env.HOMEPANEL_UPDATE_BUCKET || "").trim();
  if (configured) return configured;
  const declared = String(
    config?.r2_buckets?.find((entry) => entry?.binding === "UPDATE_BUCKET")?.bucket_name || "",
  ).trim();
  if (declared && declared !== "replace-with-your-r2-bucket-name") return declared;
  return "";
}

const config = await readConfig();
const workerName = String(config?.name || "").trim();
const databaseName = String(
  config?.d1_databases?.find((entry) => entry?.binding === "DB")?.database_name || "",
).trim();
const updateBucket = configuredUpdateBucket(config);
const apiToken = String(
  process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_BUILDS_API_TOKEN || "",
).trim();
const configuredAccountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
const accountId = configuredAccountId
  ? await resolveCloudflareAccountId({ accountId: configuredAccountId })
  : (apiToken ? await resolveCloudflareAccountId({ token: apiToken }) : "");

if (!workerName) throw new Error("Worker name is missing in hp/cloud/wrangler.jsonc");
if (!databaseName) throw new Error("D1 database name is missing in hp/cloud/wrangler.jsonc");

const values = {
  worker_name: workerName,
  database_name: databaseName,
  account_id: accountId,
  update_bucket: updateBucket,
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
