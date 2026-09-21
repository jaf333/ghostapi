import { describe, expect, it } from 'vitest';
import { REDACTED, SecretRedactor, defaultRedactor } from './redaction.js';

describe('SecretRedactor', () => {
  it('redacts credential-bearing headers by name', () => {
    const result = defaultRedactor.redactHeaders({
      Authorization: 'Bearer abc123def456',
      Cookie: 'session=super-secret-value',
      'Content-Type': 'application/json',
    });
    expect(result.value.authorization).toBe(REDACTED);
    expect(result.value.cookie).toBe(REDACTED);
    expect(result.value['content-type']).toBe('application/json');
    expect(result.redactions.map((record) => record.path)).toContain('headers.authorization');
  });

  it('redacts values that look like credentials regardless of the header name', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdef';
    const result = defaultRedactor.redactHeaders({ 'x-custom': jwt });
    expect(result.value['x-custom']).toBe(REDACTED);
    expect(result.redactions[0]?.reason).toBe('sensitive-value:jwt');
  });

  it('redacts by key name anywhere in a nested body', () => {
    const result = defaultRedactor.redactValue(
      { user: { email: 'a@b.com', password: 'hunter2' }, items: [{ apiKey: 'zzz' }] },
      'requestBody',
    );
    const value = result.value as {
      user: { email: string; password: string };
      items: { apiKey: string }[];
    };
    expect(value.user.email).toBe('a@b.com');
    expect(value.user.password).toBe(REDACTED);
    expect(value.items[0]?.apiKey).toBe(REDACTED);
  });

  it('preserves the JSON shape so schema inference stays correct', () => {
    const result = defaultRedactor.redactValue({ title: 'hi', token: 'abc' });
    expect(Object.keys(result.value as object).sort()).toEqual(['title', 'token']);
    expect(typeof (result.value as { token: unknown }).token).toBe('string');
  });

  it('scrubs known literal secrets wherever they appear', () => {
    const redactor = new SecretRedactor({ literals: ['live-session-cookie-value'] });
    const result = redactor.redactValue({ note: 'sent live-session-cookie-value to the server' });
    expect(JSON.stringify(result.value)).not.toContain('live-session-cookie-value');
    expect(result.redactions[0]?.reason).toBe('known-literal');
  });

  it('redacts URL credentials and sensitive query parameters', () => {
    const { url, redactions } = defaultRedactor.redactUrl(
      'https://user:pw@example.com/api?access_token=abc123xyz789&page=2',
    );
    expect(url).not.toContain('user:pw');
    expect(url).toContain(`access_token=${encodeURIComponent(REDACTED)}`);
    expect(url).toContain('page=2');
    expect(redactions.length).toBeGreaterThanOrEqual(2);
  });

  it('positive control: an unredacted document still contains the secret', () => {
    // Guards the negative assertions above. If this ever passes trivially, the
    // detector has stopped detecting anything.
    const raw = JSON.stringify({ authorization: 'Bearer abc123def456' });
    expect(raw).toContain('abc123def456');
    const redacted = JSON.stringify(
      defaultRedactor.redactHeaders({ authorization: 'Bearer abc123def456' }).value,
    );
    expect(redacted).not.toContain('abc123def456');
  });

  it('leaves ordinary short strings alone', () => {
    const result = defaultRedactor.redactValue({ title: 'Buy milk', priority: 'high', count: 3 });
    expect(result.value).toEqual({ title: 'Buy milk', priority: 'high', count: 3 });
    expect(result.redactions).toHaveLength(0);
  });
});

describe('regressions', () => {
  it('redacts a vendor credential header nobody enumerated', () => {
    // A header name that is on no denylist, carrying a value that matches no
    // known credential format. Before this fix it was stored verbatim and then
    // baked into exported operations as a literal.
    const result = defaultRedactor.redactHeaders({
      'X-Shopify-Access-Token': 'shpat_1234567890abcdef1234567890abcdef',
    });
    expect(result.value['x-shopify-access-token']).toBe(REDACTED);
    expect(result.redactions[0]?.reason).toMatch(/sensitive-key/);
  });

  it('redacts credential-named headers across naming conventions', () => {
    const headers = {
      'X-Session-Token': 'abcdef123456',
      'X-Vendor-Secret': 'abcdef123456',
      'Private-Key-Header': 'abcdef123456',
      'X-Credential': 'abcdef123456',
    };
    const result = defaultRedactor.redactHeaders(headers);
    for (const value of Object.values(result.value)) {
      expect(value).toBe(REDACTED);
    }
  });

  it('still leaves ordinary custom headers intact', () => {
    const result = defaultRedactor.redactHeaders({
      'X-Request-Id': 'abc-123',
      'X-Api-Version': '2026-01-01',
      'Accept-Language': 'en-GB',
    });
    expect(result.value['x-request-id']).toBe('abc-123');
    expect(result.value['x-api-version']).toBe('2026-01-01');
    expect(result.value['accept-language']).toBe('en-GB');
  });
});
