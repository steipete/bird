import type { Command } from 'commander';
import type { CliContext } from '../cli/shared.js';
import { TwitterClient } from '../lib/twitter-client.js';

export function registerBookmarkToFolderCommand(program: Command, ctx: CliContext): void {
  program
    .command('bookmark-to-folder')
    .description('Bookmark a tweet to a specific folder')
    .argument('<tweet-id-or-url>', 'Tweet ID or URL to bookmark')
    .requiredOption('--folder-id <id>', 'Bookmark folder ID')
    .action(async (tweetIdOrUrl: string, options: { folderId: string }) => {
      const opts = program.opts();
      const timeoutMs = ctx.resolveTimeoutFromOptions(opts);

      const { cookies, warnings } = await ctx.resolveCredentialsFromOptions(opts);

      for (const warning of warnings) {
        console.error(`${ctx.p('warn')}${warning}`);
      }

      if (!cookies.authToken || !cookies.ct0) {
        console.error(`${ctx.p('err')}Missing required credentials`);
        process.exit(1);
      }

      const client = new TwitterClient({ cookies, timeoutMs });
      const tweetId = ctx.extractTweetId(tweetIdOrUrl);
      const result = await client.bookmarkToFolder(tweetId, options.folderId);

      if (result.success) {
        console.log(`${ctx.p('ok')}Bookmarked ${tweetId} to folder ${options.folderId}`);
      } else {
        console.error(`${ctx.p('err')}Failed to bookmark ${tweetId} to folder: ${result.error}`);
        process.exit(1);
      }
    });
}
