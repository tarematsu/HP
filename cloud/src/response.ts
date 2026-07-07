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

export function etagResponse(
  request: Request,
  body: BodyInit,
  contentType: string,
  etag: string,
  extraHeaders?: HeadersInit,
): Response {
  const tag = `"${etag}"`;
  const headers = new Headers(extraHeaders);
  headers.set("ETag", tag);
  headers.set("Cache-Control", "private, max-age=0, must-revalidate");
  headers.set("Content-Type", contentType);
  headers.set("Vary", "Accept-Encoding");
  if (suppliedEtags(request).includes(tag)) return new Response(null, { status: 304, headers });
  return new Response(body, { status: 200, headers });
}
