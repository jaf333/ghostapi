import { describe, expect, it } from 'vitest';
import { isGhostError, type GhostError } from '@ghostapi/core';
import { cookiesForUrl, resolveAuth } from './auth-context.js';

const cookie = (overrides: Partial<Parameters<typeof cookiesForUrl>[0][number]> = {}) => ({
  name: 'sid',
  value: 'abc',
  domain: 'app.example.com',
  path: '/',
  expires: -1,
  ...overrides,
});

describe('resolveAuth', () => {
  it('returns nothing for an unauthenticated operation', () => {
    expect(resolveAuth({ strategy: 'none' }, {}).headers).toEqual({});
  });

  it('builds a Cookie header from the stored session', () => {
    const resolved = resolveAuth({ strategy: 'browser-session', cookieNames: [] }, {
      cookies: [cookie(), cookie({ name: 'csrf', value: 'xyz' })],
    });
    expect(resolved.headers.cookie).toBe('sid=abc; csrf=xyz');
  });

  it('explains how to re-authenticate when there is no session', () => {
    try {
      resolveAuth({ strategy: 'browser-session', cookieNames: [] }, { cookies: [] });
      throw new Error('expected resolveAuth to throw');
    } catch (error) {
      expect(isGhostError(error)).toBe(true);
      const ghost = error as GhostError;
      expect(ghost.code).toBe('auth_expired');
      expect(ghost.remedy).toMatch(/ghostapi open/);
    }
  });

  it('reads a header credential from the environment, never from the store', () => {
    const resolved = resolveAuth(
      { strategy: 'header', header: 'Authorization', env: 'MY_TOKEN', prefix: 'Bearer ' },
      { env: { MY_TOKEN: 'secret-value' } },
    );
    expect(resolved.headers.authorization).toBe('Bearer secret-value');
  });

  it('names the missing variable when a header credential is absent', () => {
    expect(() =>
      resolveAuth({ strategy: 'header', header: 'Authorization', env: 'MY_TOKEN' }, { env: {} }),
    ).toThrow(/MY_TOKEN/);
  });

  it('never puts a credential value into the error text', () => {
    try {
      resolveAuth({ strategy: 'header', header: 'Authorization', env: 'MY_TOKEN' }, { env: {} });
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain('secret-value');
    }
  });
});

describe('cookiesForUrl', () => {
  it('sends a cookie only to its own domain', () => {
    const jar = [cookie()];
    expect(cookiesForUrl(jar, 'https://app.example.com/api')).toHaveLength(1);
    expect(cookiesForUrl(jar, 'https://evil.example.org/api')).toHaveLength(0);
  });

  it('honours a domain cookie across subdomains', () => {
    const jar = [cookie({ domain: '.example.com' })];
    expect(cookiesForUrl(jar, 'https://api.example.com/x')).toHaveLength(1);
  });

  it('honours the cookie path', () => {
    const jar = [cookie({ path: '/admin' })];
    expect(cookiesForUrl(jar, 'https://app.example.com/admin/x')).toHaveLength(1);
    expect(cookiesForUrl(jar, 'https://app.example.com/public')).toHaveLength(0);
  });

  it('drops expired cookies', () => {
    const jar = [cookie({ expires: 1 })];
    expect(cookiesForUrl(jar, 'https://app.example.com/')).toHaveLength(0);
  });
});
