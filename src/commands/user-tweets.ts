import type { Command } from 'commander';
import type { CliContext } from '../cli/shared.js';
import { normalizeHandle } from '../lib/normalize-handle.js';
import { TwitterClient } from '../lib/twitter-client.js';

export function registerUserTweetsCommand(program: Command, ctx: CliContext): void {
  const formatExample = (cmd: string, desc: string): string =>
    `  ${ctx.colors.command(cmd)}\n    ${ctx.colors.muted(desc)}`;

  program
    .command('user-tweets')
    .description("Get tweets from a user's profile timeline")
    .argument('<handle>', 'Username to fetch tweets from (e.g., @steipete or steipete)')
    .option('-n, --count <number>', 'Number of tweets to fetch', '20')
    .option('--pages <number>', 'Number of pages to fetch (max: 10)', '1')
    .option('--delay <ms>', 'Delay in ms between page fetches', '1000')
    .option('--cursor <string>', 'Resume pagination from a cursor')
    .option('--json', 'Output as JSON')
    .option('--json-full', 'Output as JSON with full raw API response in _raw field')
    .addHelpText(
      'after',
      () =>
        `\n${ctx.colors.section('Command Examples')}\n${[
          formatExample('bird user-tweets @steipete', 'Get recent tweets from a user'),
          formatExample('bird user-tweets steipete -n 10', 'Get 10 tweets (@ is optional)'),
          formatExample('bird user-tweets @steipete --pages 3', 'Fetch 3 pages of tweets'),
          formatExample('bird user-tweets @steipete --json', 'Output as JSON'),
          formatExample('bird user-tweets @steipete --cursor "DAABCg..."', 'Resume from cursor'),
        ].join('\n')}`,
    )
    .action(
      async (
        handle: string,
        cmdOpts: {
          count?: string;
          pages?: string;
          delay?: string;
          cursor?: string;
          json?: boolean;
          jsonFull?: boolean;
        },
      ) => {
        const opts = program.opts();
        const timeoutMs = ctx.resolveTimeoutFromOptions(opts);
        const quoteDepth = ctx.resolveQuoteDepthFromOptions(opts);
        const count = Number.parseInt(cmdOpts.count || '20', 10);
        const maxPages = Math.min(Number.parseInt(cmdOpts.pages || '1', 10), 10); // Hard cap at 10 pages
        const pageDelayMs = Number.parseInt(cmdOpts.delay || '1000', 10);

        // Validate inputs
        if (!Number.isFinite(count) || count <= 0) {
          console.error(`${ctx.p('err')}Invalid --count. Expected a positive integer.`);
          process.exit(2);
        }
        if (!Number.isFinite(maxPages) || maxPages <= 0) {
          console.error(`${ctx.p('err')}Invalid --pages. Expected a positive integer (max: 10).`);
          process.exit(2);
        }
        if (!Number.isFinite(pageDelayMs) || pageDelayMs < 0) {
          console.error(`${ctx.p('err')}Invalid --delay. Expected a non-negative integer.`);
          process.exit(2);
        }

        // Normalize handle (strip @ if present)
        const username = normalizeHandle(handle);
        if (!username) {
          console.error(`${ctx.p('err')}Invalid handle: ${handle}`);
          process.exit(2);
        }

        const { cookies, warnings } = await ctx.resolveCredentialsFromOptions(opts);

        for (const warning of warnings) {
          console.error(`${ctx.p('warn')}${warning}`);
        }

        if (!cookies.authToken || !cookies.ct0) {
          console.error(`${ctx.p('err')}Missing required credentials`);
          process.exit(1);
        }

        const client = new TwitterClient({ cookies, timeoutMs, quoteDepth });

        // Look up user ID from username
        console.error(`${ctx.p('info')}Looking up @${username}...`);
        const userLookup = await client.getUserIdByUsername(username);
        if (!userLookup.success || !userLookup.userId) {
          console.error(`${ctx.p('err')}${userLookup.error || `Could not find user @${username}`}`);
          process.exit(1);
        }

        const displayName = userLookup.name
          ? `${userLookup.name} (@${userLookup.username})`
          : `@${userLookup.username}`;
        console.error(`${ctx.p('info')}Fetching tweets from ${displayName}...`);

        const includeRaw = cmdOpts.jsonFull ?? false;
        const usePagination = maxPages > 1 || cmdOpts.cursor;

        let result: Awaited<ReturnType<typeof client.getUserTweetsPaged>>;
        if (usePagination) {
          result = await client.getUserTweetsPaged(userLookup.userId, {
            includeRaw,
            maxPages,
            cursor: cmdOpts.cursor,
            pageDelayMs,
          });
        } else {
          result = await client.getUserTweets(userLookup.userId, count, { includeRaw });
        }

        if (result.success && result.tweets) {
          // Trim to count if single page
          let tweets = result.tweets;
          if (!usePagination && tweets.length > count) {
            tweets = tweets.slice(0, count);
          }

          const isJson = cmdOpts.json || cmdOpts.jsonFull;
          if (isJson && usePagination) {
            // Include nextCursor for pagination consumers
            console.log(JSON.stringify({ tweets, nextCursor: result.nextCursor ?? null }, null, 2));
          } else {
            ctx.printTweets(tweets, {
              json: isJson,
              emptyMessage: `No tweets found for @${username}.`,
            });
          }

          // Show pagination hint if there's more
          if (result.nextCursor && !cmdOpts.json && !cmdOpts.jsonFull) {
            console.error(`${ctx.p('info')}More tweets available. Use --cursor "${result.nextCursor}" to continue.`);
          }
        } else {
          console.error(`${ctx.p('err')}Failed to fetch tweets: ${result.error}`);
          process.exit(1);
        }
      },
    );
}
