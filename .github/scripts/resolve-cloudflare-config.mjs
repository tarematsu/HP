import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { stripJsonc } from "../../cloud/scripts/jsonc.mjs";

async function readConfig() {
  const file = path.resolve("cloud", "wrangler.jsonc");
  const raw = await readFile(file, "utf8");
  return JSON.parse(stripJsonc(raw));
}

function configuredUpdateBucket(config) {
  const configured = String(process.env.HOMEPANEL_UPDATE_BUCKET || "").trim();
  if (configured) return configured;
  const declared = String(config?.r2_buckets?.find((entry) => entry?.binding === "UPDATE_BUCKET")?.bucket_name || "").trim();
  if (declared && declared !== "replace-with-your-r2-bucket-name") return declared;
  return "";
}

async function cloudflareAccountId(token) {
  const response = await fetch("https://api.cloudflare.com/client/v4/accounts?page=1&per_page=100", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const payload = await response.json();
  if (!response.ok || payload?.success === false) {
    const message = (payload?.errors || []).map((error) => error?.message || "unknown error").join("; ");
    throw new Error(`Cloudflare account lookup failed: ${message || response.status}`);
  }
  const accounts = Array.isArray(payload?.result) ? payload.result : [];
  if (accounts.length === 1 && accounts[0]?.id) return String(accounts[0].id);
  throw new Error("Cloudflare account could not be inferred automatically; set CLOUDFLARE_ACCOUNT_ID");
}

const config = await readConfig();
const workerName = String(config?.name || "").trim();
const databaseName = String(config?.d1_databases?.find((entry) => entry?.binding === "DB")?.database_name || "").trim();
const updateBucket = configuredUpdateBucket(config);
const apiToken = String(process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_BUILDS_API_TOKEN || "").trim();
const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim() || (apiToken ? await cloudflareAccountId(apiToken) : "");

if (!workerName) throw new Error("Worker name is missing in cloud/wrangler.jsonc");
if (!databaseName) throw new Error("D1 database name is missing in cloud/wrangler.jsonc");

const output = process.env.GITHUB_OUTPUT;
if (output) {
  const lines = [
    `worker_name=${workerName}`,
    `database_name=${databaseName}`,
    `account_id=${accountId}`,
    `update_bucket=${updateBucket}`,
  ].join("\n");
  await appendFile(output, `${lines}\n`, "utf8");
} else {
  process.stdout.write(JSON.stringify({
    worker_name: workerName,
    database_name: databaseName,
    account_id: accountId,
    update_bucket: updateBucket,
  }, null, 2));
}
