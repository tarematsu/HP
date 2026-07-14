import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
function option(name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
}
const hasFlag = name => argv.includes(name);

const durationSeconds = Math.max(1, Number(option("--duration", "300")) || 300);
const port = Math.max(1, Number(option("--port", "9222")) || 9222);
const url = option("--url", "https://stationhead.com/c/buddies");
const home = process.env.USERPROFILE || process.env.HOME || process.cwd();
const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
const profileDir = option("--profile", path.join(localAppData, "HomePanel", "StationheadCaptureProfile"));
const outDir = option("--out", path.join(home, "Downloads"));
const includeAllResourceTypes = hasFlag("--all-resource-types");

function resolveChrome(explicit) {
  const candidates = [
    explicit,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Google/Chrome/Application/chrome.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Google/Chrome/Application/chrome.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
  ].filter(Boolean);
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (!found) throw new Error("Chrome executable not found. Use --chrome <path>.");
  return found;
}

function safeUrl(value) {
  try {
    const parsed = new URL(value);
    const query = [...parsed.searchParams.keys()].map(key => `${key}=<redacted>`).join("&");
    return `${parsed.origin}${parsed.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return "<invalid-url>";
  }
}

function sensitiveKey(key) {
  return /authorization|cookie|token|secret|password|passwd|api[-_]?key|session|credential|jwt|bearer|private/i.test(String(key));
}

function sanitizeText(value) {
  if (value == null) return value;
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>")
    .replace(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?![A-Za-z0-9_-])/g, "<jwt-redacted>")
    .replace(/([?&](?:token|auth|key|secret|password)=)[^&\s]+/gi, "$1<redacted>");
}

function sanitizeValue(value, key = "") {
  if (sensitiveKey(key)) return "<redacted>";
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return sanitizeText(value);
  if (Array.isArray(value)) return value.map(item => sanitizeValue(item, key));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, sanitizeValue(item, name)]));
  }
  return String(value);
}

function sanitizeBody(body, base64Encoded = false) {
  if (body == null) return body;
  if (base64Encoded) return "<binary-body-omitted>";
  const text = String(body);
  try {
    return JSON.stringify(sanitizeValue(JSON.parse(text)));
  } catch {
    return sanitizeText(text);
  }
}

function interestingType(type) {
  return includeAllResourceTypes || ["XHR", "Fetch", "WebSocket", "EventSource", "Document"].includes(type);
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function getStationheadTarget() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json();
    return targets.find(item => item.type === "page" && /stationhead\.com/i.test(item.url || "")) || null;
  } catch {
    return null;
  }
}

async function waitForStationheadTarget() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const target = await getStationheadTarget();
    if (target) return target;
    try {
      await fetch(`http://127.0.0.1:${port}/json/version`);
    } catch { /* Chrome is still starting. */ }
    await sleep(500);
  }
  throw new Error(`Stationhead tab was not found on CDP port ${port}.`);
}

class CdpConnection {
  constructor(webSocketUrl) {
    this.socket = new WebSocket(webSocketUrl);
    this.nextId = 0;
    this.pending = new Map();
    this.events = null;
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", event => reject(event.error || new Error("CDP WebSocket error")), { once: true });
    });
    this.socket.addEventListener("message", event => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message || "CDP command failed"));
        else pending.resolve(message.result || {});
      } else if (this.events) {
        this.events(message);
      }
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
    try { this.socket.close(); } catch { /* already closed */ }
  }
}

fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outFile = path.join(outDir, `sanitized-capture-${stamp}.jsonl`);
const output = fs.createWriteStream(outFile, { encoding: "utf8" });
function write(entry) {
  output.write(`${JSON.stringify(entry)}\n`);
}

write({
  kind: "capture_started",
  capturedAt: new Date().toISOString(),
  outputFile: outFile,
  url: safeUrl(url),
  durationSeconds,
});
console.log(`Sanitized output: ${outFile}`);

let chrome;
let connection;
try {
  const chromePath = resolveChrome(option("--chrome"));
  let target = await getStationheadTarget();
  if (!target) {
    fs.mkdirSync(profileDir, { recursive: true });
    chrome = spawn(chromePath, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      url,
    ], { stdio: "ignore", windowsHide: false });
    target = await waitForStationheadTarget();
  } else {
    console.log(`Using existing Chrome CDP session on port ${port}.`);
  }
  console.log(`Attached to: ${target.url}`);
  connection = new CdpConnection(target.webSocketDebuggerUrl);
  await connection.open();

  const requests = new Map();
  const responses = new Map();
  let captured = 0;

  const finishHttp = async requestId => {
    const request = requests.get(requestId);
    const response = responses.get(requestId);
    if (!request || !response) return;
    try {
      const body = await connection.send("Network.getResponseBody", { requestId });
      write({
        kind: "http",
        requestId,
        method: request.method,
        url: safeUrl(request.url),
        resourceType: request.type,
        requestHeaders: sanitizeValue(request.headers),
        postData: sanitizeBody(request.postData),
        status: response.status,
        mimeType: response.mimeType,
        responseHeaders: sanitizeValue(response.headers),
        bodyBase64Encoded: Boolean(body.base64Encoded),
        body: sanitizeBody(body.body, body.base64Encoded),
        capturedAt: new Date().toISOString(),
      });
      captured += 1;
      console.log(`[${response.status}] ${request.method} ${safeUrl(request.url)}`);
    } catch (error) {
      write({ kind: "http_body_error", requestId, error: String(error), capturedAt: new Date().toISOString() });
    } finally {
      requests.delete(requestId);
      responses.delete(requestId);
    }
  };

  connection.events = message => {
    const params = message.params || {};
    switch (message.method) {
      case "Network.requestWillBeSent":
        requests.set(params.requestId, {
          url: params.request.url,
          method: params.request.method,
          headers: params.request.headers,
          postData: params.request.postData,
          type: params.type,
        });
        break;
      case "Network.responseReceived":
        responses.set(params.requestId, {
          status: params.response.status,
          mimeType: params.response.mimeType,
          headers: params.response.headers,
        });
        break;
      case "Network.loadingFinished":
        if (requests.has(params.requestId) && interestingType(requests.get(params.requestId).type)) {
          void finishHttp(params.requestId);
        } else {
          requests.delete(params.requestId); responses.delete(params.requestId);
        }
        break;
      case "Network.loadingFailed":
        requests.delete(params.requestId); responses.delete(params.requestId);
        break;
      case "Network.webSocketCreated":
        write({ kind: "websocket_created", requestId: params.requestId, url: safeUrl(params.url), capturedAt: new Date().toISOString() });
        break;
      case "Network.webSocketFrameSent":
      case "Network.webSocketFrameReceived":
        write({
          kind: message.method.endsWith("Sent") ? "websocket_sent" : "websocket_received",
          requestId: params.requestId,
          payloadData: sanitizeBody(params.response?.payloadData),
          capturedAt: new Date().toISOString(),
        });
        captured += 1;
        break;
      default:
        break;
    }
  };

  await connection.send("Network.enable");
  console.log(`Capturing for ${durationSeconds} seconds. Log in and operate Stationhead now.`);
  await sleep(durationSeconds * 1000);
  write({ kind: "capture_finished", captured, capturedAt: new Date().toISOString() });
  console.log(`Done. Captured ${captured} entries.`);
} catch (error) {
  write({ kind: "capture_error", error: String(error?.stack || error), capturedAt: new Date().toISOString() });
  console.error(String(error?.stack || error));
  process.exitCode = 1;
} finally {
  connection?.close();
  output.end();
}
