import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CliContext } from '../src/cli/shared.js';
import { registerUserCommands } from '../src/commands/users.js';
import { TwitterClient } from '../src/lib/twitter-client.js';

const baseCtx = {
  resolveTimeoutFromOptions: () => undefined,
  resolveCredentialsFromOptions: async () => ({
    cookies: { authToken: 'auth', ct0: 'ct0', cookieHeader: 'auth=auth; ct0=ct0' },
    warnings: [],
  }),
  p: () => '',
  l: () => '',
  printTweets: () => undefined,
} as unknown as CliContext;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('users about command', () => {
  it('prints account info JSON for about command', async () => {
    const program = new Command();
    registerUserCommands(program, baseCtx);
    vi.spyOn(TwitterClient.prototype, 'getUserAboutAccount').mockResolvedValue({
      success: true,
      aboutProfile: {
        accountBasedIn: 'Spain',
        source: 'Spain App Store',
        createdCountryAccurate: true,
        locationAccurate: false,
        learnMoreUrl: 'https://help.twitter.com/profile',
      },
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await program.parseAsync(['node', 'bird', 'about', 'pablotovar_', '--json']);

    const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
    expect(payload).toEqual({
      accountBasedIn: 'Spain',
      source: 'Spain App Store',
      createdCountryAccurate: true,
      locationAccurate: false,
      learnMoreUrl: 'https://help.twitter.com/profile',
    });
  });

  it('exits on about command failure', async () => {
    const program = new Command();
    registerUserCommands(program, baseCtx);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(TwitterClient.prototype, 'getUserAboutAccount').mockResolvedValue({
      success: false,
      error: 'Missing about_profile in response',
    });

    try {
      await expect(program.parseAsync(['node', 'bird', 'about', 'pablotovar__'])).rejects.toThrow('exit 1');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch account information: Missing about_profile in response'),
      );
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
