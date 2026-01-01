import type { Command } from 'commander';
import type { CliContext } from '../cli/shared.js';
import { TwitterClient } from '../lib/twitter-client.js';

export function registerUserCommands(program: Command, ctx: CliContext): void {
  program
    .command('following')
    .description('Get users that you (or another user) follow')
    .option('--user <userId>', 'User ID to get following for (defaults to current user)')
    .option('-n, --count <number>', 'Number of users to fetch', '20')
    .option('--json', 'Output as JSON')
    .action(async (cmdOpts: { user?: string; count?: string; json?: boolean }) => {
      const opts = program.opts();
      const timeoutMs = ctx.resolveTimeoutFromOptions(opts);
      const count = Number.parseInt(cmdOpts.count || '20', 10);

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

      const result = await client.getFollowing(userId, count);

      if (result.success && result.users) {
        if (cmdOpts.json) {
          console.log(JSON.stringify(result.users, null, 2));
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
          }
        }
      } else {
        console.error(`${ctx.p('err')}Failed to fetch following: ${result.error}`);
        process.exit(1);
      }
    });

  program
    .command('followers')
    .description('Get users that follow you (or another user)')
    .option('--user <userId>', 'User ID to get followers for (defaults to current user)')
    .option('-n, --count <number>', 'Number of users to fetch', '20')
    .option('--json', 'Output as JSON')
    .action(async (cmdOpts: { user?: string; count?: string; json?: boolean }) => {
      const opts = program.opts();
      const timeoutMs = ctx.resolveTimeoutFromOptions(opts);
      const count = Number.parseInt(cmdOpts.count || '20', 10);

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

      const result = await client.getFollowers(userId, count);

      if (result.success && result.users) {
        if (cmdOpts.json) {
          console.log(JSON.stringify(result.users, null, 2));
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
          }
        }
      } else {
        console.error(`${ctx.p('err')}Failed to fetch followers: ${result.error}`);
        process.exit(1);
      }
    });

  program
    .command('likes')
    .description('Get your liked tweets')
    .option('-n, --count <number>', 'Number of likes to fetch', '20')
    .option('--json', 'Output as JSON')
    .option('--cursor <value>', 'Likes pagination cursor')
    .option('--json-with-cursor', 'Output JSON with tweets + nextCursor')
    .action(async (cmdOpts: { count?: string; json?: boolean; jsonWithCursor?: boolean; cursor?: string }) => {
      const opts = program.opts();
      const timeoutMs = ctx.resolveTimeoutFromOptions(opts);
      const quoteDepth = ctx.resolveQuoteDepthFromOptions(opts);
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

      const client = new TwitterClient({ cookies, timeoutMs, quoteDepth });
      const result = await client.getLikes(count, cmdOpts.cursor);

      if (result.success && result.tweets) {
        if (jsonWithCursor) {
          const payload = {
            tweets: result.tweets,
            nextCursor: result.nextCursor ?? null,
            errors: result.errors ?? [],
          };
          console.log(JSON.stringify(payload, null, 2));
        } else {
          ctx.printTweets(result.tweets, { json: cmdOpts.json, emptyMessage: 'No liked tweets found.' });
        }
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
