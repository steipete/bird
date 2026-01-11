import type { Command } from 'commander';
import type { CliContext } from '../cli/shared.js';
import { TwitterClient } from '../lib/twitter-client.js';
import type { TwitterUser } from '../lib/twitter-client-types.js';

export function registerUserCommands(program: Command, ctx: CliContext): void {
  program
    .command('following')
    .description('Get users that you (or another user) follow')
    .option('--user <userId>', 'User ID to get following for (defaults to current user)')
    .option('-n, --count <number>', 'Number of users to fetch per page', '20')
    .option('--cursor <cursor>', 'Cursor for pagination (from previous response)')
    .option('--all', 'Fetch all users (paginate automatically)')
    .option('--max-pages <number>', 'Stop after N pages when using --all')
    .option('--json', 'Output as JSON')
    .action(
      async (cmdOpts: {
        user?: string;
        count?: string;
        cursor?: string;
        all?: boolean;
        maxPages?: string;
        json?: boolean;
      }) => {
        const opts = program.opts();
        const timeoutMs = ctx.resolveTimeoutFromOptions(opts);
        const count = Number.parseInt(cmdOpts.count || '20', 10);
        const maxPages = cmdOpts.maxPages ? Number.parseInt(cmdOpts.maxPages, 10) : undefined;

        const usePagination = cmdOpts.all || cmdOpts.cursor;
        if (maxPages !== undefined && !usePagination) {
          console.error(`${ctx.p('err')}--max-pages requires --all or --cursor.`);
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

      const client = new TwitterClient({ cookies, timeoutMs });

      let userId = cmdOpts.user;
      if (!userId) {
        const currentUser = await client.getCurrentUser();
        if (!currentUser.success || !currentUser.user?.id) {
          console.error(`${ctx.p('err')}Failed to get current user: ${currentUser.error || 'Unknown error'}`);
          process.exit(1);
        }
        userId = currentUser.user.id;
      }

        if (cmdOpts.all) {
          // Fetch all pages
          const allUsers: TwitterUser[] = [];
          const seen = new Set<string>();
          let cursor: string | undefined = cmdOpts.cursor;
          let pageNum = 0;
          let nextCursor: string | undefined;

          while (true) {
            pageNum++;
            if (!cmdOpts.json) {
              console.error(`${ctx.p('info')}Fetching page ${pageNum}...`);
            }

            const result = await client.getFollowing(userId, count, cursor);

            if (!result.success || !result.users) {
              console.error(`${ctx.p('err')}Failed to fetch following: ${result.error}`);
              process.exit(1);
            }

            for (const user of result.users) {
              if (!seen.has(user.id)) {
                seen.add(user.id);
                allUsers.push(user);
              }
            }

            if (!result.nextCursor || result.users.length === 0) {
              nextCursor = undefined;
              break;
            }

            if (maxPages && pageNum >= maxPages) {
              nextCursor = result.nextCursor;
              break;
            }

            cursor = result.nextCursor;

            // Rate limit: wait between pages to avoid overwhelming the API
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }

          if (cmdOpts.json) {
            console.log(JSON.stringify(allUsers, null, 2));
          } else {
            console.error(`${ctx.p('info')}Total: ${allUsers.length} users`);
            if (nextCursor) {
              console.error(`${ctx.p('info')}Stopped at --max-pages. Use --cursor to continue.`);
            }
            for (const user of allUsers) {
              console.log(`@${user.username} (${user.name})`);
              if (user.description) {
                console.log(`  ${user.description.slice(0, 100)}${user.description.length > 100 ? '...' : ''}`);
              }
              if (user.followersCount !== undefined) {
                console.log(`  ${ctx.p('info')}${user.followersCount.toLocaleString()} followers`);
              }
              console.log('──────────────────────────────────────────────────');
            }
          }
        } else {
          // Single page fetch
          const result = await client.getFollowing(userId, count, cmdOpts.cursor);

          if (result.success && result.users) {
            if (cmdOpts.json) {
              console.log(JSON.stringify({ users: result.users, nextCursor: result.nextCursor }, null, 2));
            } else {
              if (result.users.length === 0) {
                console.log('No users found.');
              } else {
                for (const user of result.users) {
                  console.log(`@${user.username} (${user.name})`);
                  if (user.description) {
                    console.log(`  ${user.description.slice(0, 100)}${user.description.length > 100 ? '...' : ''}`);
                  }
                  if (user.followersCount !== undefined) {
                    console.log(`  ${ctx.p('info')}${user.followersCount.toLocaleString()} followers`);
                  }
                  console.log('──────────────────────────────────────────────────');
                }
                if (result.nextCursor) {
                  console.error(`${ctx.p('info')}Next cursor: ${result.nextCursor}`);
                }
              }
            }
          } else {
            console.error(`${ctx.p('err')}Failed to fetch following: ${result.error}`);
            process.exit(1);
          }
        }
      },
    );

  program
    .command('followers')
    .description('Get users that follow you (or another user)')
    .option('--user <userId>', 'User ID to get followers for (defaults to current user)')
    .option('-n, --count <number>', 'Number of users to fetch per page', '20')
    .option('--cursor <cursor>', 'Cursor for pagination (from previous response)')
    .option('--all', 'Fetch all users (paginate automatically)')
    .option('--max-pages <number>', 'Stop after N pages when using --all')
    .option('--json', 'Output as JSON')
    .action(
      async (cmdOpts: {
        user?: string;
        count?: string;
        cursor?: string;
        all?: boolean;
        maxPages?: string;
        json?: boolean;
      }) => {
        const opts = program.opts();
        const timeoutMs = ctx.resolveTimeoutFromOptions(opts);
        const count = Number.parseInt(cmdOpts.count || '20', 10);
        const maxPages = cmdOpts.maxPages ? Number.parseInt(cmdOpts.maxPages, 10) : undefined;

        const usePagination = cmdOpts.all || cmdOpts.cursor;
        if (maxPages !== undefined && !usePagination) {
          console.error(`${ctx.p('err')}--max-pages requires --all or --cursor.`);
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

        const client = new TwitterClient({ cookies, timeoutMs });

        let userId = cmdOpts.user;
        if (!userId) {
          const currentUser = await client.getCurrentUser();
          if (!currentUser.success || !currentUser.user?.id) {
            console.error(`${ctx.p('err')}Failed to get current user: ${currentUser.error || 'Unknown error'}`);
            process.exit(1);
          }
          userId = currentUser.user.id;
        }

        if (cmdOpts.all) {
          // Fetch all pages
          const allUsers: TwitterUser[] = [];
          const seen = new Set<string>();
          let cursor: string | undefined = cmdOpts.cursor;
          let pageNum = 0;
          let nextCursor: string | undefined;

          while (true) {
            pageNum++;
            if (!cmdOpts.json) {
              console.error(`${ctx.p('info')}Fetching page ${pageNum}...`);
            }

            const result = await client.getFollowers(userId, count, cursor);

            if (!result.success || !result.users) {
              console.error(`${ctx.p('err')}Failed to fetch followers: ${result.error}`);
              process.exit(1);
            }

            for (const user of result.users) {
              if (!seen.has(user.id)) {
                seen.add(user.id);
                allUsers.push(user);
              }
            }

            if (!result.nextCursor || result.users.length === 0) {
              nextCursor = undefined;
              break;
            }

            if (maxPages && pageNum >= maxPages) {
              nextCursor = result.nextCursor;
              break;
            }

            cursor = result.nextCursor;

            // Rate limit: wait between pages to avoid overwhelming the API
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }

          if (cmdOpts.json) {
            console.log(JSON.stringify(allUsers, null, 2));
          } else {
            console.error(`${ctx.p('info')}Total: ${allUsers.length} users`);
            if (nextCursor) {
              console.error(`${ctx.p('info')}Stopped at --max-pages. Use --cursor to continue.`);
            }
            for (const user of allUsers) {
              console.log(`@${user.username} (${user.name})`);
              if (user.description) {
                console.log(`  ${user.description.slice(0, 100)}${user.description.length > 100 ? '...' : ''}`);
              }
              if (user.followersCount !== undefined) {
                console.log(`  ${ctx.p('info')}${user.followersCount.toLocaleString()} followers`);
              }
              console.log('──────────────────────────────────────────────────');
            }
          }
        } else {
          // Single page fetch
          const result = await client.getFollowers(userId, count, cmdOpts.cursor);

          if (result.success && result.users) {
            if (cmdOpts.json) {
              console.log(JSON.stringify({ users: result.users, nextCursor: result.nextCursor }, null, 2));
            } else {
              if (result.users.length === 0) {
                console.log('No users found.');
              } else {
                for (const user of result.users) {
                  console.log(`@${user.username} (${user.name})`);
                  if (user.description) {
                    console.log(`  ${user.description.slice(0, 100)}${user.description.length > 100 ? '...' : ''}`);
                  }
                  if (user.followersCount !== undefined) {
                    console.log(`  ${ctx.p('info')}${user.followersCount.toLocaleString()} followers`);
                  }
                  console.log('──────────────────────────────────────────────────');
                }
                if (result.nextCursor) {
                  console.error(`${ctx.p('info')}Next cursor: ${result.nextCursor}`);
                }
              }
            }
          } else {
            console.error(`${ctx.p('err')}Failed to fetch followers: ${result.error}`);
            process.exit(1);
          }
        }
      },
    );

  program
    .command('likes')
    .description('Get your liked tweets')
    .option('-n, --count <number>', 'Number of likes to fetch', '20')
    .option('--json', 'Output as JSON')
    .option('--json-full', 'Output as JSON with full raw API response in _raw field')
    .action(async (cmdOpts: { count?: string; json?: boolean; jsonFull?: boolean }) => {
      const opts = program.opts();
      const timeoutMs = ctx.resolveTimeoutFromOptions(opts);
      const quoteDepth = ctx.resolveQuoteDepthFromOptions(opts);
      const count = Number.parseInt(cmdOpts.count || '20', 10);

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
      const result = await client.getLikes(count, { includeRaw });

      if (result.success && result.tweets) {
        ctx.printTweets(result.tweets, {
          json: cmdOpts.json || cmdOpts.jsonFull,
          emptyMessage: 'No liked tweets found.',
        });
      } else {
        console.error(`${ctx.p('err')}Failed to fetch likes: ${result.error}`);
        process.exit(1);
      }
    });

  program
    .command('whoami')
    .description('Show which Twitter account the current credentials belong to')
    .action(async () => {
      const opts = program.opts();
      const timeoutMs = ctx.resolveTimeoutFromOptions(opts);
      const quoteDepth = ctx.resolveQuoteDepthFromOptions(opts);

      const { cookies, warnings } = await ctx.resolveCredentialsFromOptions(opts);

      for (const warning of warnings) {
        console.error(`${ctx.p('warn')}${warning}`);
      }

      if (!cookies.authToken || !cookies.ct0) {
        console.error(`${ctx.p('err')}Missing required credentials`);
        process.exit(1);
      }

      if (cookies.source) {
        console.error(`${ctx.l('source')}${cookies.source}`);
      }

      const client = new TwitterClient({ cookies, timeoutMs, quoteDepth });
      const result = await client.getCurrentUser();

      const credentialSource = cookies.source ?? 'env/auto-detected cookies';

      if (result.success && result.user) {
        console.log(`${ctx.l('user')}@${result.user.username} (${result.user.name})`);
        console.log(`${ctx.l('userId')}${result.user.id}`);
        console.log(`${ctx.l('engine')}graphql`);
        console.log(`${ctx.l('credentials')}${credentialSource}`);
      } else {
        console.error(`${ctx.p('err')}Failed to determine current user: ${result.error ?? 'Unknown error'}`);
        process.exit(1);
      }
    });
}
