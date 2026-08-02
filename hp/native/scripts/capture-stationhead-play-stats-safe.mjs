import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const option = (name, fallback = "") => {
  const index = argv.indexOf(name);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
};

const durationSeconds = Math.max(1, Number(option("--duration", "300")) || 300);
const port = Math.max(1, Number(option("--port", "9222")) || 9222);
const chromePath = option("--chrome");
const url = option("--url", "https://stationhead.com/c/buddies");
const outDir = option("--out", path.join(process.env.USERPROFILE || ".", "Downloads", "stationhead-safe-capture"));
const profileDir = path.join(
  process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || ".", "AppData", "Local"),
  "HomePanel",
  "StationheadSafeCaptureProfile",
);

if (!chromePath || !fs.existsSync(chromePath)) {
  throw new Error("Chrome executable not found.");
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getTarget() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json();
    return targets.find(target =>
      target.type === "page" && /stationhead\.com/i.test(target.url || "")
    ) || null;
  } catch {
    return null;
  }
}

async function waitForTarget() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const target = await getTarget();
    if (target) return target;
    await sleep(500);
  }
  throw new Error("Stationhead tab was not found.");
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
    this.onEvent = null;
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener(
        "error",
        event => reject(event.error || new Error("CDP connection failed")),
        { once: true },
      );
    });
    this.socket.addEventListener("message", event => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message || "CDP command failed"));
        else pending.resolve(message.result || {});
        return;
      }
      this.onEvent?.(message);
    });
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try { this.socket.close(); } catch {}
  }
}

function normalizeTimestamp(value) {
  let numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  if (numeric < 100_000_000_000) numeric *= 1000;
  else if (numeric > 100_000_000_000_000) numeric /= 1000;
  return Math.round(numeric);
}

function normalizeValue(value) {
  const numeric = typeof value === "string"
    ? Number(value.replaceAll(",", "").trim())
    : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric);
}

function normalizeChart(payload) {
  const raw = Array.isArray(payload?.chart_data) ? payload.chart_data : [];
  const byTimestamp = new Map();
  for (const point of raw) {
    const ts = normalizeTimestamp(point?.ts);
    const val = normalizeValue(point?.val);
    if (ts == null || val == null) continue;
    byTimestamp.set(ts, { ts, val });
  }
  return [...byTimestamp.values()]
    .sort((left, right) => left.ts - right.ts)
    .slice(-45);
}

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(profileDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputPath = path.join(outDir, `stationhead-streak-stats-safe-${stamp}.jsonl`);
const output = fs.createWriteStream(outputPath, { encoding: "utf8" });

let chrome;
let cdp;
let captured = 0;

try {
  let target = await getTarget();
  if (!target) {
    chrome = spawn(chromePath, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      url,
    ], { stdio: "ignore", windowsHide: false });
    target = await waitForTarget();
  }

  cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();

  const requests = new Map();
  const responses = new Map();

  const finish = async requestId => {
    const request = requests.get(requestId);
    const response = responses.get(requestId);
    if (!request || !response) return;
    try {
      const bodyResult = await cdp.send("Network.getResponseBody", { requestId });
      if (bodyResult.base64Encoded) return;
      const payload = JSON.parse(String(bodyResult.body || ""));
      const chartData = normalizeChart(payload);
      output.write(`${JSON.stringify({
        schemaVersion: 1,
        kind: "stationhead-streak-stats",
        method: request.method,
        endpoint: "/me/channel/{channelId}/streakStats",
        status: response.status,
        serverDate: response.serverDate || null,
        capturedAt: new Date().toISOString(),
        timezone: typeof payload?.timezone === "string" ? payload.timezone : null,
        totalStreams: Number.isFinite(Number(payload?.total_streams))
          ? Number(payload.total_streams)
          : null,
        pointCount: chartData.length,
        firstPoint: chartData[0] || null,
        lastPoint: chartData.at(-1) || null,
        chartData,
      })}\n`);
      captured += 1;
      console.log(`[${response.status}] captured streakStats (${chartData.length} points)`);
    } catch (error) {
      output.write(`${JSON.stringify({
        schemaVersion: 1,
        kind: "stationhead-streak-stats-error",
        status: response.status,
        error: "invalid-json-or-body",
        capturedAt: new Date().toISOString(),
      })}\n`);
    } finally {
      requests.delete(requestId);
      responses.delete(requestId);
    }
  };

  cdp.onEvent = message => {
    const params = message.params || {};
    if (message.method === "Network.requestWillBeSent") {
      const requestUrl = String(params.request?.url || "");
      let parsed;
      try { parsed = new URL(requestUrl); } catch { return; }
      if (
        parsed.protocol !== "https:" ||
        parsed.hostname !== "production1.stationhead.com" ||
        !/^\/me\/channel\/\d+\/streakStats$/.test(parsed.pathname)
      ) {
        return;
      }
      requests.set(params.requestId, {
        method: String(params.request?.method || ""),
      });
      return;
    }

    if (message.method === "Network.responseReceived" && requests.has(params.requestId)) {
      responses.set(params.requestId, {
        status: Number(params.response?.status || 0),
        serverDate:
          params.response?.headers?.date ||
          params.response?.headers?.Date ||
          null,
      });
      return;
    }

    if (message.method === "Network.loadingFinished" && requests.has(params.requestId)) {
      void finish(params.requestId);
      return;
    }

    if (message.method === "Network.loadingFailed") {
      requests.delete(params.requestId);
      responses.delete(params.requestId);
    }
  };

  await cdp.send("Network.enable");
  console.log(`Safe output: ${outputPath}`);
  console.log(`Capturing only streakStats for ${durationSeconds} seconds.`);
  await sleep(durationSeconds * 1000);
  console.log(`Done. Captured ${captured} responses.`);
} finally {
  cdp?.close();
  output.end();
}
