import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CliContext } from '../src/cli/shared.js';
import { registerBookmarksCommand } from '../src/commands/bookmarks.js';

const mocks = vi.hoisted(() => ({
  getBookmarks: vi.fn(),
  getBookmarkFolderTimeline: vi.fn(),
}));

vi.mock('../src/lib/twitter-client.js', () => ({
  TwitterClient: class {
    getBookmarks = mocks.getBookmarks;
    getBookmarkFolderTimeline = mocks.getBookmarkFolderTimeline;
  },
}));

describe('bookmarks command', () => {
  beforeEach(() => {
    mocks.getBookmarks.mockReset();
    mocks.getBookmarkFolderTimeline.mockReset();
  });

  it('prints JSON with cursor payload', async () => {
    const tweet = { id: '1', text: 'saved', author: { username: 'root', name: 'Root' } };
    mocks.getBookmarks.mockResolvedValueOnce({
      success: true,
      tweets: [tweet],
      nextCursor: 'cursor-1',
      errors: ['Query: Unspecified'],
    });

    const ctx = {
      resolveTimeoutFromOptions: () => undefined,
      resolveCredentialsFromOptions: async () => ({
        cookies: {
          authToken: 'auth',
          ct0: 'ct0',
          cookieHeader: 'auth_token=auth; ct0=ct0',
          source: 'test',
        },
        warnings: [],
      }),
      p: () => '',
      printTweets: vi.fn(),
    } as CliContext;

    const program = new Command();
    registerBookmarksCommand(program, ctx);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync(['node', 'bird', 'bookmarks', '--json-with-cursor'], { from: 'node' });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(ctx.printTweets).not.toHaveBeenCalled();

    const payload = JSON.parse(logSpy.mock.calls[0][0]);
    expect(payload).toEqual({ tweets: [tweet], nextCursor: 'cursor-1', errors: ['Query: Unspecified'] });
  });
});
