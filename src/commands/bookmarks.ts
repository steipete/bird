import type { Command } from 'commander';
import { parsePaginationFlags } from '../cli/pagination.js';
import type { CliContext } from '../cli/shared.js';
import { extractBookmarkFolderId } from '../lib/extract-bookmark-folder-id.js';
import { addThreadMetadata, filterAuthorChain, filterAuthorOnly, filterFullChain } from '../lib/thread-filters.js';
import { TwitterClient } from '../lib/twitter-client.js';
import type { TweetData, TweetWithMeta } from '../lib/twitter-client-types.js';

export function registerBookmarksCommand(program: Command, ctx: CliContext): void {
  program
    .command('bookmarks')
    .description('Get your bookmarked tweets')
    .option('-n, --count <number>', 'Number of bookmarks to fetch', '20')
    .option('--folder-id <id>', 'Bookmark folder (collection) id')
    .option('--all', 'Fetch all bookmarks (paged)')
    .option('--max-pages <number>', 'Stop after N pages when using --all')
    .option('--cursor <string>', 'Resume pagination from a cursor')
    .option('--expand-root-only', 'Only expand threads when bookmarked tweet is root')
    .option('--author-chain', 'Only include author self-reply chains connected to the bookmark')
    .option('--author-only', 'Include all tweets from bookmarked tweet author in thread')
    .option('--full-chain-only', 'Save entire reply chain connected to the bookmarked tweet')
    .option('--include-ancestor-branches', 'Include sibling branches for ancestors when using --full-chain-only')
    .option('--include-parent', 'Include direct parent tweet for non-root bookmarks')
    .option('--thread-meta', 'Add metadata fields (isThread, threadPosition, etc.)')
    .option('--sort-chronological', 'Sort output globally oldest -> newest')
    .option('--json', 'Output as JSON')
    .option('--json-full', 'Output as JSON with full raw API response in _raw field')
    .action(
      async (cmdOpts: {
        count?: string;
        json?: boolean;
        jsonFull?: boolean;
        folderId?: string;
        all?: boolean;
        maxPages?: string;
        cursor?: string;
        expandRootOnly?: boolean;
        authorChain?: boolean;
        authorOnly?: boolean;
        fullChainOnly?: boolean;
        includeAncestorBranches?: boolean;
        includeParent?: boolean;
        threadMeta?: boolean;
        sortChronological?: boolean;
      }) => {
        const opts = program.opts();
        const timeoutMs = ctx.resolveTimeoutFromOptions(opts);
        const count = Number.parseInt(cmdOpts.count || '20', 10);

        const pagination = parsePaginationFlags(cmdOpts);
        if (!pagination.ok) {
          console.error(`${ctx.p('err')}${pagination.error}`);
          process.exit(1);
        }
        const maxPages = pagination.maxPages;

        const { cookies, warnings } = await ctx.resolveCredentialsFromOptions(opts);

        for (const warning of warnings) {
          console.error(`${ctx.p('warn')}${warning}`);
        }

        if (!cookies.authToken || !cookies.ct0) {
          console.error(`${ctx.p('err')}Missing required credentials`);
          process.exit(1);
        }

        const usePagination = pagination.usePagination;
        if (maxPages !== undefined && !usePagination) {
          console.error(`${ctx.p('err')}--max-pages requires --all or --cursor.`);
          process.exit(1);
        }
        if (!usePagination && (!Number.isFinite(count) || count <= 0)) {
          console.error(`${ctx.p('err')}Invalid --count. Expected a positive integer.`);
          process.exit(1);
        }

        const client = new TwitterClient({ cookies, timeoutMs });
        const folderId = cmdOpts.folderId ? extractBookmarkFolderId(cmdOpts.folderId) : null;
        if (cmdOpts.folderId && !folderId) {
          console.error(`${ctx.p('err')}Invalid --folder-id. Expected numeric ID or https://x.com/i/bookmarks/<id>.`);
          process.exit(1);
        }
        const includeRaw = cmdOpts.jsonFull ?? false;
        const timelineOptions = { includeRaw };
        const paginationOptions = { includeRaw, maxPages, cursor: pagination.cursor };
        const result = folderId
          ? usePagination
            ? await client.getAllBookmarkFolderTimeline(folderId, paginationOptions)
            : await client.getBookmarkFolderTimeline(folderId, count, timelineOptions)
          : usePagination
            ? await client.getAllBookmarks(paginationOptions)
            : await client.getBookmarks(count, timelineOptions);

        if (!result.success) {
          console.error(`${ctx.p('err')}Failed to fetch bookmarks: ${result.error}`);
          process.exit(1);
        }

        if (cmdOpts.authorChain && (cmdOpts.authorOnly || cmdOpts.fullChainOnly)) {
          console.error(
            `${ctx.p('warn')}--author-chain already limits to the connected self-reply chain; ` +
              'other chain filters are redundant.',
          );
        }
        if (cmdOpts.includeAncestorBranches && !cmdOpts.fullChainOnly) {
          console.error(`${ctx.p('warn')}--include-ancestor-branches only applies with --full-chain-only.`);
        }

        const bookmarks = result.tweets;
        if (!bookmarks || bookmarks.length === 0) {
          const emptyMessage = folderId ? 'No bookmarks found in folder.' : 'No bookmarks found.';
          const isJson = Boolean(cmdOpts.json || cmdOpts.jsonFull);
          ctx.printTweetsResult(result, { json: isJson, usePagination, emptyMessage });
          return;
        }

        const expandedResults: TweetData[] = [];
        const threadCache = new Map<string, TweetData[]>();
        const includeMeta = Boolean(cmdOpts.threadMeta);
        const includeParent = Boolean(cmdOpts.includeParent);
        const expandRootOnly = Boolean(cmdOpts.expandRootOnly);
        const filterAuthorChainFlag = Boolean(cmdOpts.authorChain);
        const filterAuthorOnlyFlag = Boolean(cmdOpts.authorOnly);
        const filterFullChainFlag = Boolean(cmdOpts.fullChainOnly);
        const includeAncestorBranches = Boolean(cmdOpts.includeAncestorBranches) && filterFullChainFlag;
        const useChronologicalSort = Boolean(cmdOpts.sortChronological);

        const shouldAttemptExpand =
          expandRootOnly || filterAuthorChainFlag || filterAuthorOnlyFlag || filterFullChainFlag;
        const shouldFetchThread = shouldAttemptExpand || includeMeta;

        const fetchThread = async (tweet: TweetData): Promise<TweetData[] | null> => {
          const cachedKey = tweet.conversationId ?? tweet.id;
          const cached = threadCache.get(cachedKey);
          if (cached) {
            return cached;
          }

          const threadResult = await client.getThread(tweet.id, { includeRaw });
          if (!threadResult.success) {
            console.error(
              `${ctx.p('warn')}Failed to expand thread for ${tweet.id}: ${threadResult.error ?? 'Unknown error'}`,
            );
            return null;
          }
          if (!threadResult.tweets) {
            console.error(`${ctx.p('warn')}No thread tweets returned for ${tweet.id}.`);
            return null;
          }

          const rootKey = threadResult.tweets[0]?.conversationId ?? cachedKey;
          threadCache.set(rootKey, threadResult.tweets);
          return threadResult.tweets;
        };

        const delayBetweenExpansionsMs = 1000;

        for (let index = 0; index < bookmarks.length; index += 1) {
          const bookmark = bookmarks[index];
          const isRoot = !bookmark.inReplyToStatusId;
          let threadTweets: TweetData[] | null = null;

          if (shouldFetchThread) {
            if (!expandRootOnly || isRoot || includeMeta) {
              if (index > 0) {
                await new Promise((resolve) => setTimeout(resolve, delayBetweenExpansionsMs));
              }
              threadTweets = await fetchThread(bookmark);
            }
          }

          let outputTweets: TweetData[] = [bookmark];

          if (shouldAttemptExpand) {
            if (expandRootOnly && !isRoot) {
              outputTweets = [bookmark];
            } else if (threadTweets) {
              if (filterAuthorChainFlag) {
                outputTweets = filterAuthorChain(threadTweets, bookmark);
              } else {
                outputTweets = filterFullChainFlag
                  ? filterFullChain(threadTweets, bookmark, { includeAncestorBranches })
                  : threadTweets;
                if (filterAuthorOnlyFlag) {
                  outputTweets = filterAuthorOnly(outputTweets, bookmark);
                }
              }
            }
          }

          if (includeParent && bookmark.inReplyToStatusId) {
            const alreadyIncluded = outputTweets.some((tweet) => tweet.id === bookmark.inReplyToStatusId);
            if (!alreadyIncluded) {
              const parentFromThread = threadTweets?.find((tweet) => tweet.id === bookmark.inReplyToStatusId);
              if (parentFromThread) {
                expandedResults.push(parentFromThread);
              } else {
                const parentResult = await client.getTweet(bookmark.inReplyToStatusId, { includeRaw });
                if (parentResult.success && parentResult.tweet) {
                  expandedResults.push(parentResult.tweet);
                }
              }
            }
          }

          expandedResults.push(...outputTweets);
        }

        let finalResults: Array<TweetData | TweetWithMeta> = expandedResults;
        if (includeMeta) {
          finalResults = expandedResults.map((tweet) => {
            const cacheKey = tweet.conversationId ?? tweet.id;
            let conversationTweets = threadCache.get(cacheKey);
            if (!conversationTweets) {
              conversationTweets = [tweet];
            }
            return addThreadMetadata(tweet, conversationTweets);
          });
        }

        const uniqueTweets = Array.from(new Map(finalResults.map((tweet) => [tweet.id, tweet])).values());
        if (useChronologicalSort) {
          uniqueTweets.sort((a, b) => {
            const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
            const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
            return aTime - bTime;
          });
        }

        const emptyMessage = folderId ? 'No bookmarks found in folder.' : 'No bookmarks found.';
        const isJson = Boolean(cmdOpts.json || cmdOpts.jsonFull);
        ctx.printTweetsResult(
          { tweets: uniqueTweets, nextCursor: result.nextCursor },
          { json: isJson, usePagination, emptyMessage },
        );
      },
    );
}
