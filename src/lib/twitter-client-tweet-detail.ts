import type { AbstractConstructor, Mixin, TwitterClientBase } from './twitter-client-base.js';
import { TWITTER_API_BASE } from './twitter-client-constants.js';
import { buildArticleFeatures, buildArticleFieldToggles, buildTweetDetailFeatures } from './twitter-client-features.js';
import type { GetTweetResult, GraphqlTweetResult, SearchResult, TweetData } from './twitter-client-types.js';
import {
  extractArticleText,
  extractCursorFromInstructions,
  findTweetInInstructions,
  firstText,
  mapTweetResult,
  parseTweetsFromInstructions,
} from './twitter-client-utils.js';

/** Options for tweet fetching methods */
export interface TweetFetchOptions {
  /** Include raw GraphQL response in `_raw` field */
  includeRaw?: boolean;
}

/** Options for paginated tweet detail fetch */
export interface TweetDetailPaginationOptions extends TweetFetchOptions {
  /** Maximum number of pages to fetch (default: unlimited when using pagination) */
  maxPages?: number;
  /** Starting cursor for pagination (resume from previous fetch) */
  cursor?: string;
  /** Delay in milliseconds between page fetches (default: 1000) */
  pageDelayMs?: number;
}

export interface TwitterClientTweetDetailMethods {
  getTweet(tweetId: string, options?: TweetFetchOptions): Promise<GetTweetResult>;
  getReplies(tweetId: string, options?: TweetFetchOptions): Promise<SearchResult>;
  getThread(tweetId: string, options?: TweetFetchOptions): Promise<SearchResult>;
  getRepliesPaged(tweetId: string, options?: TweetDetailPaginationOptions): Promise<SearchResult>;
  getThreadPaged(tweetId: string, options?: TweetDetailPaginationOptions): Promise<SearchResult>;
}

export function withTweetDetails<TBase extends AbstractConstructor<TwitterClientBase>>(
  Base: TBase,
): Mixin<TBase, TwitterClientTweetDetailMethods> {
  abstract class TwitterClientTweetDetails extends Base {
    // biome-ignore lint/complexity/noUselessConstructor lint/suspicious/noExplicitAny: TS mixin constructor requirement.
    constructor(...args: any[]) {
      super(...args);
    }

    private async fetchUserArticlePlainText(
      userId: string,
      tweetId: string,
    ): Promise<{ title?: string; plainText?: string }> {
      const variables = {
        userId,
        count: 20,
        includePromotedContent: true,
        withVoice: true,
        withQuickPromoteEligibilityTweetFields: true,
        withBirdwatchNotes: true,
        withCommunity: true,
        withSafetyModeUserFields: true,
        withSuperFollowsUserFields: true,
        withDownvotePerspective: false,
        withReactionsMetadata: false,
        withReactionsPerspective: false,
        withSuperFollowsTweetFields: true,
        withSuperFollowsReplyCount: false,
        withClientEventToken: false,
      };

      const params = new URLSearchParams({
        variables: JSON.stringify(variables),
        features: JSON.stringify(buildArticleFeatures()),
        fieldToggles: JSON.stringify(buildArticleFieldToggles()),
      });

      const queryId = await this.getQueryId('UserArticlesTweets');
      const url = `${TWITTER_API_BASE}/${queryId}/UserArticlesTweets?${params.toString()}`;

      try {
        const response = await this.fetchWithTimeout(url, { method: 'GET', headers: this.getHeaders() });
        if (!response.ok) {
          return {};
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
                            tweet_results?: { result?: GraphqlTweetResult };
                          };
                        };
                      }>;
                    }>;
                  };
                };
              };
            };
          };
        };

        const instructions = data.data?.user?.result?.timeline?.timeline?.instructions ?? [];
        for (const instruction of instructions) {
          for (const entry of instruction.entries ?? []) {
            const result = entry.content?.itemContent?.tweet_results?.result;
            if (result?.rest_id !== tweetId) {
              continue;
            }
            const articleResult = result.article?.article_results?.result;
            const title = firstText(articleResult?.title, result.article?.title);
            const plainText = firstText(articleResult?.plain_text, result.article?.plain_text);
            return { title, plainText };
          }
        }
      } catch {
        return {};
      }

      return {};
    }

    private async sleep(ms: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private async fetchTweetDetail(
      tweetId: string,
      cursor?: string,
    ): Promise<
      | {
          success: true;
          data: {
            tweetResult?: { result?: GraphqlTweetResult };
            threaded_conversation_with_injections_v2?: {
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
        }
      | { success: false; error: string }
    > {
      const variables = {
        focalTweetId: tweetId,
        with_rux_injections: false,
        rankingMode: 'Relevance',
        includePromotedContent: true,
        withCommunity: true,
        withQuickPromoteEligibilityTweetFields: true,
        withBirdwatchNotes: true,
        withVoice: true,
        ...(cursor ? { cursor } : {}),
      };

      const features = {
        ...buildTweetDetailFeatures(),
        articles_preview_enabled: true,
        articles_rest_api_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        creator_subscriptions_tweet_preview_api_enabled: true,
        graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
        view_counts_everywhere_api_enabled: true,
        longform_notetweets_consumption_enabled: true,
        responsive_web_twitter_article_tweet_consumption_enabled: true,
        freedom_of_speech_not_reach_fetch_enabled: true,
        standardized_nudges_misinfo: true,
        tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
        rweb_video_timestamps_enabled: true,
      };

      const params = new URLSearchParams({
        variables: JSON.stringify(variables),
        features: JSON.stringify(features),
      });

      try {
        const parseResponse = async (response: Response) => {
          if (!response.ok) {
            const text = await response.text();
            return { success: false as const, error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
          }

          const data = (await response.json()) as {
            data?: {
              tweetResult?: { result?: GraphqlTweetResult };
              threaded_conversation_with_injections_v2?: {
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
            errors?: Array<{ message: string; code?: number }>;
          };

          if (data.errors && data.errors.length > 0) {
            return { success: false as const, error: data.errors.map((e) => e.message).join(', ') };
          }

          return { success: true as const, data: data.data ?? {} };
        };

        let lastError: string | undefined;
        let had404 = false;

        const tryOnce = async () => {
          const queryIds = await this.getTweetDetailQueryIds();

          for (const queryId of queryIds) {
            const url = `${TWITTER_API_BASE}/${queryId}/TweetDetail?${params.toString()}`;
            const response = await this.fetchWithTimeout(url, {
              method: 'GET',
              headers: this.getHeaders(),
            });

            if (response.status !== 404) {
              return await parseResponse(response);
            }

            had404 = true;

            const postResponse = await this.fetchWithTimeout(`${TWITTER_API_BASE}/${queryId}/TweetDetail`, {
              method: 'POST',
              headers: this.getHeaders(),
              body: JSON.stringify({ variables, features, queryId }),
            });

            if (postResponse.status !== 404) {
              return await parseResponse(postResponse);
            }

            lastError = 'HTTP 404';
          }

          return { success: false as const, error: lastError ?? 'Unknown error fetching tweet detail' };
        };

        const firstAttempt = await tryOnce();
        if (firstAttempt.success) {
          return firstAttempt;
        }

        if (had404) {
          await this.refreshQueryIds();
          return await tryOnce();
        }

        return firstAttempt;
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    /**
     * Get tweet details by ID
     */
    async getTweet(tweetId: string, options: TweetFetchOptions = {}): Promise<GetTweetResult> {
      const { includeRaw = false } = options;
      const response = await this.fetchTweetDetail(tweetId);
      if (!response.success) {
        return response;
      }

      const tweetResult =
        (response.data.tweetResult as { result?: GraphqlTweetResult } | undefined)?.result ??
        findTweetInInstructions(
          response.data.threaded_conversation_with_injections_v2?.instructions as
            | Array<{
                entries?: Array<{
                  content?: {
                    itemContent?: {
                      tweet_results?: {
                        result?: GraphqlTweetResult;
                      };
                    };
                  };
                }>;
              }>
            | undefined,
          tweetId,
        );

      const mapped = mapTweetResult(tweetResult, { quoteDepth: this.quoteDepth, includeRaw });
      if (mapped) {
        if (tweetResult?.article) {
          const title = firstText(tweetResult.article.article_results?.result?.title, tweetResult.article.title);
          const articleText = extractArticleText(tweetResult);
          if (title && (!articleText || articleText.trim() === title.trim())) {
            const userId = tweetResult.core?.user_results?.result?.rest_id;
            if (userId) {
              const fallback = await this.fetchUserArticlePlainText(userId, tweetId);
              if (fallback.plainText) {
                mapped.text = fallback.title ? `${fallback.title}\n\n${fallback.plainText}` : fallback.plainText;
              }
            }
          }
        }
        return { success: true, tweet: mapped };
      }
      return { success: false, error: 'Tweet not found in response' };
    }

    /**
     * Get replies to a tweet by ID
     */
    async getReplies(tweetId: string, options: TweetFetchOptions = {}): Promise<SearchResult> {
      const { includeRaw = false } = options;
      const response = await this.fetchTweetDetail(tweetId);
      if (!response.success) {
        return response;
      }

      const instructions = response.data.threaded_conversation_with_injections_v2?.instructions;
      const tweets = parseTweetsFromInstructions(instructions, { quoteDepth: this.quoteDepth, includeRaw });
      const replies = tweets.filter((tweet) => tweet.inReplyToStatusId === tweetId);

      return { success: true, tweets: replies };
    }

    /**
     * Get full conversation thread for a tweet ID
     */
    async getThread(tweetId: string, options: TweetFetchOptions = {}): Promise<SearchResult> {
      const { includeRaw = false } = options;
      const response = await this.fetchTweetDetail(tweetId);
      if (!response.success) {
        return response;
      }

      const instructions = response.data.threaded_conversation_with_injections_v2?.instructions;
      const tweets = parseTweetsFromInstructions(instructions, { quoteDepth: this.quoteDepth, includeRaw });

      const target = tweets.find((t) => t.id === tweetId);
      const rootId = target?.conversationId || tweetId;
      const thread = tweets.filter((tweet) => tweet.conversationId === rootId);

      thread.sort((a, b) => {
        const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
        const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
        return aTime - bTime;
      });

      return { success: true, tweets: thread };
    }

    /**
     * Get replies to a tweet with pagination support
     */
    async getRepliesPaged(tweetId: string, options: TweetDetailPaginationOptions = {}): Promise<SearchResult> {
      const { includeRaw = false, maxPages, pageDelayMs = 1000 } = options;
      const seen = new Set<string>();
      const allReplies: TweetData[] = [];
      let cursor: string | undefined = options.cursor;
      let nextCursor: string | undefined;
      let pagesFetched = 0;

      while (true) {
        // Add delay between pages (but not before the first page)
        if (pagesFetched > 0 && pageDelayMs > 0) {
          await this.sleep(pageDelayMs);
        }

        const response = await this.fetchTweetDetail(tweetId, cursor);
        if (!response.success) {
          // If we have some replies already, return them with the error
          if (allReplies.length > 0) {
            return { success: true, tweets: allReplies, nextCursor: cursor, error: response.error };
          }
          return response;
        }
        pagesFetched += 1;

        const instructions = response.data.threaded_conversation_with_injections_v2?.instructions;
        const tweets = parseTweetsFromInstructions(instructions, { quoteDepth: this.quoteDepth, includeRaw });
        const replies = tweets.filter((tweet) => tweet.inReplyToStatusId === tweetId);

        for (const reply of replies) {
          if (seen.has(reply.id)) {
            continue;
          }
          seen.add(reply.id);
          allReplies.push(reply);
        }

        const pageCursor = extractCursorFromInstructions(instructions);
        if (!pageCursor || pageCursor === cursor || replies.length === 0) {
          nextCursor = undefined;
          break;
        }

        if (maxPages && pagesFetched >= maxPages) {
          nextCursor = pageCursor;
          break;
        }

        cursor = pageCursor;
        nextCursor = pageCursor;
      }

      return { success: true, tweets: allReplies, nextCursor };
    }

    /**
     * Get full conversation thread with pagination support
     */
    async getThreadPaged(tweetId: string, options: TweetDetailPaginationOptions = {}): Promise<SearchResult> {
      const { includeRaw = false, maxPages, pageDelayMs = 1000 } = options;
      const seen = new Set<string>();
      const allTweets: TweetData[] = [];
      let cursor: string | undefined = options.cursor;
      let nextCursor: string | undefined;
      let pagesFetched = 0;
      let rootId: string | undefined;

      while (true) {
        // Add delay between pages (but not before the first page)
        if (pagesFetched > 0 && pageDelayMs > 0) {
          await this.sleep(pageDelayMs);
        }

        const response = await this.fetchTweetDetail(tweetId, cursor);
        if (!response.success) {
          // If we have some tweets already, return them with the error
          if (allTweets.length > 0) {
            return { success: true, tweets: allTweets, nextCursor: cursor, error: response.error };
          }
          return response;
        }
        pagesFetched += 1;

        const instructions = response.data.threaded_conversation_with_injections_v2?.instructions;
        const tweets = parseTweetsFromInstructions(instructions, { quoteDepth: this.quoteDepth, includeRaw });

        // Determine root conversation ID from first page
        if (!rootId) {
          const target = tweets.find((t) => t.id === tweetId);
          rootId = target?.conversationId || tweetId;
        }

        const threadTweets = tweets.filter((tweet) => tweet.conversationId === rootId);

        for (const tweet of threadTweets) {
          if (seen.has(tweet.id)) {
            continue;
          }
          seen.add(tweet.id);
          allTweets.push(tweet);
        }

        const pageCursor = extractCursorFromInstructions(instructions);
        if (!pageCursor || pageCursor === cursor || threadTweets.length === 0) {
          nextCursor = undefined;
          break;
        }

        if (maxPages && pagesFetched >= maxPages) {
          nextCursor = pageCursor;
          break;
        }

        cursor = pageCursor;
        nextCursor = pageCursor;
      }

      // Sort by creation time
      allTweets.sort((a, b) => {
        const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
        const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
        return aTime - bTime;
      });

      return { success: true, tweets: allTweets, nextCursor };
    }
  }

  return TwitterClientTweetDetails;
}
