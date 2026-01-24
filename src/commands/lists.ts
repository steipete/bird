// ABOUTME: CLI command for fetching Twitter Lists.
// ABOUTME: Supports listing owned lists, memberships, and list timelines.

import type { Command } from 'commander';
import { parsePaginationFlags } from '../cli/pagination.js';
import type { CliContext } from '../cli/shared.js';
import { extractListId } from '../lib/extract-list-id.js';
import { normalizeHandle } from '../lib/normalize-handle.js';
import { hyperlink } from '../lib/output.js';
import type { TwitterList, TwitterUser } from '../lib/twitter-client.js';
import { TwitterClient } from '../lib/twitter-client.js';

const ONLY_DIGITS_REGEX = /^\d+$/;

async function resolveUserId(
  client: TwitterClient,
  usernameOrUrl: string,
  ctx: CliContext,
): Promise<{ userId: string; username?: string } | null> {
  const raw = usernameOrUrl.trim();
  const isNumeric = ONLY_DIGITS_REGEX.test(raw);

  const handle = normalizeHandle(raw);
  if (handle) {
    const lookup = await client.getUserIdByUsername(handle);
    if (lookup.success && lookup.userId) {
      return { userId: lookup.userId, username: lookup.username };
    }
    if (!isNumeric) {
      console.error(`${ctx.p('err')}Failed to find user @${handle}: ${lookup.error ?? 'Unknown error'}`);
      return null;
    }
  }

  if (isNumeric) {
    return { userId: raw };
  }

  console.error(`${ctx.p('err')}Invalid username: ${usernameOrUrl}`);
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
    const listUrl = `https://x.com/i/lists/${list.id}`;
    console.log(`  ${ctx.colors.accent(hyperlink(listUrl, listUrl, ctx.getOutput()))}`);
    console.log('──────────────────────────────────────────────────');
  }
}

function printMembers(members: TwitterUser[], ctx: CliContext): void {
  for (const member of members) {
    const verified = member.isBlueVerified ? ' ✓' : '';
    console.log(`@${member.username}${verified} - ${member.name}`);
    if (member.description) {
      console.log(`  ${member.description.slice(0, 100)}${member.description.length > 100 ? '...' : ''}`);
    }
    console.log(`  ${ctx.colors.muted(`${member.followersCount?.toLocaleString() ?? 0} followers`)}`);
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
    .action(
      async (
        listIdOrUrl: string,
        cmdOpts: {
          count?: string;
          json?: boolean;
          jsonFull?: boolean;
          all?: boolean;
          maxPages?: string;
          cursor?: string;
        },
      ) => {
        const opts = program.opts();
        const timeoutMs = ctx.resolveTimeoutFromOptions(opts);
        const quoteDepth = ctx.resolveQuoteDepthFromOptions(opts);
        const count = Number.parseInt(cmdOpts.count || '20', 10);

        const pagination = parsePaginationFlags(cmdOpts, { maxPagesImpliesPagination: true });
        if (!pagination.ok) {
          console.error(`${ctx.p('err')}${pagination.error}`);
          process.exit(1);
        }

        const listId = extractListId(listIdOrUrl);
        if (!listId) {
          console.error(`${ctx.p('err')}Invalid list ID or URL. Expected numeric ID or https://x.com/i/lists/<id>.`);
          process.exit(2);
        }

        const usePagination = pagination.usePagination;
        if (!usePagination && (!Number.isFinite(count) || count <= 0)) {
          console.error(`${ctx.p('err')}Invalid --count. Expected a positive integer.`);
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
        const paginationOptions = { includeRaw, maxPages: pagination.maxPages, cursor: pagination.cursor };

        const result = usePagination
          ? await client.getAllListTimeline(listId, paginationOptions)
          : await client.getListTimeline(listId, count, timelineOptions);

        if (result.success) {
          const isJson = Boolean(cmdOpts.json || cmdOpts.jsonFull);
          ctx.printTweetsResult(result, {
            json: isJson,
            usePagination,
            emptyMessage: 'No tweets found in this list.',
          });
        } else {
          console.error(`${ctx.p('err')}Failed to fetch list timeline: ${result.error}`);
          process.exit(1);
        }
      },
    );

  const listCmd = program.command('list').description('Manage Twitter lists');

  // bird list members <id>
  listCmd
    .command('members <list-id-or-url>')
    .description('Get members of a list')
    .option('-n, --count <number>', 'Number of members to fetch', '20')
    .option('--cursor <string>', 'Resume pagination from a cursor')
    .option('--all', 'Fetch all list members (paged)')
    .option('--max-pages <number>', 'Stop after N pages when using --all')
    .option('--json', 'Output as JSON')
    .action(
      async (
        listIdOrUrl: string,
        cmdOpts: { count?: string; json?: boolean; cursor?: string; all?: boolean; maxPages?: string },
      ) => {
        const opts = program.opts();
        const timeoutMs = ctx.resolveTimeoutFromOptions(opts);
        const count = Number.parseInt(cmdOpts.count || '20', 10);

        const pagination = parsePaginationFlags(cmdOpts);
        if (!pagination.ok) {
          console.error(`${ctx.p('err')}${pagination.error}`);
          process.exit(1);
        }
        const usePagination = pagination.usePagination;
        const maxPages = pagination.maxPages;

        const listId = extractListId(listIdOrUrl);
        if (!listId) {
          console.error(`${ctx.p('err')}Invalid list ID or URL. Expected numeric ID or https://x.com/i/lists/<id>.`);
          process.exit(2);
        }

        if (maxPages !== undefined && !usePagination) {
          console.error(`${ctx.p('err')}--max-pages requires --all or --cursor.`);
          process.exit(1);
        }
        if (!Number.isFinite(count) || count <= 0) {
          console.error(`${ctx.p('err')}Invalid --count. Expected a positive integer.`);
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

        const client = new TwitterClient({ cookies, timeoutMs });

        if (cmdOpts.all) {
          const allMembers: TwitterUser[] = [];
          const seen = new Set<string>();
          let cursor: string | undefined = pagination.cursor;
          let pageNum = 0;
          let nextCursor: string | undefined;

          while (true) {
            pageNum += 1;
            if (!cmdOpts.json) {
              console.error(`${ctx.p('info')}Fetching page ${pageNum}...`);
            }

            const result = await client.getListMembers(listId, count, cursor);
            if (!result.success || !result.members) {
              console.error(`${ctx.p('err')}Failed to fetch list members: ${result.error}`);
              process.exit(1);
            }

            let added = 0;
            for (const member of result.members) {
              if (!seen.has(member.id)) {
                seen.add(member.id);
                allMembers.push(member);
                added += 1;
              }
            }

            const pageCursor = result.nextCursor;
            if (!pageCursor || result.members.length === 0 || added === 0 || pageCursor === cursor) {
              nextCursor = undefined;
              break;
            }

            if (maxPages && pageNum >= maxPages) {
              nextCursor = pageCursor;
              break;
            }

            cursor = pageCursor;
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }

          if (cmdOpts.json) {
            console.log(JSON.stringify({ members: allMembers, nextCursor: nextCursor ?? null }, null, 2));
          } else {
            console.error(`${ctx.p('info')}Total: ${allMembers.length} members`);
            if (nextCursor) {
              console.error(`${ctx.p('info')}Stopped at --max-pages. Use --cursor to continue.`);
              console.error(`${ctx.p('info')}Next cursor: ${nextCursor}`);
            }
            if (allMembers.length === 0) {
              console.log('No members found in this list.');
            } else {
              printMembers(allMembers, ctx);
            }
          }
          return;
        }

        const result = await client.getListMembers(listId, count, pagination.cursor);

        if (result.success && result.members) {
          if (cmdOpts.json) {
            if (usePagination) {
              console.log(JSON.stringify({ members: result.members, nextCursor: result.nextCursor ?? null }, null, 2));
            } else {
              console.log(JSON.stringify(result.members, null, 2));
            }
          } else {
            if (result.members.length === 0) {
              console.log('No members found in this list.');
            } else {
              printMembers(result.members, ctx);
              if (result.nextCursor) {
                console.error(`${ctx.p('info')}Next cursor: ${result.nextCursor}`);
              }
            }
          }
        } else {
          console.error(`${ctx.p('err')}Failed to fetch list members: ${result.error}`);
          process.exit(1);
        }
      },
    );

  // bird list add <list> <user>
  listCmd
    .command('add <list-id-or-url> <username-or-url>')
    .description('Add a user to a list')
    .option('--json', 'Output as JSON')
    .action(async (listIdOrUrl: string, usernameOrUrl: string, cmdOpts: { json?: boolean }) => {
      const opts = program.opts();
      const timeoutMs = ctx.resolveTimeoutFromOptions(opts);

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

      const client = new TwitterClient({ cookies, timeoutMs });

      const resolved = await resolveUserId(client, usernameOrUrl, ctx);
      if (!resolved) {
        process.exit(1);
      }

      const { userId, username } = resolved;
      const displayName = username ? `@${username}` : userId;

      const result = await client.addListMember(listId, userId);
      if (result.success) {
        if (cmdOpts.json) {
          console.log(JSON.stringify({ success: true, listId, userId, username }, null, 2));
        } else {
          console.log(`${ctx.p('ok')}Added ${displayName} to list ${listId}`);
        }
      } else {
        if (cmdOpts.json) {
          console.log(JSON.stringify({ success: false, error: result.error }, null, 2));
        } else {
          console.error(`${ctx.p('err')}Failed to add ${displayName} to list: ${result.error}`);
        }
        process.exit(1);
      }
    });

  // bird list remove <list> <user>
  listCmd
    .command('remove <list-id-or-url> <username-or-url>')
    .description('Remove a user from a list')
    .option('--json', 'Output as JSON')
    .action(async (listIdOrUrl: string, usernameOrUrl: string, cmdOpts: { json?: boolean }) => {
      const opts = program.opts();
      const timeoutMs = ctx.resolveTimeoutFromOptions(opts);

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

      const client = new TwitterClient({ cookies, timeoutMs });

      const resolved = await resolveUserId(client, usernameOrUrl, ctx);
      if (!resolved) {
        process.exit(1);
      }

      const { userId, username } = resolved;
      const displayName = username ? `@${username}` : userId;

      const result = await client.removeListMember(listId, userId);
      if (result.success) {
        if (cmdOpts.json) {
          console.log(JSON.stringify({ success: true, listId, userId, username }, null, 2));
        } else {
          console.log(`${ctx.p('ok')}Removed ${displayName} from list ${listId}`);
        }
      } else {
        if (cmdOpts.json) {
          console.log(JSON.stringify({ success: false, error: result.error }, null, 2));
        } else {
          console.error(`${ctx.p('err')}Failed to remove ${displayName} from list: ${result.error}`);
        }
        process.exit(1);
      }
    });
}
