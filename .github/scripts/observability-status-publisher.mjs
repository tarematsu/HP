import { readFile } from 'node:fs/promises';

export const MAX_SECTION_CHARS = 12_000;
export const MAX_ISSUE_BODY_CHARS = 60_000;

const VALID_OUTCOMES = new Set(['success', 'failure', 'cancelled', 'skipped']);

export function normalizeOutcome(value) {
  const outcome = String(value || '').trim().toLowerCase();
  return VALID_OUTCOMES.has(outcome) ? outcome : 'unknown';
}

export function statusState(outcome) {
  return normalizeOutcome(outcome) === 'success' ? 'success' : 'failure';
}

export function overallOutcome(outcomes) {
  return Object.values(outcomes).every((value) => normalizeOutcome(value) === 'success')
    ? 'success'
    : 'failure';
}

export function sanitizeText(text) {
  return String(text || '')
    .replace(
      /(["']?\bauthorization\b["']?\s*[:=]\s*["']?)([a-z][a-z\d_-]*\s+)?[^\s,;"'}]+/gi,
      (_match, prefix, scheme = '') => `${prefix}${scheme}[redacted]`,
    )
    .replace(/\bBearer\s+[^\s,;"'}]+/gi, 'Bearer [redacted]')
    .replace(/(["']?\b(?:api[_-]?token|token|secret|api[_-]?key)\b["']?\s*[:=]\s*["']?)[^\s,;"'}]+/gi, '$1[redacted]')
    .replace(/([?&](?:token|key|secret|signature|sig|auth)=)[^\s&#)]+/gi, '$1[redacted]')
    .replace(/(CLOUDFLARE_(?:API_TOKEN|BUILDS_API_TOKEN|ACCOUNT_ID)\s*[=:]\s*)\S+/gi, '$1[redacted]');
}

export function clipText(text, maximum = MAX_SECTION_CHARS) {
  const value = sanitizeText(text).trim();
  if (value.length <= maximum) return value;
  return `${value.slice(0, maximum)}\n\n…truncated…`;
}

export async function readOptionalText(path) {
  try {
    return clipText(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

export async function readOptionalJson(path) {
  const text = await readOptionalText(path);
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function renderSection(title, body) {
  if (!body) return '';
  return `\n<details>\n<summary>${title}</summary>\n\n${body}\n\n</details>\n`;
}

export function renderOutcomeRows(outcomes) {
  return Object.entries(outcomes)
    .map(([name, outcome]) => `| ${name} | ${normalizeOutcome(outcome)} |`)
    .join('\n');
}

export function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function createGitHubRequest(userAgent) {
  const repository = requiredEnv('GITHUB_REPOSITORY');
  const token = requiredEnv('GITHUB_TOKEN');
  return async function githubRequest(method, path, payload) {
    const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': userAgent,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: payload == null ? undefined : JSON.stringify(payload),
    });
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { message: text.slice(0, 500) };
      }
    }
    if (!response.ok) {
      throw new Error(`GitHub ${method} ${path} failed: ${response.status} ${text.slice(0, 500)}`);
    }
    return body;
  };
}

export async function publishCommitStatuses({
  request,
  targetSha,
  runUrl,
  outcomes,
  contexts,
  overallDescription,
}) {
  const statusPath = `/statuses/${encodeURIComponent(targetSha)}`;
  for (const [key, context] of Object.entries(contexts)) {
    const outcome = normalizeOutcome(outcomes[key]);
    await request('POST', statusPath, {
      state: statusState(outcome),
      context,
      description: `${key}: ${outcome}`.slice(0, 140),
      target_url: runUrl,
    });
  }
  const overall = overallOutcome(outcomes);
  await request('POST', statusPath, {
    state: overall,
    context: 'observability/overall',
    description: `${overallDescription}: ${overall}`.slice(0, 140),
    target_url: runUrl,
  });
}

export async function findStatusIssue({ request, title, marker }) {
  const issues = await request('GET', '/issues?state=all&per_page=100&sort=updated&direction=desc');
  return issues.find((issue) => (
    !issue.pull_request
    && issue.title === title
    && String(issue.body || '').includes(marker)
  )) || null;
}

export async function upsertStatusIssue({ request, title, marker, body, existingIssue = null }) {
  const existing = existingIssue || await findStatusIssue({ request, title, marker });
  if (existing) {
    return request('PATCH', `/issues/${existing.number}`, {
      title,
      body,
      state: 'open',
    });
  }
  return request('POST', '/issues', { title, body });
}
