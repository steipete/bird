import type { AbstractConstructor, Mixin, TwitterClientBase } from './twitter-client-base.js';
import { TWITTER_API_BASE } from './twitter-client-constants.js';
import { buildBookmarksFeatures, buildLikesFeatures } from './twitter-client-features.js';
import type { GraphqlTweetResult, SearchResult, TweetData } from './twitter-client-types.js';
import { extractCursorFromInstructions, parseTweetsFromInstructions } from './twitter-client-utils.js';

export interface TwitterClientTimelineMethods {
  getBookmarks(count?: number): Promise<SearchResult>;
  getLikes(count?: number): Promise<SearchResult>;
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

    private async getLikesQueryIds(): Promise<string[]> {
      const primary = await this.getQueryId('Likes');
      return Array.from(new Set([primary, 'JR2gceKucIKcVNB_9JkhsA']));
    }

    /**
     * Get the authenticated user's bookmarks
     */
    async getBookmarks(count = 20): Promise<SearchResult> {
      const pageSize = 96;
      const seen = new Set<string>();
      const tweets: TweetData[] = [];
      let cursor: string | undefined;
      const features = buildBookmarksFeatures();

      const fetchPage = async (pageCount: number, pageCursor?: string) => {
        let lastError: string | undefined;
        let had404 = false;
        const queryIds = await this.getBookmarksQueryIds();

        for (const queryId of queryIds) {
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
            if (data.errors && data.errors.length > 0) {
              const message = data.errors.map((e) => e.message).join(', ');
              if (!instructions) {
                if (message.includes('Query: Unspecified')) {
                  lastError = message;
                  continue;
                }
                return { success: false as const, error: message, had404 };
              }
            }
            const pageTweets = parseTweetsFromInstructions(instructions, this.quoteDepth);
            const nextCursor = extractCursorFromInstructions(instructions);

            return { success: true as const, tweets: pageTweets, cursor: nextCursor, had404 };
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }
        }

        return { success: false as const, error: lastError ?? 'Unknown error fetching bookmarks', had404 };
      };

      const fetchWithRefresh = async (pageCount: number, pageCursor?: string) => {
        const firstAttempt = await fetchPage(pageCount, pageCursor);
        if (firstAttempt.success) {
          return firstAttempt;
        }
        const shouldRefresh =
          firstAttempt.had404 || (typeof firstAttempt.error === 'string' && firstAttempt.error.includes('Query: Unspecified'));
        if (shouldRefresh) {
          await this.refreshQueryIds();
          const secondAttempt = await fetchPage(pageCount, pageCursor);
          if (secondAttempt.success) {
            return secondAttempt;
          }
          return { success: false as const, error: secondAttempt.error };
        }
        return { success: false as const, error: firstAttempt.error };
      };

      while (tweets.length < count) {
        const pageCount = Math.min(pageSize, count - tweets.length);
        const page = await fetchWithRefresh(pageCount, cursor);
        if (!page.success) {
          return { success: false, error: page.error };
        }

        for (const tweet of page.tweets) {
          if (seen.has(tweet.id)) {
            continue;
          }
          seen.add(tweet.id);
          tweets.push(tweet);
          if (tweets.length >= count) {
            break;
          }
        }

        if (!page.cursor || page.cursor === cursor || page.tweets.length === 0) {
          break;
        }
        cursor = page.cursor;
      }

      return { success: true, tweets };
    }

    /**
     * Get the authenticated user's liked tweets
     */
    async getLikes(count = 20): Promise<SearchResult> {
      const userResult = await this.getCurrentUser();
      if (!userResult.success || !userResult.user) {
        return { success: false, error: userResult.error ?? 'Could not determine current user' };
      }

      const userId = userResult.user.id;
      const pageSize = 20;
      const seen = new Set<string>();
      const tweets: TweetData[] = [];
      let cursor: string | undefined;
      const features = buildLikesFeatures();

      const fetchPage = async (pageCount: number, pageCursor?: string) => {
        let lastError: string | undefined;
        let had404 = false;
        const queryIds = await this.getLikesQueryIds();

        for (const queryId of queryIds) {
          const variables = {
            userId,
            count: pageCount,
            includePromotedContent: false,
            withClientEventToken: false,
            withBirdwatchNotes: false,
            withVoice: true,
            ...(pageCursor ? { cursor: pageCursor } : {}),
          };

          const params = new URLSearchParams({
            variables: JSON.stringify(variables),
            features: JSON.stringify(features),
          });
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
            const pageTweets = parseTweetsFromInstructions(instructions, this.quoteDepth);
            const nextCursor = extractCursorFromInstructions(instructions);

            return { success: true as const, tweets: pageTweets, cursor: nextCursor, had404 };
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }
        }

        return { success: false as const, error: lastError ?? 'Unknown error fetching likes', had404 };
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

      while (tweets.length < count) {
        const pageCount = Math.min(pageSize, count - tweets.length);
        const page = await fetchWithRefresh(pageCount, cursor);
        if (!page.success) {
          return { success: false, error: page.error };
        }

        for (const tweet of page.tweets) {
          if (seen.has(tweet.id)) {
            continue;
          }
          seen.add(tweet.id);
          tweets.push(tweet);
          if (tweets.length >= count) {
            break;
          }
        }

        if (!page.cursor || page.cursor === cursor || page.tweets.length === 0) {
          break;
        }
        cursor = page.cursor;
      }

      return { success: true, tweets };
    }

    /**
     * Get the authenticated user's bookmark folder timeline
     */
    async getBookmarkFolderTimeline(folderId: string, count = 20): Promise<SearchResult> {
      const pageSize = 20;
      const seen = new Set<string>();
      const tweets: TweetData[] = [];
      let cursor: string | undefined;
      let allowCount = true;
      const features = buildBookmarksFeatures();

      const buildVariables = (pageCount: number, pageCursor?: string) => ({
        bookmark_collection_id: folderId,
        includePromotedContent: true,
        ...(allowCount ? { count: pageCount } : {}),
        ...(pageCursor ? { cursor: pageCursor } : {}),
      });

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
            const pageTweets = parseTweetsFromInstructions(instructions, this.quoteDepth);
            const nextCursor = extractCursorFromInstructions(instructions);

            return { success: true as const, tweets: pageTweets, cursor: nextCursor, had404 };
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }
        }

        return { success: false as const, error: lastError ?? 'Unknown error fetching bookmark folder', had404 };
      };

      const fetchWithRefresh = async (pageCount: number, pageCursor?: string) => {
        let firstAttempt = await tryOnce(buildVariables(pageCount, pageCursor));
        if (!firstAttempt.success && firstAttempt.error?.includes('Variable "$count"')) {
          allowCount = false;
          firstAttempt = await tryOnce(buildVariables(pageCount, pageCursor));
        }
        if (firstAttempt.success) {
          return firstAttempt;
        }

        if (firstAttempt.had404) {
          await this.refreshQueryIds();
          let secondAttempt = await tryOnce(buildVariables(pageCount, pageCursor));
          if (!secondAttempt.success && secondAttempt.error?.includes('Variable "$count"')) {
            allowCount = false;
            secondAttempt = await tryOnce(buildVariables(pageCount, pageCursor));
          }
          if (secondAttempt.success) {
            return secondAttempt;
          }
          return { success: false as const, error: secondAttempt.error };
        }

        return { success: false as const, error: firstAttempt.error };
      };

      while (tweets.length < count) {
        const pageCount = Math.min(pageSize, count - tweets.length);
        const page = await fetchWithRefresh(pageCount, cursor);
        if (!page.success) {
          return { success: false, error: page.error };
        }

        for (const tweet of page.tweets) {
          if (seen.has(tweet.id)) {
            continue;
          }
          seen.add(tweet.id);
          tweets.push(tweet);
          if (tweets.length >= count) {
            break;
          }
        }

        if (!page.cursor || page.cursor === cursor || page.tweets.length === 0) {
          break;
        }
        cursor = page.cursor;
      }

      return { success: true, tweets };
    }
  }

  return TwitterClientTimelines;
}
