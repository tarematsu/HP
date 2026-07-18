import { json } from "./http";

export function unauthorized(): Response {
  return json({ error: "unauthorized" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
}

export function methodNotAllowed(allowed: string[]): Response {
  return json({ error: "method not allowed" }, { status: 405, headers: { Allow: allowed.join(", ") } });
}

export function suppliedEtags(request: Request): string[] {
  return request.headers.get("If-None-Match")?.split(",").map(value => value.trim()) ?? [];
}

function suppliedEtagMatches(request: Request, tag: string): boolean {
  const value = request.headers.get("If-None-Match");
  if (!value) return false;
  let start = 0;
  while (start <= value.length) {
    let end = value.indexOf(",", start);
    if (end < 0) end = value.length;
    while (start < end && (value.charCodeAt(start) === 32 || value.charCodeAt(start) === 9)) start += 1;
    while (end > start && (value.charCodeAt(end - 1) === 32 || value.charCodeAt(end - 1) === 9)) end -= 1;
    const length = end - start;
    if ((length === 1 && value.charCodeAt(start) === 42) ||
        (length === tag.length && value.startsWith(tag, start))) {
      return true;
    }
    if (end === value.length) return false;
    start = value.indexOf(",", end) + 1;
  }
  return false;
}

export function etagResponse(
  request: Request,
  body: BodyInit,
  contentType: string,
  etag: string,
  extraHeaders?: HeadersInit,
): Response {
  const tag = `"${etag}"`;
  const notModified = suppliedEtagMatches(request, tag);
  const status = notModified ? 304 : 200;
  const responseBody = notModified ? null : body;
  if (!extraHeaders) {
    return new Response(responseBody, {
      status,
      headers: {
        ETag: tag,
        "Cache-Control": "private, max-age=0, must-revalidate",
        "Content-Type": contentType,
        Vary: "Accept-Encoding",
      },
    });
  }
  const headers = new Headers(extraHeaders);
  headers.set("ETag", tag);
  headers.set("Cache-Control", "private, max-age=0, must-revalidate");
  headers.set("Content-Type", contentType);
  headers.set("Vary", "Accept-Encoding");
  return new Response(responseBody, { status, headers });
}
