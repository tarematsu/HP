export function replaceObservabilityCurrentMainSha(issueBody, mainSha) {
  const body = String(issueBody || '');
  const sha = String(mainSha || '').trim();
  if (!sha || sha === 'unknown') return body;

  return body.replace(
    /(\*\*Current main SHA:\*\*\s*`)[^`\n]+(`)/,
    (_match, prefix, suffix) => `${prefix}${sha}${suffix}`,
  );
}

export async function resolveObservabilityMainSha(request, { ref = 'main' } = {}) {
  if (typeof request !== 'function') throw new TypeError('request must be a function');
  const target = String(ref || 'main').trim() || 'main';
  try {
    const commit = await request('GET', `/commits/${encodeURIComponent(target)}`);
    return String(commit?.sha || 'unknown').trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}
