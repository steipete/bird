import type { Command } from 'commander';
import type { CliContext } from '../cli/shared.js';
import { TwitterClient } from '../lib/twitter-client.js';

export function registerDeleteCommand(program: Command, ctx: CliContext): void {
  program
    .command('delete')
    .description('Delete a tweet')
    .argument('<tweet-id-or-url...>', 'Tweet IDs or URLs to delete')
    .option('--json', 'Output results as JSON')
    .action(async (tweetIdOrUrls: string[], cmdOpts: { json?: boolean }) => {
      const opts = program.opts();
      const timeoutMs = ctx.resolveTimeoutFromOptions(opts);
      const jsonOutput = cmdOpts.json ?? opts.json;

      const { cookies, warnings } = await ctx.resolveCredentialsFromOptions(opts);

      for (const warning of warnings) {
        if (!jsonOutput) {
          console.error(`${ctx.p('warn')}${warning}`);
        }
      }

      if (!cookies.authToken || !cookies.ct0) {
        if (jsonOutput) {
          console.log(JSON.stringify({ success: false, error: 'Missing required credentials' }));
        } else {
          console.error(`${ctx.p('err')}Missing required credentials`);
        }
        process.exit(1);
      }

      const client = new TwitterClient({ cookies, timeoutMs });
      const results: Array<{ tweetId: string; success: boolean; error?: string }> = [];

      for (const input of tweetIdOrUrls) {
        const tweetId = ctx.extractTweetId(input);
        const result = await client.deleteTweet(tweetId);
        if (result.success) {
          results.push({ tweetId, success: true });
          if (!jsonOutput) {
            console.log(`${ctx.p('ok')}Deleted tweet ${tweetId}`);
          }
        } else {
          results.push({ tweetId, success: false, error: result.error });
          if (!jsonOutput) {
            console.error(`${ctx.p('err')}Failed to delete tweet ${tweetId}: ${result.error}`);
          }
        }
      }

      if (jsonOutput) {
        console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
      }

      const failures = results.filter((r) => !r.success).length;
      if (failures > 0) {
        process.exit(1);
      }
    });
}
