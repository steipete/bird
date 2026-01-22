import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const resolveCredentialsMock = vi.hoisted(() =>
  vi.fn(async () => ({
    cookies: { authToken: null, ct0: null, cookieHeader: null, source: null },
    warnings: [],
  })),
);

vi.mock('../src/lib/cookies.js', () => ({
  resolveCredentials: resolveCredentialsMock,
}));

import { createCliContext } from '../src/cli/shared.js';

describe('cli shared', () => {
  const originalHome = process.env.HOME;

  afterEach(() => {
    process.env.HOME = originalHome;
    resolveCredentialsMock.mockClear();
  });

  it('prefers --chrome-profile-dir over --chrome-profile', async () => {
    const ctx = createCliContext([]);
    await ctx.resolveCredentialsFromOptions({
      chromeProfile: 'Default',
      chromeProfileDir: '/tmp/Arc Profile',
      cookieSource: ['chrome'],
    });

    expect(resolveCredentialsMock).toHaveBeenCalledTimes(1);
    expect(resolveCredentialsMock.mock.calls[0]?.[0]?.chromeProfile).toBe('/tmp/Arc Profile');
  });

  it('uses chromeProfileDir from config when provided', async () => {
    const tempHome = mkdtempSync(join(tmpdir(), 'bird-home-'));
    const configDir = join(tempHome, '.config', 'bird');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json5'), '{ chromeProfileDir: "/tmp/Brave/Profile 1" }', 'utf8');
    process.env.HOME = tempHome;

    try {
      const ctx = createCliContext([]);
      await ctx.resolveCredentialsFromOptions({ cookieSource: ['chrome'] });

      expect(resolveCredentialsMock).toHaveBeenCalledTimes(1);
      expect(resolveCredentialsMock.mock.calls[0]?.[0]?.chromeProfile).toBe('/tmp/Brave/Profile 1');
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });
});
