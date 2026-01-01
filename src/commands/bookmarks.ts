import type { Command } from 'commander';
import type { CliContext } from '../cli/shared.js';
import { extractBookmarkFolderId } from '../lib/extract-bookmark-folder-id.js';
import { TwitterClient } from '../lib/twitter-client.js';

export function registerBookmarksCommand(program: Command, ctx: CliContext): void {
  program
    .command('bookmarks')
    .description('Get your bookmarked tweets')
    .option('-n, --count <number>', 'Number of bookmarks to fetch', '20')
    .option('--folder-id <id>', 'Bookmark folder (collection) id')
    .option('--json', 'Output as JSON')
    .option('--cursor <value>', 'Bookmark pagination cursor')
    .option('--json-with-cursor', 'Output JSON with tweets + nextCursor')
    .action(
      async (cmdOpts: {
        count?: string;
        json?: boolean;
        jsonWithCursor?: boolean;
        folderId?: string;
        cursor?: string;
      }) => {
        const opts = program.opts();
        const timeoutMs = ctx.resolveTimeoutFromOptions(opts);
        const count = Number.parseInt(cmdOpts.count || '20', 10);
        const jsonWithCursor = Boolean(cmdOpts.jsonWithCursor);

        const { cookies, warnings } = await ctx.resolveCredentialsFromOptions(opts);

        for (const warning of warnings) {
          console.error(`${ctx.p('warn')}${warning}`);
        }

        if (!cookies.authToken || !cookies.ct0) {
          console.error(`${ctx.p('err')}Missing required credentials`);
          process.exit(1);
        }

        const client = new TwitterClient({ cookies, timeoutMs });
        const folderId = cmdOpts.folderId ? extractBookmarkFolderId(cmdOpts.folderId) : null;
        if (cmdOpts.folderId && !folderId) {
          console.error(`${ctx.p('err')}Invalid --folder-id. Expected numeric ID or https://x.com/i/bookmarks/<id>.`);
          process.exit(1);
        }
        const result = folderId
          ? await client.getBookmarkFolderTimeline(folderId, count)
          : await client.getBookmarks(count, cmdOpts.cursor);

        if (result.success && result.tweets) {
          const emptyMessage = folderId ? 'No bookmarks found in folder.' : 'No bookmarks found.';
          if (jsonWithCursor) {
            const payload = {
              tweets: result.tweets,
              nextCursor: 'nextCursor' in result ? (result.nextCursor ?? null) : null,
              errors: 'errors' in result ? (result.errors ?? []) : [],
            };
            console.log(JSON.stringify(payload, null, 2));
          } else {
            ctx.printTweets(result.tweets, { json: cmdOpts.json, emptyMessage });
          }
        } else {
          console.error(`${ctx.p('err')}Failed to fetch bookmarks: ${result.error}`);
          process.exit(1);
        }
      },
    );
}
