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
          ctx.printTweets([result.tweet], { showSeparator: false });
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
      const result = await client.getReplies(tweetId, { includeRaw });

      if (result.success && result.tweets) {
        ctx.printTweets(result.tweets, { json: cmdOpts.json || cmdOpts.jsonFull, emptyMessage: 'No replies found.' });
      } else {
        console.error(`${ctx.p('err')}Failed to fetch replies: ${result.error}`);
        process.exit(1);
      }
    });

  program
    .command('thread')
    .description('Show the full conversation thread containing the tweet')
    .argument('<tweet-id-or-url>', 'Tweet ID or URL')
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
      const result = await client.getThread(tweetId, { includeRaw });

      if (result.success && result.tweets) {
        ctx.printTweets(result.tweets, {
          json: cmdOpts.json || cmdOpts.jsonFull,
          emptyMessage: 'No thread tweets found.',
        });
      } else {
        console.error(`${ctx.p('err')}Failed to fetch thread: ${result.error}`);
        process.exit(1);
      }
    });
}
