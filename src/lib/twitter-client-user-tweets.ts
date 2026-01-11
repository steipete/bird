import { normalizeHandle } from './normalize-handle.js';
import type { AbstractConstructor, Mixin, TwitterClientBase } from './twitter-client-base.js';
import { TWITTER_API_BASE } from './twitter-client-constants.js';
import { buildUserTweetsFeatures } from './twitter-client-features.js';
import type { GraphqlTweetResult, SearchResult, TweetData } from './twitter-client-types.js';
import { extractCursorFromInstructions, parseTweetsFromInstructions } from './twitter-client-utils.js';

/** Options for user tweets fetch methods */
export interface UserTweetsFetchOptions {
  /** Include raw GraphQL response in `_raw` field */
  includeRaw?: boolean;
}

/** Options for paginated user tweets fetch */
export interface UserTweetsPaginationOptions extends UserTweetsFetchOptions {
  /** Maximum number of pages to fetch (default: 1) */
  maxPages?: number;
  /** Starting cursor for pagination (resume from previous fetch) */
  cursor?: string;
  /** Delay in milliseconds between page fetches (default: 1000) */
  pageDelayMs?: number;
}

/** Result of username to userId lookup */
export interface UserLookupResult {
  success: boolean;
  userId?: string;
  username?: string;
  name?: string;
  error?: string;
}

export interface TwitterClientUserTweetsMethods {
  getUserIdByUsername(username: string): Promise<UserLookupResult>;
  getUserTweets(userId: string, count?: number, options?: UserTweetsFetchOptions): Promise<SearchResult>;
  getUserTweetsPaged(userId: string, options?: UserTweetsPaginationOptions): Promise<SearchResult>;
}

export function withUserTweets<TBase extends AbstractConstructor<TwitterClientBase>>(
  Base: TBase,
): Mixin<TBase, TwitterClientUserTweetsMethods> {
  abstract class TwitterClientUserTweets extends Base {
    // biome-ignore lint/complexity/noUselessConstructor lint/suspicious/noExplicitAny: TS mixin constructor requirement.
    constructor(...args: any[]) {
      super(...args);
    }

    private async getUserTweetsQueryIds(): Promise<string[]> {
      const primary = await this.getQueryId('UserTweets');
      // Fallback query ID observed from web client
      return Array.from(new Set([primary, 'Wms1GvIiHXAPBaCr9KblaA']));
    }

    private async getUserByScreenNameGraphQL(screenName: string): Promise<UserLookupResult> {
      // UserByScreenName query IDs observed from web client
      const queryIds = ['xc8f1g7BYqr6VTzTbvNlGw', 'qW5u-DAuXpMEG0zA1F7UGQ', 'sLVLhk0bGj3MVFEKTdax1w'];

      const variables = {
        screen_name: screenName,
        withSafetyModeUserFields: true,
      };

      const features = {
        hidden_profile_subscriptions_enabled: true,
        hidden_profile_likes_enabled: true,
        rweb_tipjar_consumption_enabled: true,
        responsive_web_graphql_exclude_directive_enabled: true,
        verified_phone_label_enabled: false,
        subscriptions_verification_info_is_identity_verified_enabled: true,
        subscriptions_verification_info_verified_since_enabled: true,
        highlights_tweets_tab_ui_enabled: true,
        responsive_web_twitter_article_notes_tab_enabled: true,
        subscriptions_feature_can_gift_premium: true,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        responsive_web_graphql_timeline_navigation_enabled: true,
        blue_business_profile_image_shape_enabled: true,
      };

      const fieldToggles = {
        withAuxiliaryUserLabels: false,
      };

      const params = new URLSearchParams({
        variables: JSON.stringify(variables),
        features: JSON.stringify(features),
        fieldToggles: JSON.stringify(fieldToggles),
      });

      let lastError: string | undefined;

      for (const queryId of queryIds) {
        const url = `${TWITTER_API_BASE}/${queryId}/UserByScreenName?${params.toString()}`;

        try {
          const response = await this.fetchWithTimeout(url, {
            method: 'GET',
            headers: this.getHeaders(),
          });

          if (!response.ok) {
            const text = await response.text();
            if (response.status === 404) {
              // Try next query ID
              lastError = `HTTP ${response.status}`;
              continue;
            }
            lastError = `HTTP ${response.status}: ${text.slice(0, 200)}`;
            continue;
          }

          const data = (await response.json()) as {
            data?: {
              user?: {
                result?: {
                  __typename?: string;
                  rest_id?: string;
                  id?: string;
                  legacy?: {
                    screen_name?: string;
                    name?: string;
                  };
                  core?: {
                    screen_name?: string;
                    name?: string;
                  };
                };
              };
            };
            errors?: Array<{ message: string }>;
          };

          // Check for user not found
          if (data.data?.user?.result?.__typename === 'UserUnavailable') {
            return { success: false, error: `User @${screenName} not found or unavailable` };
          }

          const userResult = data.data?.user?.result;
          const userId = userResult?.rest_id;
          const username = userResult?.legacy?.screen_name ?? userResult?.core?.screen_name;
          const name = userResult?.legacy?.name ?? userResult?.core?.name;

          if (userId && username) {
            return {
              success: true,
              userId,
              username,
              name,
            };
          }

          if (data.errors && data.errors.length > 0) {
            lastError = data.errors.map((e) => e.message).join(', ');
            continue;
          }

          lastError = 'Could not parse user data from response';
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      return { success: false, error: lastError ?? 'Unknown error looking up user' };
    }

    private async sleep(ms: number): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Look up a user's ID by their username/handle.
     * Uses Twitter's REST API endpoint.
     */
    async getUserIdByUsername(username: string): Promise<UserLookupResult> {
      // Normalize and validate handle
      const cleanUsername = normalizeHandle(username);
      if (!cleanUsername) {
        return { success: false, error: `Invalid username: ${username}` };
      }

      // Try GraphQL UserByScreenName first (more reliable with cookie auth)
      const graphqlResult = await this.getUserByScreenNameGraphQL(cleanUsername);
      if (graphqlResult.success) {
        return graphqlResult;
      }

      // If GraphQL definitively says user is unavailable, don't retry with REST
      if (graphqlResult.error?.includes('not found or unavailable')) {
        return graphqlResult;
      }

      // Fallback to REST API for transient GraphQL errors
      const urls = [
        `https://x.com/i/api/1.1/users/show.json?screen_name=${encodeURIComponent(cleanUsername)}`,
        `https://api.twitter.com/1.1/users/show.json?screen_name=${encodeURIComponent(cleanUsername)}`,
      ];

      let lastError: string | undefined = graphqlResult.error;

      for (const url of urls) {
        try {
          const response = await this.fetchWithTimeout(url, {
            method: 'GET',
            headers: this.getHeaders(),
          });

          if (!response.ok) {
            const text = await response.text();
            // Check for user not found
            if (response.status === 404) {
              return { success: false, error: `User @${cleanUsername} not found` };
            }
            lastError = `HTTP ${response.status}: ${text.slice(0, 200)}`;
            continue;
          }

          const data = (await response.json()) as {
            id_str?: string;
            id?: number;
            screen_name?: string;
            name?: string;
          };

          const userId = data.id_str ?? (data.id ? String(data.id) : null);
          if (!userId) {
            lastError = 'Could not parse user ID from response';
            continue;
          }

          return {
            success: true,
            userId,
            username: data.screen_name ?? cleanUsername,
            name: data.name,
          };
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      return { success: false, error: lastError ?? 'Unknown error looking up user' };
    }

    /**
     * Get tweets from a user's profile timeline (single page).
     */
    async getUserTweets(userId: string, count = 20, options: UserTweetsFetchOptions = {}): Promise<SearchResult> {
      const result = await this.getUserTweetsPaged(userId, {
        ...options,
        maxPages: 1,
      });

      // Trim to requested count
      if (result.success && result.tweets && result.tweets.length > count) {
        result.tweets = result.tweets.slice(0, count);
      }

      return result;
    }

    /**
     * Get tweets from a user's profile timeline with pagination support.
     */
    async getUserTweetsPaged(userId: string, options: UserTweetsPaginationOptions = {}): Promise<SearchResult> {
      const { includeRaw = false, maxPages = 1, pageDelayMs = 1000 } = options;
      const features = buildUserTweetsFeatures();
      const pageSize = 20;
      const seen = new Set<string>();
      const tweets: TweetData[] = [];
      let cursor: string | undefined = options.cursor;
      let nextCursor: string | undefined;
      let pagesFetched = 0;

      const fetchPage = async (pageCursor?: string) => {
        let lastError: string | undefined;
        let had404 = false;
        const queryIds = await this.getUserTweetsQueryIds();

        const variables = {
          userId,
          count: pageSize,
          includePromotedContent: false, // Filter out ads
          withQuickPromoteEligibilityTweetFields: true,
          withVoice: true,
          ...(pageCursor ? { cursor: pageCursor } : {}),
        };

        const fieldToggles = {
          withArticlePlainText: false,
        };

        const params = new URLSearchParams({
          variables: JSON.stringify(variables),
          features: JSON.stringify(features),
          fieldToggles: JSON.stringify(fieldToggles),
        });

        for (const queryId of queryIds) {
          const url = `${TWITTER_API_BASE}/${queryId}/UserTweets?${params.toString()}`;

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
                          type?: string;
                          entries?: Array<{
                            content?: {
                              itemContent?: {
                                tweet_results?: {
                                  result?: GraphqlTweetResult;
                                };
                              };
                              item?: {
                                itemContent?: {
                                  tweet_results?: {
                                    result?: GraphqlTweetResult;
                                  };
                                };
                              };
                              items?: Array<{
                                item?: {
                                  itemContent?: {
                                    tweet_results?: {
                                      result?: GraphqlTweetResult;
                                    };
                                  };
                                };
                                itemContent?: {
                                  tweet_results?: {
                                    result?: GraphqlTweetResult;
                                  };
                                };
                                content?: {
                                  itemContent?: {
                                    tweet_results?: {
                                      result?: GraphqlTweetResult;
                                    };
                                  };
                                };
                              }>;
                              cursorType?: string;
                              value?: string;
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
              // Check for common errors
              const errorMsg = data.errors.map((e) => e.message).join(', ');
              if (errorMsg.includes('User has been suspended') || errorMsg.includes('User not found')) {
                return { success: false as const, error: errorMsg, had404 };
              }
              // Some errors are non-fatal if we got data
              if (!data.data?.user?.result?.timeline?.timeline?.instructions) {
                return { success: false as const, error: errorMsg, had404 };
              }
            }

            const instructions = data.data?.user?.result?.timeline?.timeline?.instructions;
            const pageTweets = parseTweetsFromInstructions(instructions, { quoteDepth: this.quoteDepth, includeRaw });
            const pageCursorValue = extractCursorFromInstructions(instructions);

            return { success: true as const, tweets: pageTweets, cursor: pageCursorValue, had404 };
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }
        }

        return { success: false as const, error: lastError ?? 'Unknown error fetching user tweets', had404 };
      };

      const fetchWithRefresh = async (pageCursor?: string) => {
        const firstAttempt = await fetchPage(pageCursor);
        if (firstAttempt.success) {
          return firstAttempt;
        }
        if (firstAttempt.had404) {
          await this.refreshQueryIds();
          const secondAttempt = await fetchPage(pageCursor);
          if (secondAttempt.success) {
            return secondAttempt;
          }
          return { success: false as const, error: secondAttempt.error };
        }
        return { success: false as const, error: firstAttempt.error };
      };

      while (pagesFetched < maxPages) {
        // Add delay between pages (but not before the first page)
        if (pagesFetched > 0 && pageDelayMs > 0) {
          await this.sleep(pageDelayMs);
        }

        const page = await fetchWithRefresh(cursor);
        if (!page.success) {
          // If we have some tweets already, return them with the error
          if (tweets.length > 0) {
            return { success: true, tweets, nextCursor: cursor, error: page.error };
          }
          return { success: false, error: page.error };
        }
        pagesFetched += 1;

        for (const tweet of page.tweets) {
          if (seen.has(tweet.id)) {
            continue;
          }
          seen.add(tweet.id);
          tweets.push(tweet);
        }

        const pageCursor = page.cursor;
        if (!pageCursor || pageCursor === cursor || page.tweets.length === 0) {
          nextCursor = undefined;
          break;
        }

        cursor = pageCursor;
        nextCursor = pageCursor;
      }

      return { success: true, tweets, nextCursor };
    }
  }

  return TwitterClientUserTweets;
}
