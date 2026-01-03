// ABOUTME: CLI command for fetching Twitter Lists.
// ABOUTME: Supports listing owned lists, memberships, and list timelines.

import type { Command } from 'commander';
import type { CliContext } from '../cli/shared.js';
import type { TwitterList } from '../lib/twitter-client.js';
import { TwitterClient } from '../lib/twitter-client.js';

const NUMERIC_ID_REGEX = /^\d+$/;
const LIST_URL_REGEX = /(?:x\.com|twitter\.com)\/i\/lists\/(\d+)/i;

function extractListId(listIdOrUrl: string): string | null {
  const trimmed = listIdOrUrl.trim();

  // Numeric ID
  if (NUMERIC_ID_REGEX.test(trimmed)) {
    return trimmed;
  }

  // URL formats:
  // https://x.com/i/lists/1234567890123456789
  // https://twitter.com/i/lists/1234567890123456789
  const urlMatch = trimmed.match(LIST_URL_REGEX);
  if (urlMatch) {
    return urlMatch[1];
  }

  return null;
}

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
    .option('--json', 'Output as JSON')
    .option('--json-full', 'Output as JSON with full raw API response in _raw field')
    .action(async (listIdOrUrl: string, cmdOpts: { count?: string; json?: boolean; jsonFull?: boolean }) => {
      const opts = program.opts();
      const timeoutMs = ctx.resolveTimeoutFromOptions(opts);
      const quoteDepth = ctx.resolveQuoteDepthFromOptions(opts);
      const count = Number.parseInt(cmdOpts.count || '20', 10);

      const listId = extractListId(listIdOrUrl);
      if (!listId) {
        console.error(`${ctx.p('err')}Invalid list ID or URL. Expected numeric ID or https://x.com/i/lists/<id>.`);
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
      const result = await client.getListTimeline(listId, count, { includeRaw: cmdOpts.jsonFull });

      if (result.success && result.tweets) {
        ctx.printTweets(result.tweets, {
          json: cmdOpts.json || cmdOpts.jsonFull,
          emptyMessage: 'No tweets found in this list.',
        });
      } else {
        console.error(`${ctx.p('err')}Failed to fetch list timeline: ${result.error}`);
        process.exit(1);
      }
    });
}
