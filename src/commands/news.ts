import type { Command } from 'commander';
import type { CliContext } from '../cli/shared.js';
import { TwitterClient } from '../lib/twitter-client.js';
import type { ExploreTab, NewsItem } from '../lib/twitter-client-news.js';

function formatPostCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return String(count);
}

function printNewsItems(
  items: NewsItem[],
  ctx: CliContext,
  opts: { json?: boolean; emptyMessage?: string } = {},
): void {
  if (opts.json) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }

  if (items.length === 0) {
    console.log(opts.emptyMessage ?? 'No news items found.');
    return;
  }

  for (const item of items) {
    const categoryLabel = item.category ? `[${item.category}]` : '';
    console.log(`\n${ctx.colors.accent(categoryLabel)} ${ctx.colors.command(item.headline)}`);

    if (item.description) {
      console.log(`  ${ctx.colors.muted(item.description)}`);
    }

    const meta: string[] = [];
    if (item.timeAgo) {
      meta.push(item.timeAgo);
    }
    if (item.postCount) {
      meta.push(`${formatPostCount(item.postCount)} posts`);
    }
    if (meta.length > 0) {
      console.log(`  ${ctx.colors.muted(meta.join(' | '))}`);
    }

    if (item.url) {
      console.log(`  ${ctx.l('url')}${item.url}`);
    }

    // Print related tweets if available
    if (item.tweets && item.tweets.length > 0) {
      console.log(`  ${ctx.colors.section('Related tweets:')}`);
      for (const tweet of item.tweets.slice(0, 3)) {
        console.log(
          `    @${tweet.author.username}: ${tweet.text.slice(0, 100)}${tweet.text.length > 100 ? '...' : ''}`,
        );
      }
    }

    console.log(ctx.colors.muted('─'.repeat(50)));
  }
}

export function registerNewsCommand(program: Command, ctx: CliContext): void {
  program
    .command('news')
    .alias('trending')
    .description("Fetch AI-curated news and trending topics from Explore tabs")
    .option('-n, --count <number>', 'Number of items to fetch', '10')
    .option('--ai-only', 'Show only AI-curated news items')
    .option('--with-tweets', 'Also fetch related tweets for each news item')
    .option('--tweets-per-item <number>', 'Number of tweets to fetch per news item (default: 5)', '5')
    .option('--for-you', 'Fetch only from For You tab')
    .option('--news-only', 'Fetch only from News tab')
    .option('--sports', 'Fetch only from Sports tab')
    .option('--entertainment', 'Fetch only from Entertainment tab')
    .option('--trending-only', 'Fetch only from Trending tab')
    .option('--json', 'Output as JSON')
    .option('--json-full', 'Output as JSON with full raw API response in _raw field')
    .action(
      async (cmdOpts: {
        count?: string;
        aiOnly?: boolean;
        withTweets?: boolean;
        tweetsPerItem?: string;
        forYou?: boolean;
        newsOnly?: boolean;
        sports?: boolean;
        entertainment?: boolean;
        trendingOnly?: boolean;
        json?: boolean;
        jsonFull?: boolean;
      }) => {
        const opts = program.opts();
        const timeoutMs = ctx.resolveTimeoutFromOptions(opts);
        const quoteDepth = ctx.resolveQuoteDepthFromOptions(opts);
        const count = Number.parseInt(cmdOpts.count || '10', 10);
        const tweetsPerItem = Number.parseInt(cmdOpts.tweetsPerItem || '5', 10);

        const { cookies, warnings } = await ctx.resolveCredentialsFromOptions(opts);

        for (const warning of warnings) {
          console.error(`${ctx.p('warn')}${warning}`);
        }

        if (Number.isNaN(count) || count < 1) {
          console.error(`${ctx.p('err')}--count must be a positive number`);
          process.exit(1);
        }

        if (Number.isNaN(tweetsPerItem) || tweetsPerItem < 1) {
          console.error(`${ctx.p('err')}--tweets-per-item must be a positive number`);
          process.exit(1);
        }

        if (!cookies.authToken || !cookies.ct0) {
          console.error(`${ctx.p('err')}Missing required credentials`);
          process.exit(1);
        }

        // Determine which tabs to fetch from
        const tabs: ExploreTab[] = [];
        if (cmdOpts.forYou) tabs.push('forYou');
        if (cmdOpts.newsOnly) tabs.push('news');
        if (cmdOpts.sports) tabs.push('sports');
        if (cmdOpts.entertainment) tabs.push('entertainment');
        if (cmdOpts.trendingOnly) tabs.push('trending');

        // If no specific tabs selected, use defaults (all tabs except trending)
        const tabsToFetch = tabs.length > 0 ? tabs : undefined;

        const client = new TwitterClient({ cookies, timeoutMs, quoteDepth });
        const includeRaw = cmdOpts.jsonFull ?? false;
        const withTweets = cmdOpts.withTweets ?? false;
        const aiOnly = cmdOpts.aiOnly ?? false;

        const result = await client.getNews(count, {
          includeRaw,
          withTweets,
          tweetsPerItem,
          aiOnly,
          tabs: tabsToFetch,
        });

        if (result.success) {
          printNewsItems(result.items, ctx, {
            json: cmdOpts.json || cmdOpts.jsonFull,
            emptyMessage: 'No news items found.',
          });
        } else {
          console.error(`${ctx.p('err')}Failed to fetch news: ${result.error}`);
          process.exit(1);
        }
      },
    );
}
