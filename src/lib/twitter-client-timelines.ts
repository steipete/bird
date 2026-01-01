import type { AbstractConstructor, Mixin, TwitterClientBase } from './twitter-client-base.js';
import { TWITTER_API_BASE } from './twitter-client-constants.js';
import { buildBookmarksFeatures, buildLikesFeatures } from './twitter-client-features.js';
import type {
  BookmarksResult,
  GraphqlTweetResult,
  LikesResult,
  SearchResult,
  TweetData,
} from './twitter-client-types.js';
import { parseTweetsFromInstructions } from './twitter-client-utils.js';

export interface TwitterClientTimelineMethods {
  getBookmarks(count?: number, cursor?: string): Promise<BookmarksResult>;
  getLikes(count?: number, cursor?: string): Promise<LikesResult>;
  getBookmarkFolderTimeline(folderId: string, count?: number): Promise<SearchResult>;
}

export function withTimelines<TBase extends AbstractConstructor<TwitterClientBase>>(
  Base: TBase,
): Mixin<TBase, TwitterClientTimelineMethods> {
  abstract class TwitterClientTimelines extends Base {
    // biome-ignore lint/complexity/noUselessConstructor lint/suspicious/noExplicitAny: TS mixin constructor requirement.
    constructor(...args: any[]) {
      super(...args);
    }

    private async getBookmarksQueryIds(): Promise<string[]> {
      const primary = await this.getQueryId('Bookmarks');
      return Array.from(new Set([primary, 'RV1g3b8n_SGOHwkqKYSCFw', 'tmd4ifV8RHltzn8ymGg1aw']));
    }

    private async getBookmarkFolderQueryIds(): Promise<string[]> {
      const primary = await this.getQueryId('BookmarkFolderTimeline');
      return Array.from(new Set([primary, 'KJIQpsvxrTfRIlbaRIySHQ']));
    }

    private extractBottomCursorFromInstructions(
      instructions:
        | Array<{
            entries?: Array<{
              content?: Record<string, unknown>;
            }>;
          }>
        | undefined,
    ): string | undefined {
      let cursor: string | undefined;
      for (const instruction of instructions ?? []) {
        for (const entry of instruction.entries ?? []) {
          const content = entry.content as { cursorType?: unknown; value?: unknown } | undefined;
          if (content?.cursorType === 'Bottom' && typeof content.value === 'string' && content.value.length > 0) {
            cursor = content.value;
          }
        }
      }
      return cursor;
    }

    private async getLikesQueryIds(): Promise<string[]> {
      const primary = await this.getQueryId('Likes');
      return Array.from(new Set([primary, 'JR2gceKucIKcVNB_9JkhsA']));
    }

    /**
     * Get the authenticated user's bookmarks.
     * Auto-paginates to reach requested count unless cursor is provided.
     */
    async getBookmarks(count = 20, cursor?: string): Promise<BookmarksResult> {
      const features = buildBookmarksFeatures();
      const seenIds = new Set<string>();
      const allTweets: TweetData[] = [];
      const allErrors: string[] = [];
      let pageCursor = cursor;
      let refreshed = false;

      const fetchPage = async (pageCount: number, cursorValue?: string) => {
        const variables = {
          count: pageCount,
          includePromotedContent: false,
          withDownvotePerspective: false,
          withReactionsMetadata: false,
          withReactionsPerspective: false,
          ...(cursorValue ? { cursor: cursorValue } : {}),
        };

        const params = new URLSearchParams({
          variables: JSON.stringify(variables),
          features: JSON.stringify(features),
        });

        let lastError: string | undefined;
        let had404 = false;
        const queryIds = await this.getBookmarksQueryIds();

        for (const queryId of queryIds) {
          const url = `${TWITTER_API_BASE}/${queryId}/Bookmarks?${params.toString()}`;

          try {
            const response = await this.fetchWithTimeout(url, {
              method: 'GET',
              headers: this.getHeaders(),
            });

            if (response.status === 404) {
              had404 = true;
              lastError = `HTTP ${response.status}`;
              continue;
            }

            if (!response.ok) {
              const text = await response.text();
              return { success: false as const, error: `HTTP ${response.status}: ${text.slice(0, 200)}`, had404 };
            }

            const data = (await response.json()) as {
              data?: {
                bookmark_timeline_v2?: {
                  timeline?: {
                    instructions?: Array<{
                      entries?: Array<{
                        content?: {
                          itemContent?: {
                            tweet_results?: {
                              result?: GraphqlTweetResult;
                            };
                          };
                        };
                      }>;
                    }>;
                  };
                };
              };
              errors?: Array<{ message: string }>;
            };

            const instructions = data.data?.bookmark_timeline_v2?.timeline?.instructions;
            const tweets = parseTweetsFromInstructions(instructions, this.quoteDepth);
            const nextCursor = this.extractBottomCursorFromInstructions(instructions);
            const errors = (data.errors ?? []).map((e) => e.message).filter(Boolean);
            const hasInstructions = Array.isArray(instructions);

            // Skip non-blocking errors like "Query: Unspecified"
            const blockingErrors = errors.filter((e) => !e.includes('Query: Unspecified'));

            if (blockingErrors.length > 0 && !hasInstructions) {
              return { success: false as const, error: blockingErrors.join(', '), had404 };
            }

            return {
              success: true as const,
              tweets,
              nextCursor,
              errors: errors.length > 0 ? errors : undefined,
              had404,
            };
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }
        }

        return { success: false as const, error: lastError ?? 'Unknown error fetching bookmarks', had404 };
      };

      // If cursor provided, do single-page fetch (manual pagination mode)
      if (cursor) {
        const result = await fetchPage(count, cursor);
        if (!result.success && result.had404 && !refreshed) {
          refreshed = true;
          await this.refreshQueryIds();
          const retry = await fetchPage(count, cursor);
          return retry.success
            ? { success: true, tweets: retry.tweets, nextCursor: retry.nextCursor, errors: retry.errors }
            : { success: false, error: retry.error };
        }
        return result.success
          ? { success: true, tweets: result.tweets, nextCursor: result.nextCursor, errors: result.errors }
          : { success: false, error: result.error };
      }

      // Auto-pagination mode: loop until we reach count
      while (allTweets.length < count) {
        const remaining = count - allTweets.length;
        const pageSize = Math.min(remaining, 100);

        const result = await fetchPage(pageSize, pageCursor);

        if (!result.success) {
          if (result.had404 && !refreshed) {
            refreshed = true;
            await this.refreshQueryIds();
            continue;
          }
          if (allTweets.length > 0) {
            // Return partial results
            break;
          }
          return { success: false, error: result.error };
        }

        if (result.errors) {
          allErrors.push(...result.errors);
        }

        // Deduplicate tweets
        for (const tweet of result.tweets ?? []) {
          if (!seenIds.has(tweet.id)) {
            seenIds.add(tweet.id);
            allTweets.push(tweet);
          }
        }

        pageCursor = result.nextCursor;

        // No more pages available
        if (!pageCursor || (result.tweets?.length ?? 0) === 0) {
          break;
        }
      }

      return {
        success: true,
        tweets: allTweets.slice(0, count),
        nextCursor: pageCursor,
        errors: allErrors.length > 0 ? allErrors : undefined,
      };
    }

    /**
     * Get the authenticated user's liked tweets.
     * Auto-paginates to reach requested count unless cursor is provided.
     */
    async getLikes(count = 20, cursor?: string): Promise<LikesResult> {
      const userResult = await this.getCurrentUser();
      if (!userResult.success || !userResult.user) {
        return { success: false, error: userResult.error ?? 'Could not determine current user' };
      }

      const userId = userResult.user.id;
      const features = buildLikesFeatures();
      const seenIds = new Set<string>();
      const allTweets: TweetData[] = [];
      const allErrors: string[] = [];
      let pageCursor = cursor;
      let refreshed = false;

      const fetchPage = async (pageCount: number, cursorValue?: string) => {
        const variables = {
          userId,
          count: pageCount,
          includePromotedContent: false,
          withClientEventToken: false,
          withBirdwatchNotes: false,
          withVoice: true,
          ...(cursorValue ? { cursor: cursorValue } : {}),
        };

        const params = new URLSearchParams({
          variables: JSON.stringify(variables),
          features: JSON.stringify(features),
        });

        let lastError: string | undefined;
        let had404 = false;
        const queryIds = await this.getLikesQueryIds();

        for (const queryId of queryIds) {
          const url = `${TWITTER_API_BASE}/${queryId}/Likes?${params.toString()}`;

          try {
            const response = await this.fetchWithTimeout(url, {
              method: 'GET',
              headers: this.getHeaders(),
            });

            if (response.status === 404) {
              had404 = true;
              lastError = `HTTP ${response.status}`;
              continue;
            }

            if (!response.ok) {
              const text = await response.text();
              return { success: false as const, error: `HTTP ${response.status}: ${text.slice(0, 200)}`, had404 };
            }

            const data = (await response.json()) as {
              data?: {
                user?: {
                  result?: {
                    timeline?: {
                      timeline?: {
                        instructions?: Array<{
                          entries?: Array<{
                            content?: {
                              itemContent?: {
                                tweet_results?: {
                                  result?: GraphqlTweetResult;
                                };
                              };
                            };
                          }>;
                        }>;
                      };
                    };
                  };
                };
              };
              errors?: Array<{ message: string }>;
            };

            const instructions = data.data?.user?.result?.timeline?.timeline?.instructions;
            const tweets = parseTweetsFromInstructions(instructions, this.quoteDepth);
            const nextCursor = this.extractBottomCursorFromInstructions(instructions);
            const errors = (data.errors ?? []).map((e) => e.message).filter(Boolean);
            const hasInstructions = Array.isArray(instructions);

            // Skip non-blocking errors like "Query: Unspecified"
            const blockingErrors = errors.filter((e) => !e.includes('Query: Unspecified'));

            if (blockingErrors.length > 0 && !hasInstructions) {
              return { success: false as const, error: blockingErrors.join(', '), had404 };
            }

            return {
              success: true as const,
              tweets,
              nextCursor,
              errors: errors.length > 0 ? errors : undefined,
              had404,
            };
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }
        }

        return { success: false as const, error: lastError ?? 'Unknown error fetching likes', had404 };
      };

      // If cursor provided, do single-page fetch (manual pagination mode)
      if (cursor) {
        const result = await fetchPage(count, cursor);
        if (!result.success && result.had404 && !refreshed) {
          refreshed = true;
          await this.refreshQueryIds();
          const retry = await fetchPage(count, cursor);
          return retry.success
            ? { success: true, tweets: retry.tweets, nextCursor: retry.nextCursor, errors: retry.errors }
            : { success: false, error: retry.error };
        }
        return result.success
          ? { success: true, tweets: result.tweets, nextCursor: result.nextCursor, errors: result.errors }
          : { success: false, error: result.error };
      }

      // Auto-pagination mode: loop until we reach count
      while (allTweets.length < count) {
        const remaining = count - allTweets.length;
        const pageSize = Math.min(remaining, 100);

        const result = await fetchPage(pageSize, pageCursor);

        if (!result.success) {
          if (result.had404 && !refreshed) {
            refreshed = true;
            await this.refreshQueryIds();
            continue;
          }
          if (allTweets.length > 0) {
            // Return partial results
            break;
          }
          return { success: false, error: result.error };
        }

        if (result.errors) {
          allErrors.push(...result.errors);
        }

        // Deduplicate tweets
        for (const tweet of result.tweets ?? []) {
          if (!seenIds.has(tweet.id)) {
            seenIds.add(tweet.id);
            allTweets.push(tweet);
          }
        }

        pageCursor = result.nextCursor;

        // No more pages available
        if (!pageCursor || (result.tweets?.length ?? 0) === 0) {
          break;
        }
      }

      return {
        success: true,
        tweets: allTweets.slice(0, count),
        nextCursor: pageCursor,
        errors: allErrors.length > 0 ? allErrors : undefined,
      };
    }

    /**
     * Get the authenticated user's bookmark folder timeline
     */
    async getBookmarkFolderTimeline(folderId: string, count = 20): Promise<SearchResult> {
      const variablesWithCount = {
        bookmark_collection_id: folderId,
        includePromotedContent: true,
        count,
      };

      const variablesWithoutCount = {
        bookmark_collection_id: folderId,
        includePromotedContent: true,
      };

      const features = buildBookmarksFeatures();

      const tryOnce = async (variables: Record<string, unknown>) => {
        let lastError: string | undefined;
        let had404 = false;
        const queryIds = await this.getBookmarkFolderQueryIds();

        const params = new URLSearchParams({
          variables: JSON.stringify(variables),
          features: JSON.stringify(features),
        });

        for (const queryId of queryIds) {
          const url = `${TWITTER_API_BASE}/${queryId}/BookmarkFolderTimeline?${params.toString()}`;

          try {
            const response = await this.fetchWithTimeout(url, {
              method: 'GET',
              headers: this.getHeaders(),
            });

            if (response.status === 404) {
              had404 = true;
              lastError = `HTTP ${response.status}`;
              continue;
            }

            if (!response.ok) {
              const text = await response.text();
              return { success: false as const, error: `HTTP ${response.status}: ${text.slice(0, 200)}`, had404 };
            }

            const data = (await response.json()) as {
              data?: {
                bookmark_collection_timeline?: {
                  timeline?: {
                    instructions?: Array<{
                      entries?: Array<{
                        content?: {
                          itemContent?: {
                            tweet_results?: {
                              result?: GraphqlTweetResult;
                            };
                          };
                        };
                      }>;
                    }>;
                  };
                };
              };
              errors?: Array<{ message: string }>;
            };

            if (data.errors && data.errors.length > 0) {
              return { success: false as const, error: data.errors.map((e) => e.message).join(', '), had404 };
            }

            const instructions = data.data?.bookmark_collection_timeline?.timeline?.instructions;
            const tweets = parseTweetsFromInstructions(instructions, this.quoteDepth);

            return { success: true as const, tweets, had404 };
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }
        }

        return { success: false as const, error: lastError ?? 'Unknown error fetching bookmark folder', had404 };
      };

      let firstAttempt = await tryOnce(variablesWithCount);
      if (!firstAttempt.success && firstAttempt.error?.includes('Variable "$count"')) {
        firstAttempt = await tryOnce(variablesWithoutCount);
      }
      if (firstAttempt.success) {
        return { success: true, tweets: firstAttempt.tweets };
      }

      if (firstAttempt.had404) {
        await this.refreshQueryIds();
        let secondAttempt = await tryOnce(variablesWithCount);
        if (!secondAttempt.success && secondAttempt.error?.includes('Variable "$count"')) {
          secondAttempt = await tryOnce(variablesWithoutCount);
        }
        if (secondAttempt.success) {
          return { success: true, tweets: secondAttempt.tweets };
        }
        return { success: false, error: secondAttempt.error };
      }

      return { success: false, error: firstAttempt.error };
    }
  }

  return TwitterClientTimelines;
}
