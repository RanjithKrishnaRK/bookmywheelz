// Small helpers shared by every /api route so they all fail the same way.

// One error shape for every endpoint: { error: { code, message } }. `code` is for programs, `message` is safe
// to show a user. Never put database messages, SQL or stack traces in here: they leak how the system works.
export function apiError(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return Response.json({ error: { code, message, ...extra } }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function apiOk(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

// Log the real cause for us, give the user a generic message.
export function serverError(context: string, cause: unknown) {
  console.error(`[api] ${context}:`, cause);
  return apiError(500, 'server_error', 'Something went wrong. Please try again.');
}

// CSRF defence for cookie-authenticated POSTs. The session lives in a cookie, and browsers attach cookies to
// requests a hostile site triggers. Three independent checks, so one gap is not fatal:
//  1. Content-Type must be application/json. A plain HTML <form> cannot send that cross-site without a CORS
//     preflight, which we never approve.
//  2. If the browser says the request is cross-site (Sec-Fetch-Site), refuse it.
//  3. If an Origin header is present it must match our own host. (Non-browser clients send none, and they do
//     not carry the victim's cookie, so allowing "absent" is safe.)
export function guardMutation(request: Request): Response | null {
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return apiError(415, 'unsupported_media_type', 'Send JSON with Content-Type: application/json.');
  }
  if (request.headers.get('sec-fetch-site') === 'cross-site') return apiError(403, 'forbidden', 'Cross-site requests are not allowed.');
  const origin = request.headers.get('origin');
  if (origin) {
    let same = false;
    try { same = new URL(origin).host === new URL(request.url).host; } catch { same = false; }
    if (!same) return apiError(403, 'forbidden', 'Cross-site requests are not allowed.');
  }
  return null;
}

// Read a JSON body with a hard size cap. Checking Content-Length alone is not enough (it can be absent or a
// lie), so count the bytes actually received and stop reading at the limit. Booking payloads are tiny.
export async function readJson(request: Request, maxBytes = 10_000): Promise<{ ok: true; data: unknown } | { ok: false; response: Response }> {
  const tooBig = { ok: false as const, response: apiError(413, 'payload_too_large', 'Request body is too large.') };
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > maxBytes) return tooBig;
  if (!request.body) return { ok: false, response: apiError(400, 'invalid_json', 'Request body must be JSON.') };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); return tooBig; }
    chunks.push(value);
  }
  try {
    return { ok: true, data: JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))) };
  } catch {
    return { ok: false, response: apiError(400, 'invalid_json', 'Request body must be valid JSON.') };
  }
}
