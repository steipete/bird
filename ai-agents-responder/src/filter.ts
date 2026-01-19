/**
 * Filter pipeline for AI Agents Twitter Auto-Responder
 * Multi-stage validation: content -> deduplication -> followers -> rate limits
 * Phase 2: Added follower count check with caching, rate limit enforcement
 */

import {
  TwitterClient,
  resolveCredentials,
} from '@steipete/bird';
import type {
  TweetCandidate,
  FilterResult,
  FilterStats,
  Database,
  AuthorCacheEntry,
  Config,
  RateLimitState,
} from './types.js';
import { initDatabase } from './database.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';

/**
 * Filter configuration constants
 */
const FILTER_CONFIG = {
  minTweetLength: 100,
  maxTweetAgeMinutes: 30,
  requiredLanguage: 'en',
  maxRepliesPerAuthorPerDay: 1,
};

/**
 * Retry configuration for API calls
 */
const RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelayMs: 1000, // 1s, 2s, 4s delays
};

/**
 * Initialize filter stats with zero counts
 */
function createFilterStats(total: number): FilterStats {
  return {
    total,
    rejectedContent: 0,
    rejectedDuplicate: 0,
    rejectedFollowers: 0,
    rejectedRateLimit: 0,
    reasons: {},
  };
}

/**
 * Record a rejection reason in stats
 */
function recordRejection(
  stats: FilterStats,
  category: 'content' | 'duplicate' | 'followers' | 'rateLimit',
  reason: string
): void {
  switch (category) {
    case 'content':
      stats.rejectedContent++;
      break;
    case 'duplicate':
      stats.rejectedDuplicate++;
      break;
    case 'followers':
      stats.rejectedFollowers++;
      break;
    case 'rateLimit':
      stats.rejectedRateLimit++;
      break;
  }
  stats.reasons[reason] = (stats.reasons[reason] ?? 0) + 1;
}

/**
 * Stage 1: Content filters
 * - Length > 100 characters
 * - Language = en
 * - Not a retweet
 * - Age < 30 minutes
 */
function passesContentFilters(
  tweet: TweetCandidate,
  stats: FilterStats
): boolean {
  // Check tweet length
  if (tweet.text.length < FILTER_CONFIG.minTweetLength) {
    recordRejection(stats, 'content', 'too_short');
    return false;
  }

  // Check language
  if (tweet.language !== FILTER_CONFIG.requiredLanguage) {
    recordRejection(stats, 'content', 'wrong_language');
    return false;
  }

  // Check if retweet
  if (tweet.isRetweet) {
    recordRejection(stats, 'content', 'is_retweet');
    return false;
  }

  // Check tweet age
  const ageMinutes = (Date.now() - tweet.createdAt.getTime()) / (1000 * 60);
  if (ageMinutes > FILTER_CONFIG.maxTweetAgeMinutes) {
    recordRejection(stats, 'content', 'too_old');
    return false;
  }

  return true;
}

/**
 * Stage 2: Deduplication filters
 * - Haven't replied to this tweet before
 * - Haven't exceeded daily replies to this author
 */
async function passesDeduplicationFilters(
  tweet: TweetCandidate,
  db: Database,
  stats: FilterStats
): Promise<boolean> {
  // Check if already replied to this tweet
  const hasReplied = await db.hasRepliedToTweet(tweet.id);
  if (hasReplied) {
    recordRejection(stats, 'duplicate', 'already_replied_to_tweet');
    return false;
  }

  // Check replies to this author today
  const authorReplies = await db.getRepliesForAuthorToday(tweet.authorId);
  if (authorReplies >= FILTER_CONFIG.maxRepliesPerAuthorPerDay) {
    recordRejection(stats, 'duplicate', 'author_limit_reached');
    return false;
  }

  return true;
}

/**
 * Sleep helper for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch user profile with follower count using Bird client
 * Uses REST API endpoint which returns followers_count
 */
async function fetchUserProfile(
  client: TwitterClient,
  username: string
): Promise<{
  success: boolean;
  followerCount?: number;
  userId?: string;
  name?: string;
  isVerified?: boolean;
  followingCount?: number;
  error?: string;
}> {
  // Use Bird's internal REST API endpoint for user lookup
  // This endpoint returns followers_count unlike the basic GraphQL method
  const urls = [
    `https://x.com/i/api/1.1/users/show.json?screen_name=${encodeURIComponent(username)}`,
    `https://api.twitter.com/1.1/users/show.json?screen_name=${encodeURIComponent(username)}`,
  ];

  // Access Bird client's internal methods via prototype chain
  // The client has getHeaders() and fetchWithTimeout() we need
  const clientAny = client as unknown as {
    getHeaders: () => Record<string, string>;
    fetchWithTimeout: (url: string, options: RequestInit) => Promise<Response>;
  };

  let lastError: string | undefined;

  for (const url of urls) {
    try {
      const response = await clientAny.fetchWithTimeout(url, {
        method: 'GET',
        headers: clientAny.getHeaders(),
      });

      if (!response.ok) {
        const text = await response.text();
        if (response.status === 404) {
          return { success: false, error: `User @${username} not found` };
        }
        lastError = `HTTP ${response.status}: ${text.slice(0, 200)}`;
        continue;
      }

      const data = (await response.json()) as {
        id_str?: string;
        followers_count?: number;
        friends_count?: number;
        name?: string;
        verified?: boolean;
      };

      if (data.followers_count === undefined) {
        lastError = 'No follower count in response';
        continue;
      }

      return {
        success: true,
        followerCount: data.followers_count,
        userId: data.id_str,
        name: data.name,
        isVerified: data.verified,
        followingCount: data.friends_count,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  return { success: false, error: lastError ?? 'Unknown error fetching user profile' };
}

/**
 * Fetch user profile with exponential backoff retry
 */
async function fetchUserProfileWithRetry(
  client: TwitterClient,
  username: string
): Promise<{
  success: boolean;
  followerCount?: number;
  userId?: string;
  name?: string;
  isVerified?: boolean;
  followingCount?: number;
  error?: string;
}> {
  let lastError: string | undefined;

  for (let attempt = 0; attempt < RETRY_CONFIG.maxAttempts; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 1s, 2s, 4s
      const delayMs = RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt - 1);
      logger.info('filter', 'retry_delay', {
        attempt: attempt + 1,
        delayMs,
        username,
      });
      await sleep(delayMs);
    }

    const result = await fetchUserProfile(client, username);

    if (result.success) {
      return result;
    }

    lastError = result.error;

    // Don't retry if user not found (permanent error)
    if (result.error?.includes('not found')) {
      return result;
    }

    logger.warn('filter', 'fetch_user_profile_retry', {
      attempt: attempt + 1,
      maxAttempts: RETRY_CONFIG.maxAttempts,
      username,
      error: result.error,
    });
  }

  return { success: false, error: lastError ?? 'Max retries exceeded' };
}

/**
 * FilterPipeline class - runs candidates through all filter stages
 */
export class FilterPipeline {
  private db: Database | null = null;
  private config: Config | null = null;
  private client: TwitterClient | null = null;
  private clientInitialized: boolean = false;

  // Cache hit/miss tracking per cycle
  private cacheHits: number = 0;
  private cacheMisses: number = 0;

  /**
   * Initialize the filter pipeline with database connection
   */
  async initialize(): Promise<void> {
    if (!this.db) {
      this.db = await initDatabase();
    }
    if (!this.config) {
      this.config = loadConfig();
    }
  }

  /**
   * Initialize the Bird client for user lookups
   */
  private async initializeClient(): Promise<{ success: boolean; error?: string }> {
    if (this.clientInitialized && this.client) {
      return { success: true };
    }

    if (!this.config) {
      this.config = loadConfig();
    }

    try {
      if (this.config.bird.cookieSource) {
        const result = await resolveCredentials({
          cookieSource: this.config.bird.cookieSource,
        });

        if (!result.cookies.authToken || !result.cookies.ct0) {
          return {
            success: false,
            error: `Failed to extract credentials from ${this.config.bird.cookieSource}`,
          };
        }

        this.client = new TwitterClient({
          cookies: result.cookies,
        });
      } else if (this.config.bird.authToken && this.config.bird.ct0) {
        this.client = new TwitterClient({
          cookies: {
            authToken: this.config.bird.authToken,
            ct0: this.config.bird.ct0,
            cookieHeader: null,
            source: 'manual',
          },
        });
      } else {
        return {
          success: false,
          error: 'Invalid bird configuration for filter client',
        };
      }

      this.clientInitialized = true;
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Stage 3: Follower count check with caching
   * - Check author cache first (24h TTL)
   * - If cache miss, fetch from API with retry
   * - Skip if followerCount < MIN_FOLLOWER_COUNT
   */
  private async passesFollowerCheck(
    tweet: TweetCandidate,
    stats: FilterStats
  ): Promise<boolean> {
    if (!this.db || !this.config) {
      await this.initialize();
    }

    const minFollowerCount = this.config!.filters.minFollowerCount;

    // Check cache first (includes 24h TTL check in DB query)
    const cachedAuthor = await this.db!.getAuthorCache(tweet.authorId);

    if (cachedAuthor) {
      // Cache hit
      this.cacheHits++;

      if (cachedAuthor.followerCount < minFollowerCount) {
        recordRejection(stats, 'followers', 'below_threshold');
        logger.info('filter', 'follower_check_failed', {
          authorId: tweet.authorId,
          username: tweet.authorUsername,
          followerCount: cachedAuthor.followerCount,
          minRequired: minFollowerCount,
          cacheStatus: 'hit',
        });
        return false;
      }

      return true;
    }

    // Cache miss - need to fetch from API
    this.cacheMisses++;

    // Initialize Bird client if needed
    const clientInit = await this.initializeClient();
    if (!clientInit.success) {
      logger.error('filter', 'client_init_failed', new Error(clientInit.error), {
        authorId: tweet.authorId,
      });
      // On client init failure, skip this tweet (fail closed for safety)
      recordRejection(stats, 'followers', 'api_error');
      return false;
    }

    // Fetch user profile with retry
    const profile = await fetchUserProfileWithRetry(this.client!, tweet.authorUsername);

    if (!profile.success) {
      logger.error('filter', 'user_profile_fetch_failed', new Error(profile.error ?? 'Unknown'), {
        authorId: tweet.authorId,
        username: tweet.authorUsername,
      });
      // On API failure, skip this tweet (fail closed for safety)
      recordRejection(stats, 'followers', 'api_error');
      return false;
    }

    // Update cache with fresh data
    const authorEntry: AuthorCacheEntry = {
      authorId: profile.userId ?? tweet.authorId,
      username: tweet.authorUsername,
      name: profile.name ?? tweet.authorUsername,
      followerCount: profile.followerCount!,
      followingCount: profile.followingCount ?? 0,
      isVerified: profile.isVerified ?? false,
      updatedAt: new Date(),
    };

    await this.db!.upsertAuthorCache(authorEntry);

    logger.info('filter', 'author_cache_updated', {
      authorId: authorEntry.authorId,
      username: authorEntry.username,
      followerCount: authorEntry.followerCount,
      cacheStatus: 'miss',
    });

    // Check follower count against threshold
    if (authorEntry.followerCount < minFollowerCount) {
      recordRejection(stats, 'followers', 'below_threshold');
      logger.info('filter', 'follower_check_failed', {
        authorId: tweet.authorId,
        username: tweet.authorUsername,
        followerCount: authorEntry.followerCount,
        minRequired: minFollowerCount,
        cacheStatus: 'miss',
      });
      return false;
    }

    return true;
  }

  /**
   * Stage 4: Rate limit check
   * - Check daily count < maxDailyReplies
   * - Check gap since last reply >= minGapMinutes
   * - Check replies to this author today < maxPerAuthorPerDay
   */
  private async passesRateLimitCheck(
    tweet: TweetCandidate,
    stats: FilterStats
  ): Promise<boolean> {
    if (!this.db || !this.config) {
      await this.initialize();
    }

    const rateLimits = this.config!.rateLimits;

    // Reset daily count if needed (past midnight UTC)
    await this.db!.resetDailyCountIfNeeded();

    // Get current rate limit state
    const state = await this.db!.getRateLimitState();

    // Check daily count limit
    if (state.dailyCount >= rateLimits.maxDailyReplies) {
      recordRejection(stats, 'rateLimit', 'daily_limit_exceeded');
      logger.info('filter', 'rate_limit_exceeded', {
        reason: 'daily_limit',
        dailyCount: state.dailyCount,
        maxDailyReplies: rateLimits.maxDailyReplies,
      });
      return false;
    }

    // Check gap since last reply
    if (state.lastReplyAt) {
      const gapMinutes = (Date.now() - state.lastReplyAt.getTime()) / (1000 * 60);
      if (gapMinutes < rateLimits.minGapMinutes) {
        recordRejection(stats, 'rateLimit', 'gap_too_short');
        logger.info('filter', 'rate_limit_exceeded', {
          reason: 'gap_too_short',
          gapMinutes: Math.round(gapMinutes * 10) / 10,
          minGapMinutes: rateLimits.minGapMinutes,
          lastReplyAt: state.lastReplyAt.toISOString(),
        });
        return false;
      }
    }

    // Check per-author daily limit
    const authorReplies = await this.db!.getRepliesForAuthorToday(tweet.authorId);
    if (authorReplies >= rateLimits.maxPerAuthorPerDay) {
      recordRejection(stats, 'rateLimit', 'author_daily_limit');
      logger.info('filter', 'rate_limit_exceeded', {
        reason: 'author_daily_limit',
        authorId: tweet.authorId,
        authorUsername: tweet.authorUsername,
        authorReplies,
        maxPerAuthorPerDay: rateLimits.maxPerAuthorPerDay,
      });
      return false;
    }

    return true;
  }

  /**
   * Log rate limit status at the start of each cycle
   */
  private async logRateLimitStatus(): Promise<void> {
    if (!this.db || !this.config) {
      await this.initialize();
    }

    // Reset daily count if needed before logging
    await this.db!.resetDailyCountIfNeeded();

    const state = await this.db!.getRateLimitState();
    const rateLimits = this.config!.rateLimits;

    let gapMinutes: number | null = null;
    let minutesUntilNextReply: number | null = null;

    if (state.lastReplyAt) {
      gapMinutes = Math.round((Date.now() - state.lastReplyAt.getTime()) / (1000 * 60) * 10) / 10;
      const remaining = rateLimits.minGapMinutes - gapMinutes;
      minutesUntilNextReply = remaining > 0 ? Math.round(remaining * 10) / 10 : 0;
    }

    logger.info('filter', 'rate_limit_status', {
      dailyCount: state.dailyCount,
      maxDailyReplies: rateLimits.maxDailyReplies,
      dailyRemaining: rateLimits.maxDailyReplies - state.dailyCount,
      lastReplyAt: state.lastReplyAt?.toISOString() ?? null,
      gapMinutes,
      minGapMinutes: rateLimits.minGapMinutes,
      minutesUntilNextReply,
      dailyResetAt: state.dailyResetAt.toISOString(),
    });
  }

  /**
   * Filter candidates through all stages
   * Returns first eligible tweet or null
   */
  async filter(candidates: TweetCandidate[]): Promise<FilterResult> {
    // Ensure database is initialized
    if (!this.db) {
      await this.initialize();
    }

    // Reset cache tracking for this cycle
    this.cacheHits = 0;
    this.cacheMisses = 0;

    // Log rate limit status at start of each cycle
    await this.logRateLimitStatus();

    const stats = createFilterStats(candidates.length);
    let eligible: TweetCandidate | null = null;

    for (const tweet of candidates) {
      // Stage 1: Content filters
      if (!passesContentFilters(tweet, stats)) {
        continue;
      }

      // Stage 2: Deduplication filters
      if (!(await passesDeduplicationFilters(tweet, this.db!, stats))) {
        continue;
      }

      // Stage 3: Follower count check (with caching)
      if (!(await this.passesFollowerCheck(tweet, stats))) {
        continue;
      }

      // Stage 4: Rate limit check
      if (!(await this.passesRateLimitCheck(tweet, stats))) {
        continue;
      }

      // Found an eligible tweet
      eligible = tweet;
      break;
    }

    // Log filter stats including cache metrics
    this.logFilterStats(stats, eligible);

    return { eligible, stats };
  }

  /**
   * Log filter statistics after each cycle
   */
  private logFilterStats(
    stats: FilterStats,
    eligible: TweetCandidate | null
  ): void {
    const totalRejected =
      stats.rejectedContent +
      stats.rejectedDuplicate +
      stats.rejectedFollowers +
      stats.rejectedRateLimit;

    const totalCacheChecks = this.cacheHits + this.cacheMisses;
    const cacheHitRate = totalCacheChecks > 0
      ? Math.round((this.cacheHits / totalCacheChecks) * 100)
      : 0;

    logger.info('filter', 'cycle_complete', {
      total: stats.total,
      rejected: totalRejected,
      rejectedContent: stats.rejectedContent,
      rejectedDuplicate: stats.rejectedDuplicate,
      rejectedFollowers: stats.rejectedFollowers,
      rejectedRateLimit: stats.rejectedRateLimit,
      reasons: stats.reasons,
      eligibleFound: eligible !== null,
      eligibleTweetId: eligible?.id ?? null,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheHitRate: `${cacheHitRate}%`,
    });
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
    this.client = null;
    this.clientInitialized = false;
  }
}
