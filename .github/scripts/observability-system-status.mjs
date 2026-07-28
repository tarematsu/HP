export const SYSTEM_STATUS_MARKER = '<!-- observability-system-status -->';

const SUCCESS_STATES = new Set(['success', 'healthy', 'running']);
const PENDING_STATES = new Set(['pending']);

function compactState(value, fallback = 'unknown') {
  return String(value || '').trim().toLowerCase() || fallback;
}

function componentState(value) {
  const state = compactState(value);
  if (SUCCESS_STATES.has(state)) return 'success';
  if (PENDING_STATES.has(state)) return 'pending';
  return 'failure';
}

export function extractCloudflareStatus(issueBody) {
  return compactState(String(issueBody || '').match(/\*\*Cloudflare status:\*\*\s*([^·\n]+)/i)?.[1]);
}

export function extractMarkedOverall(issueBody, startMarker, endMarker) {
  const body = String(issueBody || '');
  const start = body.indexOf(startMarker);
  const end = start >= 0 ? body.indexOf(endMarker, start) : -1;
  if (start < 0 || end < 0) return 'pending';
  const block = body.slice(start, end + endMarker.length);
  return compactState(block.match(/\*\*Overall:\*\*\s*([^\s\n]+)/i)?.[1], 'pending');
}

export function observabilitySystemStatus(issueBody) {
  const cloudflare = extractCloudflareStatus(issueBody);
  const runner = extractMarkedOverall(
    issueBody,
    '<!-- github-actions-runner-health:start -->',
    '<!-- github-actions-runner-health:end -->',
  );
  const deployment = extractMarkedOverall(
    issueBody,
    '<!-- github-deployment-health:start -->',
    '<!-- github-deployment-health:end -->',
  );
  const components = { cloudflare, runner, deployment };
  const normalized = Object.values(components).map(componentState);
  const overall = normalized.includes('failure')
    ? 'failure'
    : normalized.includes('pending')
      ? 'pending'
      : 'success';
  return { overall, components };
}

export function renderObservabilitySystemStatus(issueBody) {
  const { overall, components } = observabilitySystemStatus(issueBody);
  return `${SYSTEM_STATUS_MARKER}\n- **System status:** ${overall} · **Cloudflare:** ${components.cloudflare} · **Actions runner:** ${components.runner} · **Deployments:** ${components.deployment}`;
}

export function synchronizeObservabilitySystemStatus(issueBody) {
  let body = String(issueBody || '');
  const existing = new RegExp(`${SYSTEM_STATUS_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n- \\*\\*System status:\\*\\*[^\\n]*(?:\\n|$)`, 'g');
  body = body.replace(existing, '');
  const block = renderObservabilitySystemStatus(body);
  const scopeLine = body.match(/^- \*\*Scope:\*\*[^\n]*$/m);
  if (scopeLine?.index != null) {
    const insertAt = scopeLine.index + scopeLine[0].length;
    return `${body.slice(0, insertAt)}\n${block}${body.slice(insertAt)}`;
  }
  const heading = body.match(/^# Cloudflare Observability Status$/m);
  if (heading?.index != null) {
    const insertAt = heading.index + heading[0].length;
    return `${body.slice(0, insertAt)}\n\n${block}${body.slice(insertAt)}`;
  }
  return `${block}\n${body}`.trim();
}
