// ABOUTME: CLI command for fetching Twitter Lists.
// ABOUTME: Supports listing owned lists, memberships, and list timelines.

import type { Command } from 'commander';
import type { CliContext } from '../cli/shared.js';
import { extractListId } from '../lib/extract-list-id.js';
import type { TwitterList } from '../lib/twitter-client.js';
import { TwitterClient } from '../lib/twitter-client.js';

function printLists(lists: TwitterList[], ctx: CliContext): void {
  if (lists.length === 0) {
    console.log('No lists found.');
    return;
  }

  for (const list of lists) {
    const visibility = list.isPrivate ? '[private]' : '[public]';
    console.log(`${list.name} ${ctx.colors.muted(visibility)}`);
    if (list.description) {
      console.log(`  ${list.description.slice(0, 100)}${list.description.length > 100 ? '...' : ''}`);
    }
    console.log(`  ${ctx.p('info')}${list.memberCount?.toLocaleString() ?? 0} members`);
    if (list.owner) {
      console.log(`  ${ctx.colors.muted(`Owner: @${list.owner.username}`)}`);
    }
    console.log(`  ${ctx.colors.accent(`https://x.com/i/lists/${list.id}`)}`);
    console.log('──────────────────────────────────────────────────');
  }
}

export function registerListsCommand(program: Command, ctx: CliContext): void {
  program
    .command('lists')
    .description('Get your Twitter lists')
    .option('--member-of', 'Show lists you are a member of (instead of owned lists)')
    .option('-n, --count <number>', 'Number of lists to fetch', '100')
    .option('--json', 'Output as JSON')
    .action(async (cmdOpts: { memberOf?: boolean; count?: string; json?: boolean }) => {
      const opts = program.opts();
      const timeoutMs = ctx.resolveTimeoutFromOptions(opts);
      const count = Number.parseInt(cmdOpts.count || '100', 10);

      const { cookies, warnings } = await ctx.resolveCredentialsFromOptions(opts);

      for (const warning of warnings) {
        console.error(`${ctx.p('warn')}${warning}`);
      }

      if (!cookies.authToken || !cookies.ct0) {
        console.error(`${ctx.p('err')}Missing required credentials`);
        process.exit(1);
      }

      const client = new TwitterClient({ cookies, timeoutMs });

      const result = cmdOpts.memberOf ? await client.getListMemberships(count) : await client.getOwnedLists(count);

      if (result.success && result.lists) {
        if (cmdOpts.json) {
          console.log(JSON.stringify(result.lists, null, 2));
        } else {
          const emptyMessage = cmdOpts.memberOf ? 'You are not a member of any lists.' : 'You do not own any lists.';
          if (result.lists.length === 0) {
            console.log(emptyMessage);
          } else {
            printLists(result.lists, ctx);
          }
        }
      } else {
        console.error(`${ctx.p('err')}Failed to fetch lists: ${result.error}`);
        process.exit(1);
      }
    });

  program
    .command('list-timeline <list-id-or-url>')
    .description('Get tweets from a list timeline')
    .option('-n, --count <number>', 'Number of tweets to fetch', '20')
    .option('--all', 'Fetch all tweets from list (paged). WARNING: your account might get banned using this flag')
    .option('--max-pages <number>', 'Fetch N pages (implies --all)')
    .option('--cursor <string>', 'Resume pagination from a cursor')
    .option('--json', 'Output as JSON')
    .option('--json-full', 'Output as JSON with full raw API response in _raw field')
    .action(async (listIdOrUrl: string, cmdOpts: { count?: string; json?: boolean; jsonFull?: boolean; all?: boolean; maxPages?: string; cursor?: string }) => {
      const opts = program.opts();
      const timeoutMs = ctx.resolveTimeoutFromOptions(opts);
      const quoteDepth = ctx.resolveQuoteDepthFromOptions(opts);
      const count = Number.parseInt(cmdOpts.count || '20', 10);
      const maxPages = cmdOpts.maxPages ? Number.parseInt(cmdOpts.maxPages, 10) : undefined;

      const listId = extractListId(listIdOrUrl);
      if (!listId) {
        console.error(`${ctx.p('err')}Invalid list ID or URL. Expected numeric ID or https://x.com/i/lists/<id>.`);
        process.exit(2);
      }

      const usePagination = cmdOpts.all || cmdOpts.cursor || maxPages !== undefined;
      if (!usePagination && (!Number.isFinite(count) || count <= 0)) {
        console.error(`${ctx.p('err')}Invalid --count. Expected a positive integer.`);
        process.exit(1);
      }
      if (maxPages !== undefined && (!Number.isFinite(maxPages) || maxPages <= 0)) {
        console.error(`${ctx.p('err')}Invalid --max-pages. Expected a positive integer.`);
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
      const timelineOptions = { includeRaw };
      const paginationOptions = { includeRaw, maxPages, cursor: cmdOpts.cursor };

      const result = usePagination
        ? await client.getAllListTimeline(listId, paginationOptions)
        : await client.getListTimeline(listId, count, timelineOptions);

      if (result.success && result.tweets) {
        const isJson = cmdOpts.json || cmdOpts.jsonFull;
        if (isJson && usePagination) {
          console.log(JSON.stringify({ tweets: result.tweets, nextCursor: result.nextCursor ?? null }, null, 2));
        } else {
          ctx.printTweets(result.tweets, { json: isJson, emptyMessage: 'No tweets found in this list.' });
        }
      } else {
        console.error(`${ctx.p('err')}Failed to fetch list timeline: ${result.error}`);
        process.exit(1);
      }
    });
}
