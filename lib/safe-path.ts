// Validates a "where to go after sign-in" value. The ONE place this rule lives: the login page and the
// /auth/callback route both use it, so they cannot drift apart.
//
// Only same-site absolute paths are allowed ("/cars/123?x=1"). Anything else falls back to a safe default.
// Why it matters: a sign-in email link is genuine, so if ?next=https://evil.example were honoured, our own link
// would bounce a freshly signed-in user to an attacker's lookalike page (a classic phishing helper).
// Rejected on purpose:
//  - not starting with "/"            (https://..., //host, "@host", relative paths)
//  - starting with "//" or "/\"       (protocol-relative forms that browsers treat as another host)
//  - ANY backslash or control char    (browsers strip tabs/newlines and normalise "\" to "/", turning
//                                      "/<TAB>/evil.example" or "/\evil.example" into "//evil.example")
export function safeNextPath(raw: string | null | undefined, fallback = '/owner/new'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;
  return raw;
}
