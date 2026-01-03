import type { AbstractConstructor, Mixin, TwitterClientBase } from './twitter-client-base.js';
import { TWITTER_API_BASE } from './twitter-client-constants.js';
import { buildBookmarksFeatures, buildLikesFeatures } from './twitter-client-features.js';
import type { GraphqlTweetResult, SearchResult, TweetData } from './twitter-client-types.js';
import { extractCursorFromInstructions, parseTweetsFromInstructions } from './twitter-client-utils.js';

/** Options for timeline fetch methods */
export interface TimelineFetchOptions {
  /** Include raw GraphQL response in `_raw` field */
  includeRaw?: boolean;
}

/** Options for paged timeline fetch methods */
export interface TimelinePaginationOptions extends TimelineFetchOptions {
  maxPages?: number;
}

export interface TwitterClientTimelineMethods {
  getBookmarks(count?: number, options?: TimelineFetchOptions): Promise<SearchResult>;
  getAllBookmarks(options?: TimelinePaginationOptions): Promise<SearchResult>;
  getLikes(count?: number, options?: TimelineFetchOptions): Promise<SearchResult>;
  getBookmarkFolderTimeline(folderId: string, count?: number, options?: TimelineFetchOptions): Promise<SearchResult>;
  getAllBookmarkFolderTimeline(folderId: string, options?: TimelinePaginationOptions): Promise<SearchResult>;
}

export function withTimelines<TBase extends AbstractConstructor<TwitterClientBase>>(
  Base: TBase,
): Mixin<TBase, TwitterClientTimelineMethods> {
  abstract class TwitterClientTimelines extends Base {
    // biome-ignore lint/complexity/noUselessConstructor lint/suspicious/noExplicitAny: TS mixin constructor requirement.
    constructor(...args: any[]) {
      super(...args);
    }

    private logBookmarksDebug(message: string, data?: Record<string, unknown>): void {
      if (process.env.BIRD_DEBUG_BOOKMARKS !== '1') {
        return;
      }
      if (data) {
        console.error(`[bird][debug][bookmarks] ${message}`, JSON.stringify(data));
      } else {
        console.error(`[bird][debug][bookmarks] ${message}`);
      }
    }

    private async getBookmarksQueryIds(): Promise<string[]> {
      const primary = await this.getQueryId('Bookmarks');
      return Array.from(new Set([primary, 'RV1g3b8n_SGOHwkqKYSCFw', 'tmd4ifV8RHltzn8ymGg1aw']));
    }

    private async getBookmarkFolderQueryIds(): Promise<string[]> {
      const primary = await this.getQueryId('BookmarkFolderTimeline');
      return Array.from(new Set([primary, 'KJIQpsvxrTfRIlbaRIySHQ']));
    }

    private async getLikesQueryIds(): Promise<string[]> {
      const primary = await this.getQueryId('Likes');
      return Array.from(new Set([primary, 'JR2gceKucIKcVNB_9JkhsA']));
    }

    /**
     * Get the authenticated user's bookmarks
     */
    async getBookmarks(count = 20, options: TimelineFetchOptions = {}): Promise<SearchResult> {
      return this.getBookmarksPaged(count, options);
    }

    async getAllBookmarks(options?: TimelinePaginationOptions): Promise<SearchResult> {
      return this.getBookmarksPaged(Number.POSITIVE_INFINITY, options);
    }

    /**
     * Get the authenticated user's liked tweets
     */
    async getLikes(count = 20, options: TimelineFetchOptions = {}): Promise<SearchResult> {
      const { includeRaw = false } = options;
      const userResult = await this.getCurrentUser();
      if (!userResult.success || !userResult.user) {
        return { success: false, error: userResult.error ?? 'Could not determine current user' };
      }

      const variables = {
        userId: userResult.user.id,
        count,
        includePromotedContent: false,
        withClientEventToken: false,
        withBirdwatchNotes: false,
        withVoice: true,
      };

      const features = buildLikesFeatures();

      const params = new URLSearchParams({
        variables: JSON.stringify(variables),
        features: JSON.stringify(features),
      });

      const tryOnce = async () => {
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

            if (data.errors && data.errors.length > 0) {
              return { success: false as const, error: data.errors.map((e) => e.message).join(', '), had404 };
            }

            const instructions = data.data?.user?.result?.timeline?.timeline?.instructions;
            const tweets = parseTweetsFromInstructions(instructions, { quoteDepth: this.quoteDepth, includeRaw });

            return { success: true as const, tweets, had404 };
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }
        }

        return { success: false as const, error: lastError ?? 'Unknown error fetching likes', had404 };
      };

      const firstAttempt = await tryOnce();
      if (firstAttempt.success) {
        return { success: true, tweets: firstAttempt.tweets };
      }

      if (firstAttempt.had404) {
        await this.refreshQueryIds();
        const secondAttempt = await tryOnce();
        if (secondAttempt.success) {
          return { success: true, tweets: secondAttempt.tweets };
        }
        return { success: false, error: secondAttempt.error };
      }

      return { success: false, error: firstAttempt.error };
    }

    /**
     * Get the authenticated user's bookmark folder timeline
     */
    async getBookmarkFolderTimeline(
      folderId: string,
      count = 20,
      options: TimelineFetchOptions = {},
    ): Promise<SearchResult> {
      return this.getBookmarkFolderTimelinePaged(folderId, count, options);
    }

    async getAllBookmarkFolderTimeline(folderId: string, options?: TimelinePaginationOptions): Promise<SearchResult> {
      return this.getBookmarkFolderTimelinePaged(folderId, Number.POSITIVE_INFINITY, options);
    }

    private async getBookmarksPaged(limit: number, options: TimelinePaginationOptions = {}): Promise<SearchResult> {
      const features = buildBookmarksFeatures();
      const pageSize = 20;
      const seen = new Set<string>();
      const tweets: TweetData[] = [];
      let cursor: string | undefined;
      let pagesFetched = 0;
      const { includeRaw = false, maxPages } = options;

      const fetchPage = async (pageCount: number, pageCursor?: string) => {
        let lastError: string | undefined;
        let had404 = false;
        const queryIds = await this.getBookmarksQueryIds();

        const variables = {
          count: pageCount,
          includePromotedContent: false,
          withDownvotePerspective: false,
          withReactionsMetadata: false,
          withReactionsPerspective: false,
          ...(pageCursor ? { cursor: pageCursor } : {}),
        };

        const params = new URLSearchParams({
          variables: JSON.stringify(variables),
          features: JSON.stringify(features),
        });

        for (const queryId of queryIds) {
          const url = `${TWITTER_API_BASE}/${queryId}/Bookmarks?${params.toString()}`;

          try {
            this.logBookmarksDebug('request bookmarks page', {
              queryId,
              pageCount,
              hasCursor: Boolean(pageCursor),
            });
            const response = await this.fetchWithRetry(url, {
              method: 'GET',
              headers: this.getHeaders(),
            });

            if (response.status === 404) {
              had404 = true;
              lastError = `HTTP ${response.status}`;
              this.logBookmarksDebug('bookmarks 404', { queryId });
              continue;
            }

            if (!response.ok) {
              const text = await response.text();
              this.logBookmarksDebug('bookmarks non-200', {
                queryId,
                status: response.status,
                body: text.slice(0, 200),
              });
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
            const pageTweets = parseTweetsFromInstructions(instructions, { quoteDepth: this.quoteDepth, includeRaw });
            const nextCursor = extractCursorFromInstructions(instructions);

            if (data.errors && data.errors.length > 0) {
              this.logBookmarksDebug('bookmarks graphql errors (non-fatal)', { queryId, errors: data.errors });
              if (!instructions) {
                lastError = data.errors.map((e) => e.message).join(', ');
                continue;
              }
            }

            this.logBookmarksDebug('bookmarks page parsed', {
              queryId,
              tweets: pageTweets.length,
              hasNextCursor: Boolean(nextCursor),
            });

            return { success: true as const, tweets: pageTweets, cursor: nextCursor, had404 };
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
            this.logBookmarksDebug('bookmarks request error', { queryId, error: lastError });
          }
        }

        return { success: false as const, error: lastError ?? 'Unknown error fetching bookmarks', had404 };
      };

      const fetchWithRefresh = async (pageCount: number, pageCursor?: string) => {
        const firstAttempt = await fetchPage(pageCount, pageCursor);
        if (firstAttempt.success) {
          return firstAttempt;
        }
        if (firstAttempt.had404) {
          await this.refreshQueryIds();
          const secondAttempt = await fetchPage(pageCount, pageCursor);
          if (secondAttempt.success) {
            return secondAttempt;
          }
          return { success: false as const, error: secondAttempt.error };
        }
        return { success: false as const, error: firstAttempt.error };
      };

      const unlimited = !Number.isFinite(limit);
      while (unlimited || tweets.length < limit) {
        const pageCount = unlimited ? pageSize : Math.min(pageSize, limit - tweets.length);
        const page = await fetchWithRefresh(pageCount, cursor);
        if (!page.success) {
          return { success: false, error: page.error };
        }
        pagesFetched += 1;

        for (const tweet of page.tweets) {
          if (seen.has(tweet.id)) {
            continue;
          }
          seen.add(tweet.id);
          tweets.push(tweet);
          if (!unlimited && tweets.length >= limit) {
            break;
          }
        }

        if (!page.cursor || page.cursor === cursor || page.tweets.length === 0) {
          break;
        }
        if (maxPages && pagesFetched >= maxPages) {
          break;
        }
        cursor = page.cursor;
      }

      return { success: true, tweets };
    }

    private async getBookmarkFolderTimelinePaged(
      folderId: string,
      limit: number,
      options: TimelinePaginationOptions = {},
    ): Promise<SearchResult> {
      const features = buildBookmarksFeatures();
      const pageSize = 20;
      const seen = new Set<string>();
      const tweets: TweetData[] = [];
      let cursor: string | undefined;
      let pagesFetched = 0;
      const { includeRaw = false, maxPages } = options;

      const buildVariables = (pageCount: number, pageCursor: string | undefined, includeCount: boolean) => ({
        bookmark_collection_id: folderId,
        includePromotedContent: true,
        ...(includeCount ? { count: pageCount } : {}),
        ...(pageCursor ? { cursor: pageCursor } : {}),
      });

      const fetchPage = async (pageCount: number, pageCursor?: string) => {
        let lastError: string | undefined;
        let had404 = false;
        const queryIds = await this.getBookmarkFolderQueryIds();

        const tryOnce = async (variables: Record<string, unknown>) => {
          const params = new URLSearchParams({
            variables: JSON.stringify(variables),
            features: JSON.stringify(features),
          });

          for (const queryId of queryIds) {
            const url = `${TWITTER_API_BASE}/${queryId}/BookmarkFolderTimeline?${params.toString()}`;

            try {
              this.logBookmarksDebug('request bookmark folder page', {
                queryId,
                pageCount,
                hasCursor: Boolean(pageCursor),
                includeCount: Object.hasOwn(variables, 'count'),
              });
              const response = await this.fetchWithRetry(url, {
                method: 'GET',
                headers: this.getHeaders(),
              });

              if (response.status === 404) {
                had404 = true;
                lastError = `HTTP ${response.status}`;
                this.logBookmarksDebug('bookmark folder 404', { queryId });
                continue;
              }

              if (!response.ok) {
                const text = await response.text();
                this.logBookmarksDebug('bookmark folder non-200', {
                  queryId,
                  status: response.status,
                  body: text.slice(0, 200),
                });
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

              const instructions = data.data?.bookmark_collection_timeline?.timeline?.instructions;
              const pageTweets = parseTweetsFromInstructions(instructions, { quoteDepth: this.quoteDepth, includeRaw });
              const nextCursor = extractCursorFromInstructions(instructions);

              if (data.errors && data.errors.length > 0) {
                this.logBookmarksDebug('bookmark folder graphql errors (non-fatal)', { queryId, errors: data.errors });
                if (!instructions) {
                  lastError = data.errors.map((e) => e.message).join(', ');
                  continue;
                }
              }

              this.logBookmarksDebug('bookmark folder page parsed', {
                queryId,
                tweets: pageTweets.length,
                hasNextCursor: Boolean(nextCursor),
              });

              return { success: true as const, tweets: pageTweets, cursor: nextCursor, had404 };
            } catch (error) {
              lastError = error instanceof Error ? error.message : String(error);
              this.logBookmarksDebug('bookmark folder request error', { queryId, error: lastError });
            }
          }

          return { success: false as const, error: lastError ?? 'Unknown error fetching bookmark folder', had404 };
        };

        let attempt = await tryOnce(buildVariables(pageCount, pageCursor, true));
        if (!attempt.success && attempt.error?.includes('Variable "$count"')) {
          attempt = await tryOnce(buildVariables(pageCount, pageCursor, false));
        }

        if (!attempt.success && attempt.error?.includes('Variable "$cursor"') && pageCursor) {
          return {
            success: false as const,
            error: 'Bookmark folder pagination rejected the cursor parameter',
            had404: attempt.had404,
          };
        }

        return attempt;
      };

      const fetchWithRefresh = async (pageCount: number, pageCursor?: string) => {
        const firstAttempt = await fetchPage(pageCount, pageCursor);
        if (firstAttempt.success) {
          return firstAttempt;
        }
        if (firstAttempt.had404) {
          await this.refreshQueryIds();
          const secondAttempt = await fetchPage(pageCount, pageCursor);
          if (secondAttempt.success) {
            return secondAttempt;
          }
          return { success: false as const, error: secondAttempt.error };
        }
        return { success: false as const, error: firstAttempt.error };
      };

      const unlimited = !Number.isFinite(limit);
      while (unlimited || tweets.length < limit) {
        const pageCount = unlimited ? pageSize : Math.min(pageSize, limit - tweets.length);
        const page = await fetchWithRefresh(pageCount, cursor);
        if (!page.success) {
          return { success: false, error: page.error };
        }
        pagesFetched += 1;

        for (const tweet of page.tweets) {
          if (seen.has(tweet.id)) {
            continue;
          }
          seen.add(tweet.id);
          tweets.push(tweet);
          if (!unlimited && tweets.length >= limit) {
            break;
          }
        }

        if (!page.cursor || page.cursor === cursor || page.tweets.length === 0) {
          break;
        }
        if (maxPages && pagesFetched >= maxPages) {
          break;
        }
        cursor = page.cursor;
      }

      return { success: true, tweets };
    }

    private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
      const maxRetries = 2;
      const baseDelayMs = 500;
      const retryable = new Set([429, 500, 502, 503, 504]);

      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const response = await this.fetchWithTimeout(url, init);
        if (!retryable.has(response.status) || attempt === maxRetries) {
          return response;
        }
        this.logBookmarksDebug('retrying bookmarks request', {
          status: response.status,
          attempt,
        });

        // Retry-After supports delta-seconds only; HTTP-date falls back to backoff.
        const retryAfter = response.headers?.get?.('retry-after');
        const retryAfterMs = retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : Number.NaN;
        const backoffMs = Number.isFinite(retryAfterMs)
          ? retryAfterMs
          : baseDelayMs * 2 ** attempt + Math.floor(Math.random() * baseDelayMs);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }

      return this.fetchWithTimeout(url, init);
    }
  }

  return TwitterClientTimelines;
}
