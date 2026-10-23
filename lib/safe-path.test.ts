import { describe, expect, it } from 'vitest';
import { safeNextPath } from './safe-path';

describe('safeNextPath', () => {
  it.each(['/cars/abc', '/owner/new', '/search?city=Hyderabad&fuel=petrol', '/cars/abc#book', '/'])('keeps the same-site path %s', (p) => expect(safeNextPath(p)).toBe(p));
  it.each([
    ['absolute URL', 'https://evil.example'], ['http URL', 'http://evil.example/x'], ['protocol-relative', '//evil.example'],
    ['triple slash', '///evil.example'], ['backslash form', '/\\evil.example'], ['double backslash', '/\\\\evil.example'],
    ['backslash later in path', '/ok/\\evil.example'], ['tab trick', '/\t/evil.example'], ['newline trick', '/\n/evil.example'],
    ['carriage return', '/\r/evil.example'], ['null byte', '/ok\u0000x'], ['userinfo trick', '@evil.example'],
    ['javascript scheme', 'javascript:alert(1)'], ['relative path', 'cars/abc'], ['data URL', 'data:text/html,x'], ['empty', ''], ['whitespace only', '  '],
  ])('rejects %s', (_label, raw) => expect(safeNextPath(raw)).toBe('/owner/new'));
  it('rejects null and undefined', () => { expect(safeNextPath(null)).toBe('/owner/new'); expect(safeNextPath(undefined)).toBe('/owner/new'); });
  it('uses a custom fallback when given', () => expect(safeNextPath('//x', '/home')).toBe('/home'));
});
