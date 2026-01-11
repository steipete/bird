import type { Command } from 'commander';
import type { CliContext } from '../cli/shared.js';
import { formatStatsLine } from '../lib/output.js';
import { TwitterClient } from '../lib/twitter-client.js';

export function registerReadCommands(program: Command, ctx: CliContext): void {
  program
    .command('read')
    .description('Read/fetch a tweet by ID or URL')
    .argument('<tweet-id-or-url>', 'Tweet ID or URL to read')
    .option('--json', 'Output as JSON')
    .option('--json-full', 'Output as JSON with full raw API response in _raw field')
    .action(async (tweetIdOrUrl: string, cmdOpts: { json?: boolean; jsonFull?: boolean }) => {
      const opts = program.opts();
      const timeoutMs = ctx.resolveTimeoutFromOptions(opts);
      const quoteDepth = ctx.resolveQuoteDepthFromOptions(opts);

      const tweetId = ctx.extractTweetId(tweetIdOrUrl);

      const { cookies, warnings } = await ctx.resolveCredentialsFromOptions(opts);

      for (const warning of warnings) {
        console.error(`${ctx.p('warn')}${warning}`);
      }

      if (!cookies.authToken || !cookies.ct0) {
        console.error(`${ctx.p('err')}Missing required credentials`);
        process.exit(1);
      }

      const client = new TwitterClient({ cookies, timeoutMs, quoteDepth });
      const includeRaw = cmdOpts.jsonFull ?? false;
      const result = await client.getTweet(tweetId, { includeRaw });

      if (result.success && result.tweet) {
        if (cmdOpts.json || cmdOpts.jsonFull) {
          console.log(JSON.stringify(result.tweet, null, 2));
        } else {
          console.log(`@${result.tweet.author.username} (${result.tweet.author.name}):`);
          console.log(result.tweet.text);
          if (result.tweet.createdAt) {
            console.log(`\n${ctx.l('date')}${result.tweet.createdAt}`);
          }
          console.log(formatStatsLine(result.tweet, ctx.getOutput()));
        }
      } else {
        console.error(`${ctx.p('err')}Failed to read tweet: ${result.error}`);
        process.exit(1);
      }
    });

  program
    .command('replies')
    .description('List replies to a tweet (by ID or URL)')
    .argument('<tweet-id-or-url>', 'Tweet ID or URL')
    .option('--all', 'Fetch all replies (paged)')
    .option('--max-pages <number>', 'Stop after N pages when using --all')
    .option('--delay <ms>', 'Delay in ms between page fetches (default: 1000)')
    .option('--cursor <string>', 'Resume pagination from a cursor')
    .option('--json', 'Output as JSON')
    .option('--json-full', 'Output as JSON with full raw API response in _raw field')
    .action(
      async (
        tweetIdOrUrl: string,
        cmdOpts: {
          all?: boolean;
          maxPages?: string;
          delay?: string;
          cursor?: string;
          json?: boolean;
          jsonFull?: boolean;
        },
      ) => {
        const opts = program.opts();
        const timeoutMs = ctx.resolveTimeoutFromOptions(opts);
        const quoteDepth = ctx.resolveQuoteDepthFromOptions(opts);
        const tweetId = ctx.extractTweetId(tweetIdOrUrl);
        const maxPages = cmdOpts.maxPages ? Number.parseInt(cmdOpts.maxPages, 10) : undefined;
        const pageDelayMs = cmdOpts.delay ? Number.parseInt(cmdOpts.delay, 10) : 1000;

        const usePagination = cmdOpts.all || cmdOpts.cursor;
        if (maxPages !== undefined && !usePagination) {
          console.error(`${ctx.p('err')}--max-pages requires --all or --cursor.`);
          process.exit(1);
        }
        if (maxPages !== undefined && (!Number.isFinite(maxPages) || maxPages <= 0)) {
          console.error(`${ctx.p('err')}Invalid --max-pages. Expected a positive integer.`);
          process.exit(1);
        }
        if (!Number.isFinite(pageDelayMs) || pageDelayMs < 0) {
          console.error(`${ctx.p('err')}Invalid --delay. Expected a non-negative integer.`);
          process.exit(1);
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
        const includeRaw = cmdOpts.jsonFull ?? false;

        const result = usePagination
          ? await client.getRepliesPaged(tweetId, {
              includeRaw,
              maxPages,
              cursor: cmdOpts.cursor,
              pageDelayMs,
            })
          : await client.getReplies(tweetId, { includeRaw });

        if (result.success && result.tweets) {
          const isJson = cmdOpts.json || cmdOpts.jsonFull;
          if (isJson && usePagination) {
            console.log(JSON.stringify({ tweets: result.tweets, nextCursor: result.nextCursor ?? null }, null, 2));
          } else {
            ctx.printTweets(result.tweets, { json: isJson, emptyMessage: 'No replies found.' });
          }

          // Show pagination hint if there's more
          if (result.nextCursor && !isJson) {
            console.error(`${ctx.p('info')}More replies available. Use --cursor "${result.nextCursor}" to continue.`);
          }
        } else {
          console.error(`${ctx.p('err')}Failed to fetch replies: ${result.error}`);
          process.exit(1);
        }
      },
    );

  program
    .command('thread')
    .description('Show the full conversation thread containing the tweet')
    .argument('<tweet-id-or-url>', 'Tweet ID or URL')
    .option('--all', 'Fetch all thread tweets (paged)')
    .option('--max-pages <number>', 'Stop after N pages when using --all')
    .option('--delay <ms>', 'Delay in ms between page fetches (default: 1000)')
    .option('--cursor <string>', 'Resume pagination from a cursor')
    .option('--json', 'Output as JSON')
    .option('--json-full', 'Output as JSON with full raw API response in _raw field')
    .action(
      async (
        tweetIdOrUrl: string,
        cmdOpts: {
          all?: boolean;
          maxPages?: string;
          delay?: string;
          cursor?: string;
          json?: boolean;
          jsonFull?: boolean;
        },
      ) => {
        const opts = program.opts();
        const timeoutMs = ctx.resolveTimeoutFromOptions(opts);
        const quoteDepth = ctx.resolveQuoteDepthFromOptions(opts);
        const tweetId = ctx.extractTweetId(tweetIdOrUrl);
        const maxPages = cmdOpts.maxPages ? Number.parseInt(cmdOpts.maxPages, 10) : undefined;
        const pageDelayMs = cmdOpts.delay ? Number.parseInt(cmdOpts.delay, 10) : 1000;

        const usePagination = cmdOpts.all || cmdOpts.cursor;
        if (maxPages !== undefined && !usePagination) {
          console.error(`${ctx.p('err')}--max-pages requires --all or --cursor.`);
          process.exit(1);
        }
        if (maxPages !== undefined && (!Number.isFinite(maxPages) || maxPages <= 0)) {
          console.error(`${ctx.p('err')}Invalid --max-pages. Expected a positive integer.`);
          process.exit(1);
        }
        if (!Number.isFinite(pageDelayMs) || pageDelayMs < 0) {
          console.error(`${ctx.p('err')}Invalid --delay. Expected a non-negative integer.`);
          process.exit(1);
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
        const includeRaw = cmdOpts.jsonFull ?? false;

        const result = usePagination
          ? await client.getThreadPaged(tweetId, {
              includeRaw,
              maxPages,
              cursor: cmdOpts.cursor,
              pageDelayMs,
            })
          : await client.getThread(tweetId, { includeRaw });

        if (result.success && result.tweets) {
          const isJson = cmdOpts.json || cmdOpts.jsonFull;
          if (isJson && usePagination) {
            console.log(JSON.stringify({ tweets: result.tweets, nextCursor: result.nextCursor ?? null }, null, 2));
          } else {
            ctx.printTweets(result.tweets, {
              json: isJson,
              emptyMessage: 'No thread tweets found.',
            });
          }

          // Show pagination hint if there's more
          if (result.nextCursor && !isJson) {
            console.error(
              `${ctx.p('info')}More thread tweets available. Use --cursor "${result.nextCursor}" to continue.`,
            );
          }
        } else {
          console.error(`${ctx.p('err')}Failed to fetch thread: ${result.error}`);
          process.exit(1);
        }
      },
    );
}
