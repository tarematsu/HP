import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
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

function previousUtcDay() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 86_400_000);
}

async function writeD1Usage(token, accountId, databaseName, databaseId) {
  const directory = path.resolve(".cloudflare-build-diagnostics");
  const output = path.join(directory, "d1-usage-complete-utc-day.json");
  await mkdir(directory, { recursive: true });

  const day = previousUtcDay();
  const date = day.toISOString().slice(0, 10);
  const result = {
    ok: false,
    measured_at: new Date().toISOString(),
    timezone: "UTC",
    date,
    window_start: `${date}T00:00:00.000Z`,
    window_end: new Date(day.getTime() + 86_400_000).toISOString(),
    database_name: databaseName,
    database_id: databaseId,
    rows_read: null,
    rows_written: null,
    read_queries: null,
    write_queries: null,
    error: null,
  };

  if (!token || !accountId || !databaseId) {
    result.error = "D1 usage query requires API token, account ID, and database ID";
    await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    return;
  }

  const query = `query D1DailyUsage($accountTag: string!, $date: Date!, $databaseId: string!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        d1AnalyticsAdaptiveGroups(
          limit: 10000
          filter: { date_geq: $date, date_leq: $date, databaseId: $databaseId }
        ) {
          sum {
            rowsRead
            rowsWritten
            readQueries
            writeQueries
          }
          dimensions {
            date
            databaseId
          }
        }
      }
    }
  }`;

  try {
    const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: { accountTag: accountId, date, databaseId },
      }),
    });
    const payload = await response.json();
    if (!response.ok || payload?.errors?.length) {
      const message = (payload?.errors || []).map((error) => error?.message || "unknown error").join("; ");
      throw new Error(`Cloudflare GraphQL query failed: ${message || response.status}`);
    }
    const groups = payload?.data?.viewer?.accounts?.[0]?.d1AnalyticsAdaptiveGroups || [];
    for (const group of groups) {
      result.rows_read += Number(group?.sum?.rowsRead || 0);
      result.rows_written += Number(group?.sum?.rowsWritten || 0);
      result.read_queries += Number(group?.sum?.readQueries || 0);
      result.write_queries += Number(group?.sum?.writeQueries || 0);
    }
    result.ok = true;
  } catch (error) {
    result.error = String(error?.message || error);
  }

  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

const config = await readConfig();
const workerName = String(config?.name || "").trim();
const database = config?.d1_databases?.find((entry) => entry?.binding === "DB");
const databaseName = String(database?.database_name || "").trim();
const databaseId = String(database?.database_id || "").trim();
const updateBucket = configuredUpdateBucket(config);
const apiToken = String(process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_BUILDS_API_TOKEN || "").trim();
const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim() || (apiToken ? await cloudflareAccountId(apiToken) : "");

if (!workerName) throw new Error("Worker name is missing in cloud/wrangler.jsonc");
if (!databaseName) throw new Error("D1 database name is missing in cloud/wrangler.jsonc");

await writeD1Usage(apiToken, accountId, databaseName, databaseId);

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
