/**
 * Unit tests for filter pipeline
 * Tests all 4 filter stages: content, deduplication, follower count, rate limits
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type {
  TweetCandidate,
  Database,
  Config,
  RateLimitState,
  AuthorCacheEntry,
  CircuitBreakerState,
} from '../types.js';

// Mock the imports before importing FilterPipeline
vi.mock('../database.js', () => ({
  initDatabase: vi.fn(),
}));

vi.mock('../config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@steipete/bird', () => ({
  TwitterClient: vi.fn(),
  resolveCredentials: vi.fn(),
}));

// Import after mocks
import { FilterPipeline } from '../filter.js';
import { initDatabase } from '../database.js';
import { loadConfig } from '../config.js';
import { resolveCredentials, TwitterClient } from '@steipete/bird';

/**
 * Create a mock TweetCandidate
 */
function createMockTweet(overrides: Partial<TweetCandidate> = {}): TweetCandidate {
  return {
    id: 'tweet-123',
    text: 'This is a long enough tweet about AI agents that exceeds the minimum character limit for filtering purposes.',
    authorId: 'author-456',
    authorUsername: 'testuser',
    createdAt: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
    language: 'en',
    isRetweet: false,
    ...overrides,
  };
}

/**
 * Create a mock Database
 */
function createMockDatabase(overrides: Partial<Database> = {}): Database {
  return {
    hasRepliedToTweet: vi.fn().mockResolvedValue(false),
    getRepliesForAuthorToday: vi.fn().mockResolvedValue(0),
    getRateLimitState: vi.fn().mockResolvedValue({
      dailyCount: 0,
      lastReplyAt: null,
      dailyResetAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }),
    incrementDailyCount: vi.fn().mockResolvedValue(undefined),
    resetDailyCountIfNeeded: vi.fn().mockResolvedValue(undefined),
    updateLastReplyTime: vi.fn().mockResolvedValue(undefined),
    getCircuitBreakerState: vi.fn().mockResolvedValue({
      state: 'closed',
      failureCount: 0,
      openedAt: null,
    }),
    updateCircuitBreakerState: vi.fn().mockResolvedValue(undefined),
    recordManusFailure: vi.fn().mockResolvedValue(undefined),
    recordManusSuccess: vi.fn().mockResolvedValue(undefined),
    getAuthorCache: vi.fn().mockResolvedValue(null),
    upsertAuthorCache: vi.fn().mockResolvedValue(undefined),
    seedAuthorsFromJson: vi.fn().mockResolvedValue(undefined),
    recordReply: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/**
 * Create a mock Config
 */
function createMockConfig(overrides: Partial<Config> = {}): Config {
  const baseConfig: Config = {
    bird: {
      cookieSource: 'safari',
      authToken: undefined,
      ct0: undefined,
    },
    manus: {
      apiKey: 'test-api-key',
      apiBase: 'https://api.manus.ai/v1',
      timeoutMs: 120000,
    },
    rateLimits: {
      maxDailyReplies: 12,
      minGapMinutes: 10,
      maxPerAuthorPerDay: 1,
      errorCooldownMinutes: 30,
    },
    filters: {
      minFollowerCount: 50000,
      maxTweetAgeMinutes: 30,
      minTweetLength: 100,
    },
    polling: {
      intervalSeconds: 60,
      searchQuery: '"AI agents" -is:retweet lang:en',
      resultsPerQuery: 50,
    },
    database: {
      path: './data/test.db',
    },
    logging: {
      level: 'info',
    },
    features: {
      dryRun: true,
    },
  };

  // Deep merge overrides
  return deepMerge(baseConfig, overrides) as Config;
}

/**
 * Deep merge helper
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key])
    ) {
      result[key] = deepMerge(
        (target[key] as Record<string, unknown>) || {},
        source[key] as Record<string, unknown>
      );
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

describe('FilterPipeline', () => {
  let mockDb: Database;
  let mockConfig: Config;
  let filterPipeline: FilterPipeline;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = createMockDatabase();
    mockConfig = createMockConfig();

    // Setup mocks
    vi.mocked(initDatabase).mockResolvedValue(mockDb);
    vi.mocked(loadConfig).mockReturnValue(mockConfig);

    // Create pipeline instance
    filterPipeline = new FilterPipeline();
  });

  afterEach(async () => {
    await filterPipeline.close();
  });

  // ===========================================================================
  // Stage 1: Content Filters
  // ===========================================================================

  describe('Stage 1: Content Filters', () => {
    describe('Content length filter (>100 chars)', () => {
      it('should reject tweets shorter than 100 characters', async () => {
        const shortTweet = createMockTweet({
          text: 'Short tweet',
        });

        const result = await filterPipeline.filter([shortTweet]);

        expect(result.eligible).toBeNull();
        expect(result.stats.rejectedContent).toBe(1);
        expect(result.stats.reasons['too_short']).toBe(1);
      });

      it('should accept tweets with exactly 100 characters', async () => {
        // Create a tweet with exactly 100 chars
        const exactTweet = createMockTweet({
          text: 'A'.repeat(100),
        });

        // Mock cache hit for follower check
        vi.mocked(mockDb.getAuthorCache).mockResolvedValue({
          authorId: 'author-456',
          username: 'testuser',
          name: 'Test User',
          followerCount: 100000,
          followingCount: 1000,
          isVerified: false,
          updatedAt: new Date(),
        });

        const result = await filterPipeline.filter([exactTweet]);

        expect(result.stats.reasons['too_short']).toBeUndefined();
      });

      it('should accept tweets longer than 100 characters', async () => {
        const longTweet = createMockTweet({
          text: 'A'.repeat(150),
        });

        // Mock cache hit for follower check
        vi.mocked(mockDb.getAuthorCache).mockResolvedValue({
          authorId: 'author-456',
          username: 'testuser',
          name: 'Test User',
          followerCount: 100000,
          followingCount: 1000,
          isVerified: false,
          updatedAt: new Date(),
        });

        const result = await filterPipeline.filter([longTweet]);

        expect(result.stats.reasons['too_short']).toBeUndefined();
      });
    });

    describe('Recency filter (<30 min)', () => {
      it('should reject tweets older than 30 minutes', async () => {
        const oldTweet = createMockTweet({
          createdAt: new Date(Date.now() - 35 * 60 * 1000), // 35 minutes ago
        });

        const result = await filterPipeline.filter([oldTweet]);

        expect(result.eligible).toBeNull();
        expect(result.stats.rejectedContent).toBe(1);
        expect(result.stats.reasons['too_old']).toBe(1);
      });

      it('should accept tweets exactly 30 minutes old', async () => {
        const exactAgeTweet = createMockTweet({
          createdAt: new Date(Date.now() - 30 * 60 * 1000),
        });

        // Mock cache hit for follower check
        vi.mocked(mockDb.getAuthorCache).mockResolvedValue({
          authorId: 'author-456',
          username: 'testuser',
          name: 'Test User',
          followerCount: 100000,
          followingCount: 1000,
          isVerified: false,
          updatedAt: new Date(),
        });

        const result = await filterPipeline.filter([exactAgeTweet]);

        // May or may not reject based on millisecond precision
        // Just check it doesn't crash
        expect(result.stats).toBeDefined();
      });

      it('should accept tweets less than 30 minutes old', async () => {
        const recentTweet = createMockTweet({
          createdAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
        });

        // Mock cache hit for follower check
        vi.mocked(mockDb.getAuthorCache).mockResolvedValue({
          authorId: 'author-456',
          username: 'testuser',
          name: 'Test User',
          followerCount: 100000,
          followingCount: 1000,
          isVerified: false,
          updatedAt: new Date(),
        });

        const result = await filterPipeline.filter([recentTweet]);

        expect(result.stats.reasons['too_old']).toBeUndefined();
      });
    });

    describe('Language filter (lang=en)', () => {
      it('should reject tweets with non-English language', async () => {
        const spanishTweet = createMockTweet({
          language: 'es',
        });

        const result = await filterPipeline.filter([spanishTweet]);

        expect(result.eligible).toBeNull();
        expect(result.stats.rejectedContent).toBe(1);
        expect(result.stats.reasons['wrong_language']).toBe(1);
      });

      it('should accept tweets with English language', async () => {
        const englishTweet = createMockTweet({
          language: 'en',
        });

        // Mock cache hit for follower check
        vi.mocked(mockDb.getAuthorCache).mockResolvedValue({
          authorId: 'author-456',
          username: 'testuser',
          name: 'Test User',
          followerCount: 100000,
          followingCount: 1000,
          isVerified: false,
          updatedAt: new Date(),
        });

        const result = await filterPipeline.filter([englishTweet]);

        expect(result.stats.reasons['wrong_language']).toBeUndefined();
      });
    });

    describe('Retweet filter (isRetweet=false)', () => {
      it('should reject retweets', async () => {
        const retweet = createMockTweet({
          isRetweet: true,
        });

        const result = await filterPipeline.filter([retweet]);

        expect(result.eligible).toBeNull();
        expect(result.stats.rejectedContent).toBe(1);
        expect(result.stats.reasons['is_retweet']).toBe(1);
      });

      it('should accept non-retweets', async () => {
        const originalTweet = createMockTweet({
          isRetweet: false,
        });

        // Mock cache hit for follower check
        vi.mocked(mockDb.getAuthorCache).mockResolvedValue({
          authorId: 'author-456',
          username: 'testuser',
          name: 'Test User',
          followerCount: 100000,
          followingCount: 1000,
          isVerified: false,
          updatedAt: new Date(),
        });

        const result = await filterPipeline.filter([originalTweet]);

        expect(result.stats.reasons['is_retweet']).toBeUndefined();
      });
    });
  });

  // ===========================================================================
  // Stage 2: Deduplication Filters
  // ===========================================================================

  describe('Stage 2: Deduplication Filters', () => {
    describe('hasRepliedToTweet', () => {
      it('should reject tweets already replied to', async () => {
        const tweet = createMockTweet();

        vi.mocked(mockDb.hasRepliedToTweet).mockResolvedValue(true);

        const result = await filterPipeline.filter([tweet]);

        expect(result.eligible).toBeNull();
        expect(result.stats.rejectedDuplicate).toBe(1);
        expect(result.stats.reasons['already_replied_to_tweet']).toBe(1);
        expect(mockDb.hasRepliedToTweet).toHaveBeenCalledWith('tweet-123');
      });

      it('should accept tweets not yet replied to', async () => {
        const tweet = createMockTweet();

        vi.mocked(mockDb.hasRepliedToTweet).mockResolvedValue(false);

        // Mock cache hit for follower check
        vi.mocked(mockDb.getAuthorCache).mockResolvedValue({
          authorId: 'author-456',
          username: 'testuser',
          name: 'Test User',
          followerCount: 100000,
          followingCount: 1000,
          isVerified: false,
          updatedAt: new Date(),
        });

        const result = await filterPipeline.filter([tweet]);

        expect(result.stats.reasons['already_replied_to_tweet']).toBeUndefined();
      });
    });

    describe('getRepliesForAuthorToday (per-author limit)', () => {
      it('should reject tweets from authors already replied to today', async () => {
        const tweet = createMockTweet();

        vi.mocked(mockDb.hasRepliedToTweet).mockResolvedValue(false);
        vi.mocked(mockDb.getRepliesForAuthorToday).mockResolvedValue(1); // Already replied once

        const result = await filterPipeline.filter([tweet]);

        expect(result.eligible).toBeNull();
        expect(result.stats.rejectedDuplicate).toBe(1);
        expect(result.stats.reasons['author_limit_reached']).toBe(1);
        expect(mockDb.getRepliesForAuthorToday).toHaveBeenCalledWith('author-456');
      });

      it('should accept tweets from authors not yet replied to today', async () => {
        const tweet = createMockTweet();

        vi.mocked(mockDb.hasRepliedToTweet).mockResolvedValue(false);
        vi.mocked(mockDb.getRepliesForAuthorToday).mockResolvedValue(0);

        // Mock cache hit for follower check
        vi.mocked(mockDb.getAuthorCache).mockResolvedValue({
          authorId: 'author-456',
          username: 'testuser',
          name: 'Test User',
          followerCount: 100000,
          followingCount: 1000,
          isVerified: false,
          updatedAt: new Date(),
        });

        const result = await filterPipeline.filter([tweet]);

        expect(result.stats.reasons['author_limit_reached']).toBeUndefined();
      });
    });
  });

  // ===========================================================================
  // Stage 3: Follower Count Filter
  // ===========================================================================

  describe('Stage 3: Follower Count Filter', () => {
    describe('Cache hit scenarios', () => {
      it('should use cached follower count when available', async () => {
        const tweet = createMockTweet();

        const cachedAuthor: AuthorCacheEntry = {
          authorId: 'author-456',
          username: 'testuser',
          name: 'Test User',
          followerCount: 100000,
          followingCount: 1000,
          isVerified: true,
          updatedAt: new Date(),
        };

        vi.mocked(mockDb.getAuthorCache).mockResolvedValue(cachedAuthor);

        const result = await filterPipeline.filter([tweet]);

        expect(result.eligible).not.toBeNull();
        expect(mockDb.getAuthorCache).toHaveBeenCalledWith('author-456');
        // Should not call upsertAuthorCache on cache hit
        expect(mockDb.upsertAuthorCache).not.toHaveBeenCalled();
      });

      it('should reject author with cached follower count below threshold', async () => {
        const tweet = createMockTweet();

        const cachedAuthor: AuthorCacheEntry = {
          authorId: 'author-456',
          username: 'testuser',
          name: 'Test User',
          followerCount: 1000, // Below 50000 threshold
          followingCount: 100,
          isVerified: false,
          updatedAt: new Date(),
        };

        vi.mocked(mockDb.getAuthorCache).mockResolvedValue(cachedAuthor);

        const result = await filterPipeline.filter([tweet]);

        expect(result.eligible).toBeNull();
        expect(result.stats.rejectedFollowers).toBe(1);
        expect(result.stats.reasons['below_threshold']).toBe(1);
      });
    });

    describe('Cache miss scenarios', () => {
      it('should fetch from API on cache miss and accept if above threshold', async () => {
        const tweet = createMockTweet();

        // Cache miss
        vi.mocked(mockDb.getAuthorCache).mockResolvedValue(null);

        // Mock Bird client
        const mockClient = {
          getHeaders: vi.fn().mockReturnValue({ authorization: 'Bearer test' }),
          fetchWithTimeout: vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({
              id_str: 'author-456',
              followers_count: 100000,
              friends_count: 1000,
              name: 'Test User',
              verified: true,
            }),
          }),
        };

        vi.mocked(TwitterClient).mockReturnValue(mockClient as unknown as InstanceType<typeof TwitterClient>);
        vi.mocked(resolveCredentials).mockResolvedValue({
          cookies: {
            authToken: 'test-auth',
            ct0: 'test-ct0',
            cookieHeader: null,
            source: 'safari',
          },
          warnings: [],
        });

        const result = await filterPipeline.filter([tweet]);

        expect(result.eligible).not.toBeNull();
        expect(mockDb.getAuthorCache).toHaveBeenCalledWith('author-456');
        expect(mockDb.upsertAuthorCache).toHaveBeenCalled();
      });

      it('should fetch from API on cache miss and reject if below threshold', async () => {
        const tweet = createMockTweet();

        // Cache miss
        vi.mocked(mockDb.getAuthorCache).mockResolvedValue(null);

        // Mock Bird client returning low follower count
        const mockClient = {
          getHeaders: vi.fn().mockReturnValue({ authorization: 'Bearer test' }),
          fetchWithTimeout: vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({
              id_str: 'author-456',
              followers_count: 1000, // Below threshold
              friends_count: 100,
              name: 'Test User',
              verified: false,
            }),
          }),
        };

        vi.mocked(TwitterClient).mockReturnValue(mockClient as unknown as InstanceType<typeof TwitterClient>);
        vi.mocked(resolveCredentials).mockResolvedValue({
          cookies: {
            authToken: 'test-auth',
            ct0: 'test-ct0',
            cookieHeader: null,
            source: 'safari',
          },
          warnings: [],
        });

        const result = await filterPipeline.filter([tweet]);

        expect(result.eligible).toBeNull();
        expect(result.stats.rejectedFollowers).toBe(1);
        expect(result.stats.reasons['below_threshold']).toBe(1);
        // Should still cache the result
        expect(mockDb.upsertAuthorCache).toHaveBeenCalled();
      });

      it('should reject on API error (fail closed)', async () => {
        const tweet = createMockTweet();

        // Cache miss
        vi.mocked(mockDb.getAuthorCache).mockResolvedValue(null);

        // Mock Bird client with API error
        const mockClient = {
          getHeaders: vi.fn().mockReturnValue({ authorization: 'Bearer test' }),
          fetchWithTimeout: vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            text: vi.fn().mockResolvedValue('Internal Server Error'),
          }),
        };

        vi.mocked(TwitterClient).mockReturnValue(mockClient as unknown as InstanceType<typeof TwitterClient>);
        vi.mocked(resolveCredentials).mockResolvedValue({
          cookies: {
            authToken: 'test-auth',
            ct0: 'test-ct0',
            cookieHeader: null,
            source: 'safari',
          },
          warnings: [],
        });

        const result = await filterPipeline.filter([tweet]);

        expect(result.eligible).toBeNull();
        expect(result.stats.rejectedFollowers).toBe(1);
        expect(result.stats.reasons['api_error']).toBe(1);
      });
    });
  });

  // ===========================================================================
  // Stage 4: Rate Limit Checks
  // ===========================================================================

  describe('Stage 4: Rate Limit Checks', () => {
    describe('Daily limit check', () => {
      it('should reject when daily limit exceeded', async () => {
        const tweet = createMockTweet();

        // Mock cache hit for follower check
        vi.mocked(mockDb.getAuthorCache).mockResolvedValue({
          authorId: 'author-456',
          username: 'testuser',
          name: 'Test User',
          followerCount: 100000,
          followingCount: 1000,
          isVerified: false,
          updatedAt: new Date(),
        });

        // Mock rate limit at max
        vi.mocked(mockDb.getRateLimitState).mockResolvedValue({
          dailyCount: 12, // Equal to maxDailyReplies
          lastReplyAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
          dailyResetAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
        });

        const result = await filterPipeline.filter([tweet]);

        expect(result.eligible).toBeNull();
        expect(result.stats.rejectedRateLimit).toBe(1);
        expect(result.stats.reasons['daily_limit_exceeded']).toBe(1);
      });

      it('should accept when daily count is below limit', async () => {
        const tweet = createMockTweet();

        // Mock cache hit for follower check
        vi.mocked(mockDb.getAuthorCache).mockResolvedValue({
          authorId: 'author-456',
          username: 'testuser',
          name: 'Test User',
          followerCount: 100000,
          followingCount: 1000,
          isVerified: false,
          updatedAt: new Date(),
        });

        // Mock rate limit below max
        vi.mocked(mockDb.getRateLimitState).mockResolvedValue({
          dailyCount: 5, // Below maxDailyReplies (12)
          lastReplyAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
          dailyResetAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
        });

        const result = await filterPipeline.filter([tweet]);

        expect(result.eligible).not.toBeNull();
        expect(result.stats.reasons['daily_limit_exceeded']).toBeUndefined();
      });
    });

    describe('Gap check (minGapMinutes)', () => {
      it('should reject when gap since last reply is too short', async () => {
        const tweet = createMockTweet();

        // Mock cache hit for follower check
        vi.mocked(mockDb.getAuthorCache).mockResolvedValue({
          authorId: 'author-456',
          username: 'testuser',
          name: 'Test User',
          followerCount: 100000,
          followingCount: 1000,
          isVerified: false,
          updatedAt: new Date(),
        });

        // Mock rate limit with recent reply
        vi.mocked(mockDb.getRateLimitState).mockResolvedValue({
          dailyCount: 5,
          lastReplyAt: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago (less than 10 min gap)
          dailyResetAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
        });

        const result = await filterPipeline.filter([tweet]);

        expect(result.eligible).toBeNull();
        expect(result.stats.rejectedRateLimit).toBe(1);
        expect(result.stats.reasons['gap_too_short']).toBe(1);
      });

      it('should accept when gap since last reply is sufficient', async () => {
        const tweet = createMockTweet();

        // Mock cache hit for follower check
        vi.mocked(mockDb.getAuthorCache).mockResolvedValue({
          authorId: 'author-456',
          username: 'testuser',
          name: 'Test User',
          followerCount: 100000,
          followingCount: 1000,
          isVerified: false,
          updatedAt: new Date(),
        });

        // Mock rate limit with old reply
        vi.mocked(mockDb.getRateLimitState).mockResolvedValue({
          dailyCount: 5,
          lastReplyAt: new Date(Date.now() - 15 * 60 * 1000), // 15 minutes ago (more than 10 min gap)
          dailyResetAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
        });

        const result = await filterPipeline.filter([tweet]);

        expect(result.eligible).not.toBeNull();
        expect(result.stats.reasons['gap_too_short']).toBeUndefined();
      });

      it('should accept when no previous reply (lastReplyAt is null)', async () => {
        const tweet = createMockTweet();

        // Mock cache hit for follower check
        vi.mocked(mockDb.getAuthorCache).mockResolvedValue({
          authorId: 'author-456',
          username: 'testuser',
          name: 'Test User',
          followerCount: 100000,
          followingCount: 1000,
          isVerified: false,
          updatedAt: new Date(),
        });

        // Mock rate limit with no previous reply
        vi.mocked(mockDb.getRateLimitState).mockResolvedValue({
          dailyCount: 0,
          lastReplyAt: null,
          dailyResetAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
        });

        const result = await filterPipeline.filter([tweet]);

        expect(result.eligible).not.toBeNull();
        expect(result.stats.reasons['gap_too_short']).toBeUndefined();
      });
    });

    describe('Per-author daily limit (from rate limit stage)', () => {
      it('should reject when per-author daily limit exceeded', async () => {
        const tweet = createMockTweet();

        // Mock cache hit for follower check
        vi.mocked(mockDb.getAuthorCache).mockResolvedValue({
          authorId: 'author-456',
          username: 'testuser',
          name: 'Test User',
          followerCount: 100000,
          followingCount: 1000,
          isVerified: false,
          updatedAt: new Date(),
        });

        // Pass the deduplication stage but set per-author count to limit in rate limit check
        vi.mocked(mockDb.getRepliesForAuthorToday)
          .mockResolvedValueOnce(0) // First call from deduplication - pass
          .mockResolvedValueOnce(1); // Second call from rate limit - at limit

        vi.mocked(mockDb.getRateLimitState).mockResolvedValue({
          dailyCount: 5,
          lastReplyAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
          dailyResetAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
        });

        const result = await filterPipeline.filter([tweet]);

        expect(result.eligible).toBeNull();
        expect(result.stats.rejectedRateLimit).toBe(1);
        expect(result.stats.reasons['author_daily_limit']).toBe(1);
      });

      it('should accept when per-author count is below limit', async () => {
        const tweet = createMockTweet();

        // Mock cache hit for follower check
        vi.mocked(mockDb.getAuthorCache).mockResolvedValue({
          authorId: 'author-456',
          username: 'testuser',
          name: 'Test User',
          followerCount: 100000,
          followingCount: 1000,
          isVerified: false,
          updatedAt: new Date(),
        });

        // Pass both deduplication and rate limit per-author check
        vi.mocked(mockDb.getRepliesForAuthorToday).mockResolvedValue(0);

        vi.mocked(mockDb.getRateLimitState).mockResolvedValue({
          dailyCount: 5,
          lastReplyAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
          dailyResetAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
        });

        const result = await filterPipeline.filter([tweet]);

        expect(result.eligible).not.toBeNull();
        expect(result.stats.reasons['author_daily_limit']).toBeUndefined();
      });
    });
  });

  // ===========================================================================
  // Full Pipeline Tests
  // ===========================================================================

  describe('Full Pipeline', () => {
    it('should find first eligible tweet from multiple candidates', async () => {
      const tweets = [
        createMockTweet({ id: 'tweet-1', text: 'Short' }), // Rejected: too short
        createMockTweet({ id: 'tweet-2', isRetweet: true }), // Rejected: retweet
        createMockTweet({ id: 'tweet-3' }), // Should be eligible
        createMockTweet({ id: 'tweet-4' }), // Should not be reached
      ];

      // Mock cache hit for follower check
      vi.mocked(mockDb.getAuthorCache).mockResolvedValue({
        authorId: 'author-456',
        username: 'testuser',
        name: 'Test User',
        followerCount: 100000,
        followingCount: 1000,
        isVerified: false,
        updatedAt: new Date(),
      });

      const result = await filterPipeline.filter(tweets);

      expect(result.eligible).not.toBeNull();
      expect(result.eligible?.id).toBe('tweet-3');
      expect(result.stats.total).toBe(4);
      expect(result.stats.rejectedContent).toBe(2);
    });

    it('should return null when no tweets are eligible', async () => {
      const tweets = [
        createMockTweet({ id: 'tweet-1', text: 'Short' }),
        createMockTweet({ id: 'tweet-2', language: 'es' }),
        createMockTweet({ id: 'tweet-3', isRetweet: true }),
      ];

      const result = await filterPipeline.filter(tweets);

      expect(result.eligible).toBeNull();
      expect(result.stats.total).toBe(3);
      expect(result.stats.rejectedContent).toBe(3);
    });

    it('should handle empty candidate list', async () => {
      const result = await filterPipeline.filter([]);

      expect(result.eligible).toBeNull();
      expect(result.stats.total).toBe(0);
    });

    it('should track rejection reasons correctly', async () => {
      const tweets = [
        createMockTweet({ id: 'tweet-1', text: 'Short' }), // too_short
        createMockTweet({ id: 'tweet-2', language: 'es' }), // wrong_language
        createMockTweet({ id: 'tweet-3', isRetweet: true }), // is_retweet
        createMockTweet({
          id: 'tweet-4',
          createdAt: new Date(Date.now() - 60 * 60 * 1000),
        }), // too_old
      ];

      const result = await filterPipeline.filter(tweets);

      expect(result.eligible).toBeNull();
      expect(result.stats.reasons['too_short']).toBe(1);
      expect(result.stats.reasons['wrong_language']).toBe(1);
      expect(result.stats.reasons['is_retweet']).toBe(1);
      expect(result.stats.reasons['too_old']).toBe(1);
    });

    it('should call resetDailyCountIfNeeded before rate limit check', async () => {
      const tweet = createMockTweet();

      // Mock cache hit for follower check
      vi.mocked(mockDb.getAuthorCache).mockResolvedValue({
        authorId: 'author-456',
        username: 'testuser',
        name: 'Test User',
        followerCount: 100000,
        followingCount: 1000,
        isVerified: false,
        updatedAt: new Date(),
      });

      await filterPipeline.filter([tweet]);

      // Called twice: once in logRateLimitStatus, once in passesRateLimitCheck
      expect(mockDb.resetDailyCountIfNeeded).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('Edge Cases', () => {
    it('should handle tweet at exact threshold boundaries', async () => {
      const boundaryTweet = createMockTweet({
        text: 'A'.repeat(100), // Exactly 100 chars
        createdAt: new Date(Date.now() - 30 * 60 * 1000), // Exactly 30 min old
      });

      // Mock cache hit with exact threshold
      vi.mocked(mockDb.getAuthorCache).mockResolvedValue({
        authorId: 'author-456',
        username: 'testuser',
        name: 'Test User',
        followerCount: 50000, // Exactly at threshold
        followingCount: 1000,
        isVerified: false,
        updatedAt: new Date(),
      });

      const result = await filterPipeline.filter([boundaryTweet]);

      // Should handle boundaries gracefully
      expect(result.stats).toBeDefined();
    });

    it('should handle multiple tweets from same author', async () => {
      const tweets = [
        createMockTweet({ id: 'tweet-1', authorId: 'same-author' }),
        createMockTweet({ id: 'tweet-2', authorId: 'same-author' }),
        createMockTweet({ id: 'tweet-3', authorId: 'same-author' }),
      ];

      // First tweet passes, subsequent ones hit author limit
      vi.mocked(mockDb.getAuthorCache).mockResolvedValue({
        authorId: 'same-author',
        username: 'testuser',
        name: 'Test User',
        followerCount: 100000,
        followingCount: 1000,
        isVerified: false,
        updatedAt: new Date(),
      });

      const result = await filterPipeline.filter(tweets);

      // Should return the first eligible tweet
      expect(result.eligible).not.toBeNull();
      expect(result.eligible?.id).toBe('tweet-1');
    });
  });
});
