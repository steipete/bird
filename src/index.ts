#!/usr/bin/env node
/**
 * bird - CLI tool for posting tweets and replies
 *
 * Usage:
 *   bird tweet "Hello world!"
 *   bird reply <tweet-id> "This is a reply"
 *   bird reply <tweet-url> "This is a reply"
 *   bird read <tweet-id-or-url>
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import JSON5 from 'json5';
import kleur from 'kleur';
import { resolveCliInvocation } from './lib/cli-args.js';
import { type CookieSource, resolveCredentials } from './lib/cookies.js';
import { extractBookmarkFolderId } from './lib/extract-bookmark-folder-id.js';
import { extractTweetId } from './lib/extract-tweet-id.js';
import { mentionsQueryFromUserOption, normalizeHandle } from './lib/normalize-handle.js';
import {
  formatStatsLine,
  formatTweetUrlLine,
  labelPrefix,
  type OutputConfig,
  resolveOutputConfigFromArgv,
  resolveOutputConfigFromCommander,
  statusPrefix,
} from './lib/output.js';
import { runtimeQueryIds } from './lib/runtime-query-ids.js';
import { type TweetData, TwitterClient } from './lib/twitter-client.js';
import { getCliVersion } from './lib/version.js';

const program: Command = new Command();

const rawArgs: string[] = process.argv.slice(2);
const normalizedArgs: string[] = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
const isTty: boolean = process.stdout.isTTY;
let output: OutputConfig = resolveOutputConfigFromArgv(normalizedArgs, process.env, isTty);
kleur.enabled = output.color;

const wrap =
  (styler: (text: string) => string): ((text: string) => string) =>
  (text: string): string =>
    isTty ? styler(text) : text;
const collect = (value: string, previous: string[] = []): string[] => {
  previous.push(value);
  return previous;
};

const COOKIE_SOURCES: CookieSource[] = ['safari', 'chrome', 'firefox'];

function parseCookieSource(value: string): CookieSource {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'safari' || normalized === 'chrome' || normalized === 'firefox') {
    return normalized;
  }
  throw new Error(`Invalid --cookie-source "${value}". Allowed: safari, chrome, firefox.`);
}

function resolveCookieSourceOrder(input: unknown): CookieSource[] | undefined {
  if (typeof input === 'string') {
    return [parseCookieSource(input)];
  }
  if (Array.isArray(input)) {
    const result: CookieSource[] = [];
    for (const entry of input) {
      if (typeof entry !== 'string') {
        continue;
      }
      result.push(parseCookieSource(entry));
    }
    return result.length > 0 ? result : undefined;
  }
  return undefined;
}

const collectCookieSource = (value: string, previous: CookieSource[] = []): CookieSource[] => {
  previous.push(parseCookieSource(value));
  return previous;
};

const p = (kind: Parameters<typeof statusPrefix>[0]): string => statusPrefix(kind, output);
const l = (kind: Parameters<typeof labelPrefix>[0]): string => labelPrefix(kind, output);

function applyOutputFromCommand(command: Command): void {
  const opts = command.optsWithGlobals() as { plain?: boolean; emoji?: boolean; color?: boolean };
  output = resolveOutputConfigFromCommander(opts, process.env, isTty);
  kleur.enabled = output.color;
}

const colors = {
  banner: wrap((t) => kleur.bold().blue(t)),
  subtitle: wrap((t) => kleur.dim(t)),
  section: wrap((t) => kleur.bold().white(t)),
  bullet: wrap((t) => kleur.blue(t)),
  command: wrap((t) => kleur.bold().cyan(t)),
  option: wrap((t) => kleur.cyan(t)),
  argument: wrap((t) => kleur.magenta(t)),
  description: wrap((t) => kleur.white(t)),
  muted: wrap((t) => kleur.gray(t)),
  accent: wrap((t) => kleur.green(t)),
};

type BirdConfig = {
  chromeProfile?: string;
  firefoxProfile?: string;
  cookieSource?: CookieSource | CookieSource[];
  timeoutMs?: number;
  quoteDepth?: number;
};

function readConfigFile(path: string): Partial<BirdConfig> {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON5.parse(raw) as Partial<BirdConfig>;
    return parsed ?? {};
  } catch (error) {
    console.error(
      colors.muted(
        `${p('warn')}Failed to parse config at ${path}: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return {};
  }
}

function loadConfig(): BirdConfig {
  const globalPath = join(homedir(), '.config', 'bird', 'config.json5');
  const localPath = join(process.cwd(), '.birdrc.json5');

  return {
    ...readConfigFile(globalPath),
    ...readConfigFile(localPath),
  };
}

const config = loadConfig();

const KNOWN_COMMANDS = new Set([
  'tweet',
  'reply',
  'query-ids',
  'read',
  'replies',
  'thread',
  'search',
  'mentions',
  'bookmarks',
  'likes',
  'help',
  'whoami',
  'check',
]);

program.addHelpText(
  'beforeAll',
  () => `${colors.banner('bird CLI')} ${colors.subtitle('— fast X CLI for tweeting, replying, and reading')}`,
);

program.name('bird').description('Post tweets and replies via Twitter/X GraphQL API').version(getCliVersion());

const formatExample = (command: string, description: string): string =>
  `${colors.command(`  ${command}`)}\n${colors.muted(`    ${description}`)}`;

program.addHelpText(
  'afterAll',
  () =>
    `\n${colors.section('Examples')}\n${[
      formatExample('bird whoami', 'Show the logged-in account via GraphQL cookies'),
      formatExample('bird --firefox-profile default-release whoami', 'Use Firefox profile cookies'),
      formatExample('bird tweet "hello from bird"', 'Send a tweet'),
      formatExample('bird replies https://x.com/user/status/1234567890123456789', 'Check replies to a tweet'),
    ].join('\n\n')}`,
);

// Global options for authentication
program
  .option('--auth-token <token>', 'Twitter auth_token cookie')
  .option('--ct0 <token>', 'Twitter ct0 cookie')
  .option('--chrome-profile <name>', 'Chrome profile name for cookie extraction', config.chromeProfile)
  .option('--firefox-profile <name>', 'Firefox profile name for cookie extraction', config.firefoxProfile)
  .option(
    '--cookie-source <source>',
    'Cookie source for browser cookie extraction (repeatable)',
    collectCookieSource,
    [],
  )
  .option('--media <path>', 'Attach media file (repeatable, up to 4 images or 1 video)', collect, [])
  .option('--alt <text>', 'Alt text for the corresponding --media (repeatable)', collect, [])
  .option('--timeout <ms>', 'Request timeout in milliseconds')
  .option('--quote-depth <depth>', 'Max quoted tweet depth (default: 1; 0 disables)')
  .option('--plain', 'Plain output (stable, no emoji, no color)')
  .option('--no-emoji', 'Disable emoji output')
  .option('--no-color', 'Disable ANSI colors (or set NO_COLOR)');

type CredentialsOptions = {
  authToken?: string;
  ct0?: string;
  chromeProfile?: string;
  firefoxProfile?: string;
  cookieSource?: CookieSource[];
};

function resolveCredentialsFromOptions(opts: CredentialsOptions): ReturnType<typeof resolveCredentials> {
  const cookieSource = opts.cookieSource?.length
    ? opts.cookieSource
    : (resolveCookieSourceOrder(config.cookieSource) ?? COOKIE_SOURCES);
  return resolveCredentials({
    authToken: opts.authToken,
    ct0: opts.ct0,
    cookieSource,
    chromeProfile: opts.chromeProfile || config.chromeProfile,
    firefoxProfile: opts.firefoxProfile || config.firefoxProfile,
  });
}

program.hook('preAction', (_thisCommand, actionCommand) => {
  applyOutputFromCommand(actionCommand);
});

type MediaSpec = { path: string; alt?: string; mime: string; buffer: Buffer };

function resolveTimeoutMs(...values: Array<string | number | undefined | null>): number | undefined {
  for (const value of values) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    const parsed = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

function resolveTimeoutFromOptions(options: { timeout?: string | number }): number | undefined {
  return resolveTimeoutMs(options.timeout, config.timeoutMs, process.env.BIRD_TIMEOUT_MS);
}

function resolveQuoteDepth(...values: Array<string | number | undefined | null>): number | undefined {
  for (const value of values) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed);
    }
  }
  return undefined;
}

function resolveQuoteDepthFromOptions(options: { quoteDepth?: string | number }): number | undefined {
  return resolveQuoteDepth(options.quoteDepth, config.quoteDepth, process.env.BIRD_QUOTE_DEPTH);
}

function detectMime(path: string): string | null {
  const ext = path.toLowerCase();
  if (ext.endsWith('.jpg') || ext.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (ext.endsWith('.png')) {
    return 'image/png';
  }
  if (ext.endsWith('.webp')) {
    return 'image/webp';
  }
  if (ext.endsWith('.gif')) {
    return 'image/gif';
  }
  if (ext.endsWith('.mp4') || ext.endsWith('.m4v')) {
    return 'video/mp4';
  }
  if (ext.endsWith('.mov')) {
    return 'video/quicktime';
  }
  return null;
}

function loadMedia(opts: { media: string[]; alts: string[] }): MediaSpec[] {
  if (opts.media.length === 0) {
    return [];
  }
  const specs: MediaSpec[] = [];
  for (const [index, path] of opts.media.entries()) {
    const mime = detectMime(path);
    if (!mime) {
      throw new Error(`Unsupported media type for ${path}. Supported: jpg, jpeg, png, webp, gif, mp4, mov`);
    }
    const buffer = readFileSync(path);
    specs.push({ path, mime, buffer, alt: opts.alts[index] });
  }

  const videoCount = specs.filter((m) => m.mime.startsWith('video/')).length;
  if (videoCount > 1) {
    throw new Error('Only one video can be attached');
  }
  if (videoCount === 1 && specs.length > 1) {
    throw new Error('Video cannot be combined with other media');
  }
  if (specs.length > 4) {
    throw new Error('Maximum 4 media attachments');
  }
  return specs;
}

function printTweets(
  tweets: TweetData[],
  opts: { json?: boolean; emptyMessage?: string; showSeparator?: boolean } = {},
) {
  if (opts.json) {
    console.log(JSON.stringify(tweets, null, 2));
    return;
  }
  if (tweets.length === 0) {
    console.log(opts.emptyMessage ?? 'No tweets found.');
    return;
  }
  for (const tweet of tweets) {
    console.log(`\n@${tweet.author.username} (${tweet.author.name}):`);
    console.log(tweet.text);
    if (tweet.createdAt) {
      console.log(`${l('date')}${tweet.createdAt}`);
    }
    console.log(`${l('url')}https://x.com/${tweet.author.username}/status/${tweet.id}`);
    if (opts.showSeparator ?? true) {
      console.log('─'.repeat(50));
    }
  }
}

program
  .command('help [command]')
  .description('Show help for a command')
  .action((commandName?: string) => {
    if (!commandName) {
      program.outputHelp();
      return;
    }

    const cmd = program.commands.find((c) => c.name() === commandName);
    if (!cmd) {
      console.error(`${p('err')}Unknown command: ${commandName}`);
      process.exitCode = 2;
      return;
    }

    cmd.outputHelp();
  });

program
  .command('query-ids')
  .description('Show or refresh cached Twitter GraphQL query IDs')
  .option('--json', 'Output as JSON')
  .option('--fresh', 'Force refresh (downloads X client bundles)', false)
  .action(async (cmdOpts: { json?: boolean; fresh?: boolean }) => {
    const operations = [
      'CreateTweet',
      'CreateRetweet',
      'FavoriteTweet',
      'TweetDetail',
      'SearchTimeline',
      'UserArticlesTweets',
      'Bookmarks',
      'Likes',
    ];

    if (cmdOpts.fresh) {
      console.error(`${p('info')}Refreshing GraphQL query IDs…`);
      await runtimeQueryIds.refresh(operations, { force: true });
    }

    const info = await runtimeQueryIds.getSnapshotInfo();
    if (!info) {
      if (cmdOpts.json) {
        console.log(JSON.stringify({ cached: false, cachePath: runtimeQueryIds.cachePath }, null, 2));
        return;
      }
      console.log(`${p('warn')}No cached query IDs yet.`);
      console.log(`${p('info')}Run: bird query-ids --fresh`);
      return;
    }

    if (cmdOpts.json) {
      console.log(
        JSON.stringify(
          {
            cached: true,
            cachePath: info.cachePath,
            fetchedAt: info.snapshot.fetchedAt,
            isFresh: info.isFresh,
            ageMs: info.ageMs,
            ids: info.snapshot.ids,
            discovery: info.snapshot.discovery,
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log(`${p('ok')}GraphQL query IDs cached`);
    console.log(`path: ${info.cachePath}`);
    console.log(`fetched_at: ${info.snapshot.fetchedAt}`);
    console.log(`fresh: ${info.isFresh ? 'yes' : 'no'}`);
    console.log(`ops: ${Object.keys(info.snapshot.ids).length}`);
  });

// Tweet command
program
  .command('tweet')
  .description('Post a new tweet')
  .argument('<text>', 'Tweet text')
  .action(async (text: string) => {
    const opts = program.opts();
    const timeoutMs = resolveTimeoutFromOptions(opts);
    const quoteDepth = resolveQuoteDepthFromOptions(opts);
    let media: MediaSpec[] = [];
    try {
      media = loadMedia({ media: opts.media ?? [], alts: opts.alt ?? [] });
    } catch (error) {
      console.error(`${p('err')}${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }

    const { cookies, warnings } = await resolveCredentialsFromOptions(opts);

    for (const warning of warnings) {
      console.error(`${p('warn')}${warning}`);
    }

    if (!cookies.authToken || !cookies.ct0) {
      console.error(`${p('err')}Missing required credentials`);
      process.exit(1);
    }

    if (cookies.source) {
      console.error(`${l('source')}${cookies.source}`);
    }

    const client = new TwitterClient({ cookies, timeoutMs, quoteDepth });
    let mediaIds: string[] | undefined;
    if (media.length > 0) {
      const uploaded: string[] = [];
      for (const item of media) {
        const res = await client.uploadMedia({ data: item.buffer, mimeType: item.mime, alt: item.alt });
        if (!res.success || !res.mediaId) {
          console.error(`${p('err')}Media upload failed: ${res.error ?? 'Unknown error'}`);
          process.exit(1);
        }
        uploaded.push(res.mediaId);
      }
      mediaIds = uploaded;
    }

    const result = await client.tweet(text, mediaIds);

    if (result.success) {
      console.log(`${p('ok')}Tweet posted successfully!`);
      console.log(formatTweetUrlLine(result.tweetId, output));
    } else {
      console.error(`${p('err')}Failed to post tweet: ${result.error}`);
      process.exit(1);
    }
  });

// Reply command
program
  .command('reply')
  .description('Reply to an existing tweet')
  .argument('<tweet-id-or-url>', 'Tweet ID or URL to reply to')
  .argument('<text>', 'Reply text')
  .action(async (tweetIdOrUrl: string, text: string) => {
    const opts = program.opts();
    const timeoutMs = resolveTimeoutFromOptions(opts);
    const quoteDepth = resolveQuoteDepthFromOptions(opts);
    let media: MediaSpec[] = [];
    try {
      media = loadMedia({ media: opts.media ?? [], alts: opts.alt ?? [] });
    } catch (error) {
      console.error(`${p('err')}${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
    const tweetId = extractTweetId(tweetIdOrUrl);

    const { cookies, warnings } = await resolveCredentialsFromOptions(opts);

    for (const warning of warnings) {
      console.error(`${p('warn')}${warning}`);
    }

    if (!cookies.authToken || !cookies.ct0) {
      console.error(`${p('err')}Missing required credentials`);
      process.exit(1);
    }

    if (cookies.source) {
      console.error(`${l('source')}${cookies.source}`);
    }

    console.error(`${p('info')}Replying to tweet: ${tweetId}`);

    const client = new TwitterClient({ cookies, timeoutMs, quoteDepth });
    let mediaIds: string[] | undefined;
    if (media.length > 0) {
      const uploaded: string[] = [];
      for (const item of media) {
        const res = await client.uploadMedia({ data: item.buffer, mimeType: item.mime, alt: item.alt });
        if (!res.success || !res.mediaId) {
          console.error(`${p('err')}Media upload failed: ${res.error ?? 'Unknown error'}`);
          process.exit(1);
        }
        uploaded.push(res.mediaId);
      }
      mediaIds = uploaded;
    }

    const result = await client.reply(text, tweetId, mediaIds);

    if (result.success) {
      console.log(`${p('ok')}Reply posted successfully!`);
      console.log(formatTweetUrlLine(result.tweetId, output));
    } else {
      console.error(`${p('err')}Failed to post reply: ${result.error}`);
      process.exit(1);
    }
  });

// Read command - fetch tweet content
program
  .command('read')
  .description('Read/fetch a tweet by ID or URL')
  .argument('<tweet-id-or-url>', 'Tweet ID or URL to read')
  .option('--json', 'Output as JSON')
  .action(async (tweetIdOrUrl: string, cmdOpts: { json?: boolean }) => {
    const opts = program.opts();
    const timeoutMs = resolveTimeoutFromOptions(opts);
    const quoteDepth = resolveQuoteDepthFromOptions(opts);

    const tweetId = extractTweetId(tweetIdOrUrl);

    const { cookies, warnings } = await resolveCredentialsFromOptions(opts);

    for (const warning of warnings) {
      console.error(`${p('warn')}${warning}`);
    }

    if (!cookies.authToken || !cookies.ct0) {
      console.error(`${p('err')}Missing required credentials`);
      process.exit(1);
    }

    const client = new TwitterClient({ cookies, timeoutMs, quoteDepth });
    const result = await client.getTweet(tweetId);

    if (result.success && result.tweet) {
      if (cmdOpts.json) {
        console.log(JSON.stringify(result.tweet, null, 2));
      } else {
        console.log(`@${result.tweet.author.username} (${result.tweet.author.name}):`);
        console.log(result.tweet.text);
        if (result.tweet.createdAt) {
          console.log(`\n${l('date')}${result.tweet.createdAt}`);
        }
        console.log(formatStatsLine(result.tweet, output));
      }
    } else {
      console.error(`${p('err')}Failed to read tweet: ${result.error}`);
      process.exit(1);
    }
  });

// Replies command - list replies to a tweet
program
  .command('replies')
  .description('List replies to a tweet (by ID or URL)')
  .argument('<tweet-id-or-url>', 'Tweet ID or URL')
  .option('--json', 'Output as JSON')
  .action(async (tweetIdOrUrl: string, cmdOpts: { json?: boolean }) => {
    const opts = program.opts();
    const timeoutMs = resolveTimeoutFromOptions(opts);
    const quoteDepth = resolveQuoteDepthFromOptions(opts);
    const tweetId = extractTweetId(tweetIdOrUrl);

    const { cookies, warnings } = await resolveCredentialsFromOptions(opts);

    for (const warning of warnings) {
      console.error(`${p('warn')}${warning}`);
    }

    if (!cookies.authToken || !cookies.ct0) {
      console.error(`${p('err')}Missing required credentials`);
      process.exit(1);
    }

    const client = new TwitterClient({ cookies, timeoutMs, quoteDepth });
    const result = await client.getReplies(tweetId);

    if (result.success && result.tweets) {
      printTweets(result.tweets, { json: cmdOpts.json, emptyMessage: 'No replies found.' });
    } else {
      console.error(`${p('err')}Failed to fetch replies: ${result.error}`);
      process.exit(1);
    }
  });

// Thread command - show full conversation thread
program
  .command('thread')
  .description('Show the full conversation thread containing the tweet')
  .argument('<tweet-id-or-url>', 'Tweet ID or URL')
  .option('--json', 'Output as JSON')
  .action(async (tweetIdOrUrl: string, cmdOpts: { json?: boolean }) => {
    const opts = program.opts();
    const timeoutMs = resolveTimeoutFromOptions(opts);
    const quoteDepth = resolveQuoteDepthFromOptions(opts);
    const tweetId = extractTweetId(tweetIdOrUrl);

    const { cookies, warnings } = await resolveCredentialsFromOptions(opts);

    for (const warning of warnings) {
      console.error(`${p('warn')}${warning}`);
    }

    if (!cookies.authToken || !cookies.ct0) {
      console.error(`${p('err')}Missing required credentials`);
      process.exit(1);
    }

    const client = new TwitterClient({ cookies, timeoutMs, quoteDepth });
    const result = await client.getThread(tweetId);

    if (result.success && result.tweets) {
      printTweets(result.tweets, { json: cmdOpts.json, emptyMessage: 'No thread tweets found.' });
    } else {
      console.error(`${p('err')}Failed to fetch thread: ${result.error}`);
      process.exit(1);
    }
  });

// Search command - find tweets
program
  .command('search')
  .description('Search for tweets')
  .argument('<query>', 'Search query (e.g., "@clawdbot" or "from:clawdbot")')
  .option('-n, --count <number>', 'Number of tweets to fetch', '10')
  .option('--json', 'Output as JSON')
  .action(async (query: string, cmdOpts: { count?: string; json?: boolean }) => {
    const opts = program.opts();
    const timeoutMs = resolveTimeoutFromOptions(opts);
    const quoteDepth = resolveQuoteDepthFromOptions(opts);
    const count = Number.parseInt(cmdOpts.count || '10', 10);

    const { cookies, warnings } = await resolveCredentialsFromOptions(opts);

    for (const warning of warnings) {
      console.error(`${p('warn')}${warning}`);
    }

    if (!cookies.authToken || !cookies.ct0) {
      console.error(`${p('err')}Missing required credentials`);
      process.exit(1);
    }

    const client = new TwitterClient({ cookies, timeoutMs, quoteDepth });
    const result = await client.search(query, count);

    if (result.success && result.tweets) {
      printTweets(result.tweets, { json: cmdOpts.json, emptyMessage: 'No tweets found.' });
    } else {
      console.error(`${p('err')}Search failed: ${result.error}`);
      process.exit(1);
    }
  });

// Mentions command - shortcut to search for @username mentions
program
  .command('mentions')
  .description('Find tweets mentioning a user (defaults to current user)')
  .option('-u, --user <handle>', 'User handle (e.g. @steipete)')
  .option('-n, --count <number>', 'Number of tweets to fetch', '10')
  .option('--json', 'Output as JSON')
  .action(async (cmdOpts: { user?: string; count?: string; json?: boolean }) => {
    const opts = program.opts();
    const timeoutMs = resolveTimeoutFromOptions(opts);
    const quoteDepth = resolveQuoteDepthFromOptions(opts);
    const count = Number.parseInt(cmdOpts.count || '10', 10);

    const fromUserOpt = mentionsQueryFromUserOption(cmdOpts.user);
    if (fromUserOpt.error) {
      console.error(`${p('err')}${fromUserOpt.error}`);
      process.exit(2);
    }

    let query: string | null = fromUserOpt.query;

    const { cookies, warnings } = await resolveCredentialsFromOptions(opts);

    for (const warning of warnings) {
      console.error(`${p('warn')}${warning}`);
    }

    if (!cookies.authToken || !cookies.ct0) {
      console.error(`${p('err')}Missing required credentials`);
      process.exit(1);
    }

    const client = new TwitterClient({ cookies, timeoutMs, quoteDepth });

    if (!query) {
      const who = await client.getCurrentUser();
      const handle = normalizeHandle(who.user?.username);
      if (handle) {
        query = `@${handle}`;
      } else {
        console.error(
          `${p('err')}Could not determine current user (${who.error ?? 'Unknown error'}). Use --user <handle>.`,
        );
        process.exit(1);
      }
    }

    const result = await client.search(query, count);

    if (result.success && result.tweets) {
      printTweets(result.tweets, { json: cmdOpts.json, emptyMessage: 'No mentions found.' });
    } else {
      console.error(`${p('err')}Failed to fetch mentions: ${result.error}`);
      process.exit(1);
    }
  });

// Bookmarks command - get user's bookmarks
program
  .command('bookmarks')
  .description('Get your bookmarked tweets')
  .option('-n, --count <number>', 'Number of bookmarks to fetch', '20')
  .option('--folder-id <id>', 'Bookmark folder (collection) id')
  .option('--json', 'Output as JSON')
  .action(async (cmdOpts: { count?: string; json?: boolean; folderId?: string }) => {
    const opts = program.opts();
    const timeoutMs = resolveTimeoutFromOptions(opts);
    const count = Number.parseInt(cmdOpts.count || '20', 10);

    const { cookies, warnings } = await resolveCredentialsFromOptions(opts);

    for (const warning of warnings) {
      console.error(`${p('warn')}${warning}`);
    }

    if (!cookies.authToken || !cookies.ct0) {
      console.error(`${p('err')}Missing required credentials`);
      process.exit(1);
    }

    const client = new TwitterClient({ cookies, timeoutMs });
    const folderId = cmdOpts.folderId ? extractBookmarkFolderId(cmdOpts.folderId) : null;
    if (cmdOpts.folderId && !folderId) {
      console.error(`${p('err')}Invalid --folder-id. Expected numeric ID or https://x.com/i/bookmarks/<id>.`);
      process.exit(1);
    }
    const result = folderId
      ? await client.getBookmarkFolderTimeline(folderId, count)
      : await client.getBookmarks(count);

    if (result.success && result.tweets) {
      const emptyMessage = folderId ? 'No bookmarks found in folder.' : 'No bookmarks found.';
      printTweets(result.tweets, { json: cmdOpts.json, emptyMessage });
    } else {
      console.error(`${p('err')}Failed to fetch bookmarks: ${result.error}`);
      process.exit(1);
    }
  });

// Likes command - get user's liked tweets
program
  .command('likes')
  .description('Get your liked tweets')
  .option('-n, --count <number>', 'Number of likes to fetch', '20')
  .option('--json', 'Output as JSON')
  .action(async (cmdOpts: { count?: string; json?: boolean }) => {
    const opts = program.opts();
    const timeoutMs = resolveTimeoutFromOptions(opts);
    const quoteDepth = resolveQuoteDepthFromOptions(opts);
    const count = Number.parseInt(cmdOpts.count || '20', 10);

    const { cookies, warnings } = await resolveCredentialsFromOptions(opts);

    for (const warning of warnings) {
      console.error(`${p('warn')}${warning}`);
    }

    if (!cookies.authToken || !cookies.ct0) {
      console.error(`${p('err')}Missing required credentials`);
      process.exit(1);
    }

    const client = new TwitterClient({ cookies, timeoutMs, quoteDepth });
    const result = await client.getLikes(count);

    if (result.success && result.tweets) {
      printTweets(result.tweets, { json: cmdOpts.json, emptyMessage: 'No liked tweets found.' });
    } else {
      console.error(`${p('err')}Failed to fetch likes: ${result.error}`);
      process.exit(1);
    }
  });

// Whoami command - show the logged-in account
program
  .command('whoami')
  .description('Show which Twitter account the current credentials belong to')
  .action(async () => {
    const opts = program.opts();
    const timeoutMs = resolveTimeoutFromOptions(opts);
    const quoteDepth = resolveQuoteDepthFromOptions(opts);

    const { cookies, warnings } = await resolveCredentialsFromOptions(opts);

    for (const warning of warnings) {
      console.error(`${p('warn')}${warning}`);
    }

    if (!cookies.authToken || !cookies.ct0) {
      console.error(`${p('err')}Missing required credentials`);
      process.exit(1);
    }

    if (cookies.source) {
      console.error(`${l('source')}${cookies.source}`);
    }

    const client = new TwitterClient({ cookies, timeoutMs, quoteDepth });
    const result = await client.getCurrentUser();

    const credentialSource = cookies.source ?? 'env/auto-detected cookies';

    if (result.success && result.user) {
      console.log(`${l('user')}@${result.user.username} (${result.user.name})`);
      console.log(`${l('userId')}${result.user.id}`);
      console.log(`${l('engine')}graphql`);
      console.log(`${l('credentials')}${credentialSource}`);
    } else {
      console.error(`${p('err')}Failed to determine current user: ${result.error ?? 'Unknown error'}`);
      process.exit(1);
    }
  });

// Check command - verify credentials
program
  .command('check')
  .description('Check credential availability')
  .action(async () => {
    const opts = program.opts();
    const { cookies, warnings } = await resolveCredentialsFromOptions(opts);

    console.log(`${p('info')}Credential check`);
    console.log('─'.repeat(40));

    if (cookies.authToken) {
      console.log(`${p('ok')}auth_token: ${cookies.authToken.slice(0, 10)}...`);
    } else {
      console.log(`${p('err')}auth_token: not found`);
    }

    if (cookies.ct0) {
      console.log(`${p('ok')}ct0: ${cookies.ct0.slice(0, 10)}...`);
    } else {
      console.log(`${p('err')}ct0: not found`);
    }

    if (cookies.source) {
      console.log(`${l('source')}${cookies.source}`);
    }

    if (warnings.length > 0) {
      console.log(`\n${p('warn')}Warnings:`);
      for (const warning of warnings) {
        console.log(`   - ${warning}`);
      }
    }

    if (cookies.authToken && cookies.ct0) {
      console.log(`\n${p('ok')}Ready to tweet!`);
    } else {
      console.log(`\n${p('err')}Missing credentials. Options:`);
      console.log('   1. Login to x.com in Safari/Chrome/Firefox');
      console.log('   2. Set AUTH_TOKEN and CT0 environment variables');
      console.log('   3. Use --auth-token and --ct0 flags');
      process.exit(1);
    }
  });

const { argv, showHelp } = resolveCliInvocation(normalizedArgs, KNOWN_COMMANDS);

if (showHelp) {
  program.outputHelp();
  process.exit(0);
}

if (argv) {
  program.parse(argv);
} else {
  program.parse(['node', 'bird', ...normalizedArgs]);
}
