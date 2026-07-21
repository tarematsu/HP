import { resolveMediaHost } from './media-host.js';

const CSP_PREFIX = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:"
].join('; ');
const CSP_SUFFIX = "object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
let cachedMediaOrigin = '';
let cachedContentSecurityPolicy = '';

function contentSecurityPolicy(env) {
  const mediaOrigin = `https://${resolveMediaHost(env)}`;
  if (mediaOrigin === cachedMediaOrigin) return cachedContentSecurityPolicy;

  cachedMediaOrigin = mediaOrigin;
  cachedContentSecurityPolicy = `${CSP_PREFIX}; media-src 'self' ${mediaOrigin} blob:; connect-src 'self' ${mediaOrigin}; ${CSP_SUFFIX}`;
  return cachedContentSecurityPolicy;
}

export function withSecurityHeaders(response, env) {
  const headers = new Headers(response.headers);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('content-security-policy', contentSecurityPolicy(env));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
