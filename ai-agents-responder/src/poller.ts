/**
 * Poller - Bird search wrapper for AI Agents Twitter Auto-Responder
 *
 * Wraps Bird's search functionality to return TweetCandidate[] format.
 */

import {
  TwitterClient,
  resolveCredentials,
  type TweetData,
  type SearchResult,
} from '@steipete/bird';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import type { TweetCandidate, PollerResult, Config } from './types.js';

// POC hardcoded values
const DEFAULT_QUERY = '"AI agents" -is:retweet lang:en';
const DEFAULT_COUNT = 50;

/**
 * Map Bird TweetData to our TweetCandidate interface
 */
function mapTweetToCandidate(tweet: TweetData): TweetCandidate {
  // Extract authorId from the raw data if available, otherwise use username as fallback
  const authorId = tweet.authorId ?? tweet.author.username;

  // Parse createdAt if available, otherwise use current time
  const createdAt = tweet.createdAt ? new Date(tweet.createdAt) : new Date();

  // Detect if this is a retweet by checking text prefix or inReplyToStatusId
  // Note: The search query already filters out retweets with -is:retweet,
  // but we include the flag for completeness
  const isRetweet = tweet.text.startsWith('RT @');

  // Language detection: Bird doesn't expose language directly,
  // so we rely on the search query filter (lang:en)
  // Default to 'en' since we're filtering for English in the query
  const language = 'en';

  return {
    id: tweet.id,
    text: tweet.text,
    authorId,
    authorUsername: tweet.author.username,
    createdAt,
    language,
    isRetweet,
  };
}

/**
 * Poller class wrapping Bird search functionality
 */
export class Poller {
  private client: TwitterClient;
  private initialized: boolean = false;

  constructor() {
    // Client will be initialized lazily on first search
    this.client = null as unknown as TwitterClient;
  }

  /**
   * Initialize the Bird client with credentials
   */
  private async initialize(): Promise<{ success: boolean; error?: string }> {
    if (this.initialized) {
      return { success: true };
    }

    const config = loadConfig();

    try {
      const startTime = Date.now();

      if (config.bird.cookieSource) {
        // Method 1: Extract cookies from browser
        logger.info('poller', 'initializing_from_browser', {
          source: config.bird.cookieSource,
        });

        const result = await resolveCredentials({
          cookieSource: config.bird.cookieSource,
        });

        if (!result.cookies.authToken || !result.cookies.ct0) {
          return {
            success: false,
            error: `Failed to extract credentials from ${config.bird.cookieSource}: missing authToken or ct0`,
          };
        }

        this.client = new TwitterClient({
          cookies: result.cookies,
        });
      } else if (config.bird.authToken && config.bird.ct0) {
        // Method 2: Manual tokens
        logger.info('poller', 'initializing_from_tokens', {
          authTokenPrefix: config.bird.authToken.substring(0, 10) + '...',
        });

        this.client = new TwitterClient({
          cookies: {
            authToken: config.bird.authToken,
            ct0: config.bird.ct0,
            cookieHeader: null,
            source: 'manual',
          },
        });
      } else {
        return {
          success: false,
          error: 'Invalid bird configuration: must provide either cookieSource or manual tokens',
        };
      }

      this.initialized = true;
      const duration = Date.now() - startTime;

      logger.info('poller', 'client_initialized', { durationMs: duration });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('poller', 'initialization_failed', error as Error, {});
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Search for tweets matching a query
   *
   * @param query - Search query (defaults to POC hardcoded query)
   * @param count - Number of results to fetch (defaults to 50)
   * @returns PollerResult with tweets array or error
   */
  async search(
    query: string = DEFAULT_QUERY,
    count: number = DEFAULT_COUNT
  ): Promise<PollerResult> {
    const startTime = Date.now();

    // Ensure client is initialized
    const initResult = await this.initialize();
    if (!initResult.success) {
      return {
        success: false,
        tweets: [],
        error: initResult.error,
      };
    }

    try {
      logger.info('poller', 'search_started', { query, count });

      const result: SearchResult = await this.client.search(query, count);

      const duration = Date.now() - startTime;

      if (!result.success) {
        logger.error('poller', 'search_failed', new Error(result.error), {
          query,
          count,
          durationMs: duration,
        });

        return {
          success: false,
          tweets: [],
          error: result.error,
        };
      }

      // Map Bird TweetData[] to TweetCandidate[]
      const tweets = result.tweets.map(mapTweetToCandidate);

      logger.info('poller', 'search_completed', {
        query,
        requestedCount: count,
        resultCount: tweets.length,
        durationMs: duration,
      });

      return {
        success: true,
        tweets,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('poller', 'search_error', error as Error, {
        query,
        count,
        durationMs: duration,
      });

      return {
        success: false,
        tweets: [],
        error: errorMessage,
      };
    }
  }
}
