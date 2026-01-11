import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

type RunResult = { exitCode: number; stdout: string; stderr: string; signal: NodeJS.Signals | null };

const LIVE = process.env.BIRD_LIVE === '1';

const authToken = (process.env.AUTH_TOKEN ?? process.env.TWITTER_AUTH_TOKEN ?? '').trim();
const ct0 = (process.env.CT0 ?? process.env.TWITTER_CT0 ?? '').trim();

const CLI_PATH = path.resolve(process.cwd(), 'dist', 'cli.js');

const WHOAMI_HANDLE_REGEX = /^user:\s*@([A-Za-z0-9_]+)/m;
const WHOAMI_USER_ID_REGEX = /^user_id:\s*([0-9]+)/m;
const TWEET_ID_REGEX = /^\d+$/;
const LIVE_NODE_ENV = (process.env.BIRD_LIVE_NODE_ENV ?? 'production').trim() || 'production';

function runBird(args: string[], options: { timeoutMs?: number } = {}): Promise<RunResult> {
  if (!LIVE) {
    throw new Error('runBird() called without BIRD_LIVE=1');
  }

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        AUTH_TOKEN: authToken,
        CT0: ct0,
        NODE_ENV: LIVE_NODE_ENV,
      },
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    const killTimer =
      typeof options.timeoutMs === 'number' && options.timeoutMs > 0
        ? setTimeout(() => {
            child.kill('SIGKILL');
          }, options.timeoutMs)
        : null;

    child.on('close', (code, signal) => {
      if (killTimer) {
        clearTimeout(killTimer);
      }
      resolve({
        exitCode: code ?? (signal ? 1 : 0),
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        signal: signal ?? null,
      });
    });
  });
}

function parseJson<T>(stdout: string): T {
  try {
    return JSON.parse(stdout) as T;
  } catch (error) {
    throw new Error(`Invalid JSON output: ${error instanceof Error ? error.message : String(error)}\n${stdout}`);
  }
}

const d = LIVE ? describe : describe.skip;

d('live CLI (Twitter/X)', () => {
  const timeoutArg = (process.env.BIRD_LIVE_TIMEOUT_MS ?? '20000').trim();
  const cookieTimeoutArg = (process.env.BIRD_LIVE_COOKIE_TIMEOUT_MS ?? '30000').trim();
  const baseArgs = ['--plain', '--timeout', timeoutArg, '--quote-depth', '0'];

  let whoamiStdout = '';
  let handle = '';
  let userId = '';
  let tweetId = '';

  beforeAll(async () => {
    if (!existsSync(CLI_PATH)) {
      throw new Error(`Missing ${CLI_PATH}. Run: pnpm run build:dist`);
    }

    if (!authToken || !ct0) {
      const check = await runBird([...baseArgs, '--cookie-timeout', cookieTimeoutArg, 'check'], { timeoutMs: 45_000 });
      if (check.exitCode !== 0) {
        throw new Error(
          'Missing live credentials.\n' +
            '- Option A: set AUTH_TOKEN + CT0 (or TWITTER_AUTH_TOKEN/TWITTER_CT0)\n' +
            '- Option B: login to x.com in Safari/Chrome/Firefox for cookie extraction\n\n' +
            `bird check output:\n${check.stdout}\n${check.stderr}`,
        );
      }
    }

    const who = await runBird([...baseArgs, '--cookie-timeout', cookieTimeoutArg, 'whoami'], { timeoutMs: 45_000 });
    if (who.exitCode !== 0) {
      throw new Error(`whoami failed (exit ${who.exitCode}, signal ${who.signal ?? 'none'}):\n${who.stderr}`);
    }
    whoamiStdout = who.stdout;

    const handleMatch = WHOAMI_HANDLE_REGEX.exec(who.stdout);
    if (!handleMatch?.[1]) {
      throw new Error(`Could not parse whoami handle:\n${who.stdout}`);
    }
    handle = handleMatch[1];

    const userIdMatch = WHOAMI_USER_ID_REGEX.exec(who.stdout);
    if (!userIdMatch?.[1]) {
      throw new Error(`Could not parse whoami user_id:\n${who.stdout}`);
    }
    userId = userIdMatch[1];

    const forcedTweetId = (process.env.BIRD_LIVE_TWEET_ID ?? '').trim();
    if (forcedTweetId) {
      if (!TWEET_ID_REGEX.test(forcedTweetId)) {
        throw new Error(`Invalid BIRD_LIVE_TWEET_ID (expected digits): "${forcedTweetId}"`);
      }
      tweetId = forcedTweetId;
      return;
    }

    const searchQuery = (
      process.env.BIRD_LIVE_SEARCH_QUERY ?? `from:${handle} -filter:replies -filter:retweets`
    ).trim();
    const search = await runBird(
      [...baseArgs, '--cookie-timeout', cookieTimeoutArg, 'search', searchQuery, '-n', '25', '--json'],
      {
        timeoutMs: 45_000,
      },
    );
    if (search.exitCode !== 0) {
      throw new Error(`search failed (exit ${search.exitCode}, signal ${search.signal ?? 'none'}):\n${search.stderr}`);
    }
    const tweets = parseJson<Array<{ id?: string }>>(search.stdout);
    const first = String(tweets[0]?.id ?? '');
    if (!TWEET_ID_REGEX.test(first)) {
      throw new Error(
        `Search returned no usable tweets. Query: "${searchQuery}". ` +
          `Override with BIRD_LIVE_SEARCH_QUERY.\n${search.stdout}`,
      );
    }
    tweetId = first;
  });

  it('requires env credentials + built dist CLI', async () => {
    expect(existsSync(CLI_PATH)).toBe(true);
    expect(whoamiStdout.length).toBeGreaterThan(0);
  });

  it('whoami works', async () => {
    expect(whoamiStdout).toContain('user: @');
    expect(whoamiStdout).toContain('user_id:');
    expect(whoamiStdout).toContain('engine:');
    expect(whoamiStdout).toContain('credentials:');
  });

  it('read returns tweet JSON', async () => {
    const read = await runBird([...baseArgs, '--cookie-timeout', cookieTimeoutArg, 'read', tweetId, '--json'], {
      timeoutMs: 45_000,
    });
    expect(read.exitCode).toBe(0);
    const readTweet = parseJson<{ id?: string; author?: { username?: string } }>(read.stdout);
    expect(readTweet.id).toBe(tweetId);
    expect(readTweet.author?.username?.length).toBeGreaterThan(0);
  });

  it('tweet-id shorthand returns tweet JSON', async () => {
    const shorthand = await runBird([...baseArgs, '--cookie-timeout', cookieTimeoutArg, tweetId, '--json'], {
      timeoutMs: 45_000,
    });
    expect(shorthand.exitCode).toBe(0);
    const shorthandTweet = parseJson<{ id?: string }>(shorthand.stdout);
    expect(shorthandTweet.id).toBe(tweetId);
  });

  it('replies returns JSON array', async () => {
    const replies = await runBird([...baseArgs, '--cookie-timeout', cookieTimeoutArg, 'replies', tweetId, '--json'], {
      timeoutMs: 45_000,
    });
    expect(replies.exitCode).toBe(0);
    const replyTweets = parseJson<Array<{ id?: string }>>(replies.stdout);
    expect(Array.isArray(replyTweets)).toBe(true);
  });

  it('thread returns JSON array', async () => {
    const thread = await runBird([...baseArgs, '--cookie-timeout', cookieTimeoutArg, 'thread', tweetId, '--json'], {
      timeoutMs: 45_000,
    });
    expect(thread.exitCode).toBe(0);
    const threadTweets = parseJson<Array<{ id?: string }>>(thread.stdout);
    expect(Array.isArray(threadTweets)).toBe(true);
    expect(threadTweets.length).toBeGreaterThan(0);
  });

  it('mentions returns JSON array', async () => {
    const mentions = await runBird(
      [...baseArgs, '--cookie-timeout', cookieTimeoutArg, 'mentions', '-n', '10', '--json'],
      {
        timeoutMs: 45_000,
      },
    );
    expect(mentions.exitCode).toBe(0);
    const mentionTweets = parseJson<Array<{ id?: string }>>(mentions.stdout);
    expect(Array.isArray(mentionTweets)).toBe(true);
  });

  it('bookmarks returns JSON array', async () => {
    const bookmarks = await runBird(
      [...baseArgs, '--cookie-timeout', cookieTimeoutArg, 'bookmarks', '-n', '10', '--json'],
      {
        timeoutMs: 45_000,
      },
    );
    expect(bookmarks.exitCode).toBe(0);
    const bookmarkTweets = parseJson<Array<{ id?: string }>>(bookmarks.stdout);
    expect(Array.isArray(bookmarkTweets)).toBe(true);
  });

  it('bookmarks --folder-id works (opt-in)', async () => {
    const folderId = (process.env.BIRD_LIVE_BOOKMARK_FOLDER_ID ?? '').trim();
    if (!folderId) {
      return;
    }
    const bookmarks = await runBird(
      [...baseArgs, '--cookie-timeout', cookieTimeoutArg, 'bookmarks', '--folder-id', folderId, '-n', '10', '--json'],
      { timeoutMs: 45_000 },
    );
    expect(bookmarks.exitCode).toBe(0);
    const bookmarkTweets = parseJson<Array<{ id?: string }>>(bookmarks.stdout);
    expect(Array.isArray(bookmarkTweets)).toBe(true);
  });

  it('likes returns JSON array', async () => {
    const likes = await runBird([...baseArgs, '--cookie-timeout', cookieTimeoutArg, 'likes', '-n', '10', '--json'], {
      timeoutMs: 45_000,
    });
    expect(likes.exitCode).toBe(0);
    const likeTweets = parseJson<Array<{ id?: string }>>(likes.stdout);
    expect(Array.isArray(likeTweets)).toBe(true);
  });

  it('following returns JSON array', async () => {
    const following = await runBird(
      [...baseArgs, '--cookie-timeout', cookieTimeoutArg, 'following', '--user', userId, '-n', '10', '--json'],
      {
        timeoutMs: 45_000,
      },
    );
    expect(following.exitCode).toBe(0);
    const followingUsers = parseJson<Array<{ id?: string; username?: string }>>(following.stdout);
    expect(Array.isArray(followingUsers)).toBe(true);
  });

  it('followers returns JSON array', async () => {
    const followers = await runBird(
      [...baseArgs, '--cookie-timeout', cookieTimeoutArg, 'followers', '--user', userId, '-n', '10', '--json'],
      {
        timeoutMs: 45_000,
      },
    );
    expect(followers.exitCode).toBe(0);
    const followerUsers = parseJson<Array<{ id?: string; username?: string }>>(followers.stdout);
    expect(Array.isArray(followerUsers)).toBe(true);
  });

  it('user-tweets returns JSON array', async () => {
    // Use a known active account for reliable testing (authenticated user may have no tweets)
    const testHandle = process.env.BIRD_LIVE_USER_TWEETS_HANDLE || 'X';
    const userTweets = await runBird(
      [...baseArgs, '--cookie-timeout', cookieTimeoutArg, 'user-tweets', testHandle, '-n', '5', '--json'],
      {
        timeoutMs: 45_000,
      },
    );
    expect(userTweets.exitCode).toBe(0);
    const tweets = parseJson<Array<{ id?: string; author?: { username?: string } }>>(userTweets.stdout);
    expect(Array.isArray(tweets)).toBe(true);
    expect(tweets.length).toBeGreaterThan(0);
    expect(tweets[0].author?.username?.toLowerCase()).toBe(testHandle.toLowerCase());
  });

  it('query-ids returns JSON', async () => {
    const queryIds = await runBird([...baseArgs, '--cookie-timeout', cookieTimeoutArg, 'query-ids', '--json'], {
      timeoutMs: 60_000,
    });
    expect(queryIds.exitCode).toBe(0);
    const snapshot = parseJson<{ cached?: boolean; ids?: Record<string, string> }>(queryIds.stdout);
    expect(typeof snapshot.cached).toBe('boolean');
  });

  it('query-ids --fresh works (opt-in)', async () => {
    if (process.env.BIRD_LIVE_QUERY_IDS_FRESH !== '1') {
      return;
    }
    const queryIds = await runBird([...baseArgs, 'query-ids', '--fresh', '--json'], { timeoutMs: 5 * 60_000 });
    expect(queryIds.exitCode).toBe(0);
    const snapshot = parseJson<{ cached?: boolean; ids?: Record<string, string> }>(queryIds.stdout);
    expect(snapshot.cached).toBe(true);
    expect(snapshot.ids && Object.keys(snapshot.ids).length).toBeGreaterThan(0);
  });
});
