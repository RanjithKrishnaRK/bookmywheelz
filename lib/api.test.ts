import { describe, expect, it } from 'vitest';
import { guardMutation, readJson } from './api';

const req = (headers: Record<string, string>, body: BodyInit | null = '{}', url = 'https://bookmywheelz.test/api/bookings') =>
  new Request(url, { method: 'POST', headers, body });
const JSON_CT = { 'content-type': 'application/json' };
const status = (r: Response | null) => r?.status ?? null;

describe('guardMutation (CSRF defence)', () => {
  it('allows a same-origin JSON request', () => expect(guardMutation(req({ ...JSON_CT, origin: 'https://bookmywheelz.test' }))).toBeNull());
  it('allows a non-browser client that sends no Origin', () => expect(guardMutation(req(JSON_CT))).toBeNull());
  it('rejects a form-style content type (what a hostile <form> can send cross-site)', () => {
    for (const ct of ['application/x-www-form-urlencoded', 'text/plain', 'multipart/form-data; boundary=x', '']) expect(status(guardMutation(req(ct ? { 'content-type': ct } : {})))).toBe(415);
  });
  it('rejects a different Origin, including look-alike hosts', () => {
    for (const o of ['https://evil.example', 'https://bookmywheelz.test.evil.example', 'https://evilbookmywheelz.test', 'http://bookmywheelz.test:8080', 'null', 'not a url'])
      expect(status(guardMutation(req({ ...JSON_CT, origin: o }))), o).toBe(403);
  });
  it('rejects requests the browser marks as cross-site', () => expect(status(guardMutation(req({ ...JSON_CT, 'sec-fetch-site': 'cross-site' })))).toBe(403));
  it('allows same-origin and same-site fetch metadata', () => {
    for (const v of ['same-origin', 'none']) expect(guardMutation(req({ ...JSON_CT, 'sec-fetch-site': v }))).toBeNull();
  });
});

describe('readJson', () => {
  it('parses a small body', async () => expect(await readJson(req(JSON_CT, '{"a":1}'))).toEqual({ ok: true, data: { a: 1 } }));
  it('rejects invalid JSON with 400', async () => { const r = await readJson(req(JSON_CT, '{nope')); expect(r.ok === false && r.response.status).toBe(400); });
  it('rejects an oversized body with 413 even when Content-Length is absent or lies', async () => {
    const big = JSON.stringify({ x: 'a'.repeat(20_000) });
    const r = await readJson(req(JSON_CT, big)); expect(r.ok === false && r.response.status).toBe(413);
    const lie = await readJson(req({ ...JSON_CT, 'content-length': '5' }, big)); expect(lie.ok === false && lie.response.status).toBe(413);
  });
  it('treats an empty body as invalid JSON', async () => { const r = await readJson(req(JSON_CT, null)); expect(r.ok === false && r.response.status).toBe(400); });
});
