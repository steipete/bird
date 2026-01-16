import type { Command } from 'commander';
import type { CliContext } from '../cli/shared.js';
import { normalizeHandle } from '../lib/normalize-handle.js';
import { TwitterClient } from '../lib/twitter-client.js';

async function resolveUserId(
  client: TwitterClient,
  usernameOrId: string,
  ctx: CliContext,
): Promise<{ userId: string; username?: string } | null> {
  // If it looks like a numeric ID, use it directly
  if (/^\d+$/.test(usernameOrId)) {
    return { userId: usernameOrId };
  }

  // Otherwise, treat as username and look up
  const handle = normalizeHandle(usernameOrId);
  if (!handle) {
    console.error(`${ctx.p('err')}Invalid username: ${usernameOrId}`);
    return null;
  }

  const lookup = await client.getUserIdByUsername(handle);
  if (!lookup.success || !lookup.userId) {
    console.error(`${ctx.p('err')}Failed to find user @${handle}: ${lookup.error ?? 'Unknown error'}`);
    return null;
  }

  return { userId: lookup.userId, username: lookup.username };
}

export function registerFollowCommands(program: Command, ctx: CliContext): void {
  program
    .command('follow')
    .description('Follow a user')
    .argument('<username-or-id>', 'Username (with or without @) or user ID to follow')
    .action(async (usernameOrId: string) => {
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

      const resolved = await resolveUserId(client, usernameOrId, ctx);
      if (!resolved) {
        process.exit(1);
      }

      const { userId, username } = resolved;
      const displayName = username ? `@${username}` : userId;

      const result = await client.follow(userId);
      if (result.success) {
        const finalName = result.username ? `@${result.username}` : displayName;
        console.log(`${ctx.p('ok')}Now following ${finalName}`);
      } else {
        console.error(`${ctx.p('err')}Failed to follow ${displayName}: ${result.error}`);
        process.exit(1);
      }
    });

  program
    .command('unfollow')
    .description('Unfollow a user')
    .argument('<username-or-id>', 'Username (with or without @) or user ID to unfollow')
    .action(async (usernameOrId: string) => {
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

      const resolved = await resolveUserId(client, usernameOrId, ctx);
      if (!resolved) {
        process.exit(1);
      }

      const { userId, username } = resolved;
      const displayName = username ? `@${username}` : userId;

      const result = await client.unfollow(userId);
      if (result.success) {
        const finalName = result.username ? `@${result.username}` : displayName;
        console.log(`${ctx.p('ok')}Unfollowed ${finalName}`);
      } else {
        console.error(`${ctx.p('err')}Failed to unfollow ${displayName}: ${result.error}`);
        process.exit(1);
      }
    });
}
