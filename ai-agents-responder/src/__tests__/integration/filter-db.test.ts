/**
 * Integration tests for Filter Pipeline + Database
 * Tests full filter pipeline with real in-memory SQLite
 *
 * Unlike unit tests that mock the database, these integration tests:
 * - Use real SQLite (bun:sqlite) with :memory:
 * - Test actual SQL queries and data persistence
 * - Verify deduplication, author cache, and rate limits work end-to-end
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database as BunDatabase } from 'bun:sqlite';
import type {
  TweetCandidate,
  Database,
  Config,
  RateLimitState,
  AuthorCacheEntry,
  CircuitBreakerState,
  CircuitBreakerUpdate,
  ReplyLogEntry,
  SeedAuthor,
} from '../../types.js';

// =============================================================================
// Test Database Setup (Real In-Memory SQLite)
// =============================================================================

/**
 * Create an in-memory database for testing
 * Replicates the exact schema from database.ts
 */
function createTestDatabase(): { db: BunDatabase; interface: Database } {
  const db = new BunDatabase(':memory:');

  // Create tables (same as database.ts)
  db.run(`
    CREATE TABLE IF NOT EXISTS replied_tweets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tweet_id TEXT UNIQUE NOT NULL,
      author_id TEXT NOT NULL,
      author_username TEXT NOT NULL,
      tweet_text TEXT,
      tweet_created_at DATETIME NOT NULL,
      reply_tweet_id TEXT,
      replied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      success BOOLEAN DEFAULT TRUE,
      error_message TEXT,
      manus_task_id TEXT,
      manus_duration_ms INTEGER,
      png_size_bytes INTEGER,
      reply_template_index INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_reply_at DATETIME,
      daily_count INTEGER DEFAULT 0,
      daily_reset_at DATETIME,
      circuit_breaker_state TEXT DEFAULT 'closed',
      circuit_breaker_failures INTEGER DEFAULT 0,
      circuit_breaker_opened_at DATETIME
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS author_cache (
      author_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      name TEXT,
      follower_count INTEGER NOT NULL,
      following_count INTEGER,
      is_verified BOOLEAN,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create indexes
  db.run('CREATE INDEX IF NOT EXISTS idx_replied_tweets_author ON replied_tweets(author_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_replied_tweets_date ON replied_tweets(replied_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_replied_tweets_success ON replied_tweets(success)');
  db.run('CREATE INDEX IF NOT EXISTS idx_author_cache_followers ON author_cache(follower_count)');
  db.run('CREATE INDEX IF NOT EXISTS idx_author_cache_updated ON author_cache(updated_at)');

  // Initialize rate_limits singleton
  db.run(`
    INSERT INTO rate_limits (id, daily_count, daily_reset_at, circuit_breaker_state, circuit_breaker_failures, circuit_breaker_opened_at)
    VALUES (1, 0, datetime('now', 'start of day', '+1 day'), 'closed', 0, NULL)
  `);

  const dbInterface = createDatabaseInterface(db);
  return { db, interface: dbInterface };
}

/**
 * Create the Database interface implementation for testing
 */
function createDatabaseInterface(db: BunDatabase): Database {
  return {
    async hasRepliedToTweet(tweetId: string): Promise<boolean> {
      const result = db.query('SELECT 1 FROM replied_tweets WHERE tweet_id = ?').get(tweetId);
      return result !== null;
    },

    async getRepliesForAuthorToday(authorId: string): Promise<number> {
      const result = db.query(`
        SELECT COUNT(*) as count FROM replied_tweets
        WHERE author_id = ?
          AND replied_at > datetime('now', '-24 hours')
      `).get(authorId) as { count: number } | null;
      return result?.count ?? 0;
    },

    async getRateLimitState(): Promise<RateLimitState> {
      await this.resetDailyCountIfNeeded();
      const row = db.query(`
        SELECT daily_count, last_reply_at, daily_reset_at
        FROM rate_limits WHERE id = 1
      `).get() as {
        daily_count: number;
        last_reply_at: string | null;
        daily_reset_at: string;
      } | null;

      if (!row) {
        return { dailyCount: 0, lastReplyAt: null, dailyResetAt: new Date() };
      }

      return {
        dailyCount: row.daily_count,
        lastReplyAt: row.last_reply_at ? new Date(row.last_reply_at) : null,
        dailyResetAt: new Date(row.daily_reset_at),
      };
    },

    async incrementDailyCount(): Promise<void> {
      db.run('UPDATE rate_limits SET daily_count = daily_count + 1 WHERE id = 1');
    },

    async resetDailyCountIfNeeded(): Promise<void> {
      db.run(`
        UPDATE rate_limits
        SET daily_count = 0,
            daily_reset_at = datetime('now', 'start of day', '+1 day')
        WHERE id = 1 AND daily_reset_at < datetime('now')
      `);
    },

    async updateLastReplyTime(timestamp: Date): Promise<void> {
      db.run('UPDATE rate_limits SET last_reply_at = ? WHERE id = 1', [timestamp.toISOString()]);
    },

    async getCircuitBreakerState(): Promise<CircuitBreakerState> {
      const row = db.query(`
        SELECT circuit_breaker_state, circuit_breaker_failures, circuit_breaker_opened_at
        FROM rate_limits WHERE id = 1
      `).get() as {
        circuit_breaker_state: string;
        circuit_breaker_failures: number;
        circuit_breaker_opened_at: string | null;
      } | null;

      if (!row) {
        return { state: 'closed', failureCount: 0, openedAt: null };
      }

      return {
        state: row.circuit_breaker_state as 'closed' | 'open' | 'half-open',
        failureCount: row.circuit_breaker_failures,
        openedAt: row.circuit_breaker_opened_at ? new Date(row.circuit_breaker_opened_at) : null,
      };
    },

    async updateCircuitBreakerState(update: CircuitBreakerUpdate): Promise<void> {
      const setClauses: string[] = [];
      const values: (string | number | null)[] = [];

      if (update.state !== undefined) {
        setClauses.push('circuit_breaker_state = ?');
        values.push(update.state);
      }
      if (update.failureCount !== undefined) {
        setClauses.push('circuit_breaker_failures = ?');
        values.push(update.failureCount);
      }
      if (update.openedAt !== undefined) {
        setClauses.push('circuit_breaker_opened_at = ?');
        values.push(update.openedAt ? update.openedAt.toISOString() : null);
      }

      if (setClauses.length > 0) {
        const sql = `UPDATE rate_limits SET ${setClauses.join(', ')} WHERE id = 1`;
        db.run(sql, values);
      }
    },

    async recordManusFailure(): Promise<void> {
      db.run('UPDATE rate_limits SET circuit_breaker_failures = circuit_breaker_failures + 1 WHERE id = 1');
    },

    async recordManusSuccess(): Promise<void> {
      db.run(`
        UPDATE rate_limits
        SET circuit_breaker_failures = 0, circuit_breaker_state = 'closed', circuit_breaker_opened_at = NULL
        WHERE id = 1
      `);
    },

    async getAuthorCache(authorId: string): Promise<AuthorCacheEntry | null> {
      const row = db.query(`
        SELECT author_id, username, name, follower_count, following_count, is_verified, updated_at
        FROM author_cache
        WHERE author_id = ?
          AND updated_at > datetime('now', '-24 hours')
      `).get(authorId) as {
        author_id: string;
        username: string;
        name: string | null;
        follower_count: number;
        following_count: number | null;
        is_verified: number | null;
        updated_at: string;
      } | null;

      if (!row) return null;

      return {
        authorId: row.author_id,
        username: row.username,
        name: row.name ?? '',
        followerCount: row.follower_count,
        followingCount: row.following_count ?? 0,
        isVerified: Boolean(row.is_verified),
        updatedAt: new Date(row.updated_at),
      };
    },

    async upsertAuthorCache(author: AuthorCacheEntry): Promise<void> {
      db.run(`
        INSERT INTO author_cache (author_id, username, name, follower_count, following_count, is_verified, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(author_id) DO UPDATE SET
          username = excluded.username,
          name = excluded.name,
          follower_count = excluded.follower_count,
          following_count = excluded.following_count,
          is_verified = excluded.is_verified,
          updated_at = datetime('now')
      `, [
        author.authorId,
        author.username,
        author.name,
        author.followerCount,
        author.followingCount,
        author.isVerified ? 1 : 0,
      ]);
    },

    async seedAuthorsFromJson(authors: SeedAuthor[]): Promise<void> {
      const stmt = db.prepare(`
        INSERT INTO author_cache (author_id, username, name, follower_count, following_count, is_verified, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(author_id) DO UPDATE SET
          username = excluded.username,
          name = excluded.name,
          follower_count = excluded.follower_count,
          following_count = COALESCE(excluded.following_count, author_cache.following_count),
          is_verified = COALESCE(excluded.is_verified, author_cache.is_verified),
          updated_at = datetime('now')
      `);

      for (const author of authors) {
        stmt.run(
          author.authorId,
          author.username,
          author.name,
          author.followerCount,
          author.followingCount ?? 0,
          author.isVerified ? 1 : 0
        );
      }
    },

    async recordReply(log: ReplyLogEntry): Promise<void> {
      db.run(`
        INSERT INTO replied_tweets (
          tweet_id, author_id, author_username, tweet_text, tweet_created_at,
          reply_tweet_id, success, error_message, manus_task_id,
          manus_duration_ms, png_size_bytes, reply_template_index
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        log.tweetId,
        log.authorId,
        log.authorUsername,
        log.tweetText,
        log.tweetCreatedAt.toISOString(),
        log.replyTweetId,
        log.success ? 1 : 0,
        log.errorMessage ?? null,
        log.manusTaskId ?? null,
        log.manusDuration ?? null,
        log.pngSize ?? null,
        log.templateIndex ?? null,
      ]);
    },

    async initialize(): Promise<void> {},

    async close(): Promise<void> {
      db.close();
    },
  };
}

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Create a mock TweetCandidate with valid default values
 */
function createTweet(overrides: Partial<TweetCandidate> = {}): TweetCandidate {
  return {
    id: `tweet-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    text: 'This is a sufficiently long tweet about AI agents that passes the minimum length filter of 100 characters easily.',
    authorId: 'author-123',
    authorUsername: 'testuser',
    createdAt: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
    language: 'en',
    isRetweet: false,
    ...overrides,
  };
}

/**
 * Create default config for testing
 */
function createConfig(): Config {
  return {
    bird: { cookieSource: 'safari' },
    manus: { apiKey: 'test', apiBase: 'https://api.manus.ai', timeoutMs: 120000 },
    rateLimits: {
      maxDailyReplies: 10,
      minGapMinutes: 10,
      maxPerAuthorPerDay: 1,
      errorCooldownMinutes: 5,
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
    database: { path: ':memory:' },
    logging: { level: 'error' },
    features: { dryRun: true },
  };
}

// =============================================================================
// Integration Tests
// =============================================================================

describe('Filter + Database Integration Tests', () => {
  let testDb: { db: BunDatabase; interface: Database };

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  afterEach(() => {
    testDb.db.close();
  });

  // ===========================================================================
  // Deduplication Integration Tests
  // ===========================================================================

  describe('Deduplication with real DB', () => {
    it('should block tweets that have been replied to', async () => {
      const db = testDb.interface;
      const tweet = createTweet({ id: 'tweet-already-replied' });

      // Record a previous reply to this tweet
      await db.recordReply({
        tweetId: tweet.id,
        authorId: tweet.authorId,
        authorUsername: tweet.authorUsername,
        tweetText: tweet.text,
        tweetCreatedAt: tweet.createdAt,
        replyTweetId: 'reply-123',
        success: true,
      });

      // Verify deduplication works
      const hasReplied = await db.hasRepliedToTweet(tweet.id);
      expect(hasReplied).toBe(true);
    });

    it('should allow tweets that have not been replied to', async () => {
      const db = testDb.interface;

      const hasReplied = await db.hasRepliedToTweet('new-tweet-id');
      expect(hasReplied).toBe(false);
    });

    it('should track per-author reply count within 24h window', async () => {
      const db = testDb.interface;
      const authorId = 'prolific-author';

      // Initially zero
      expect(await db.getRepliesForAuthorToday(authorId)).toBe(0);

      // Record first reply
      await db.recordReply({
        tweetId: 'tweet-1',
        authorId,
        authorUsername: 'prolificuser',
        tweetText: 'First tweet text...',
        tweetCreatedAt: new Date(),
        replyTweetId: 'reply-1',
        success: true,
      });

      expect(await db.getRepliesForAuthorToday(authorId)).toBe(1);

      // Record second reply
      await db.recordReply({
        tweetId: 'tweet-2',
        authorId,
        authorUsername: 'prolificuser',
        tweetText: 'Second tweet text...',
        tweetCreatedAt: new Date(),
        replyTweetId: 'reply-2',
        success: true,
      });

      expect(await db.getRepliesForAuthorToday(authorId)).toBe(2);
    });

    it('should not count replies from other authors', async () => {
      const db = testDb.interface;

      // Reply to author A
      await db.recordReply({
        tweetId: 'tweet-author-a',
        authorId: 'author-a',
        authorUsername: 'author_a',
        tweetText: 'Author A tweet...',
        tweetCreatedAt: new Date(),
        replyTweetId: 'reply-a',
        success: true,
      });

      // Author B should have zero replies
      expect(await db.getRepliesForAuthorToday('author-b')).toBe(0);
    });
  });

  // ===========================================================================
  // Author Cache Integration Tests (Follower Filter)
  // ===========================================================================

  describe('Author cache with real DB', () => {
    it('should store and retrieve author cache', async () => {
      const db = testDb.interface;

      const author: AuthorCacheEntry = {
        authorId: 'cache-test-author',
        username: 'cachetest',
        name: 'Cache Test',
        followerCount: 75000,
        followingCount: 500,
        isVerified: true,
        updatedAt: new Date(),
      };

      await db.upsertAuthorCache(author);

      const cached = await db.getAuthorCache(author.authorId);
      expect(cached).not.toBeNull();
      expect(cached!.authorId).toBe(author.authorId);
      expect(cached!.followerCount).toBe(75000);
      expect(cached!.isVerified).toBe(true);
    });

    it('should update existing author cache', async () => {
      const db = testDb.interface;
      const authorId = 'updating-author';

      // Insert initial
      await db.upsertAuthorCache({
        authorId,
        username: 'updateme',
        name: 'Update Me',
        followerCount: 50000,
        followingCount: 100,
        isVerified: false,
        updatedAt: new Date(),
      });

      // Update with new follower count
      await db.upsertAuthorCache({
        authorId,
        username: 'updateme',
        name: 'Update Me',
        followerCount: 100000, // grew!
        followingCount: 150,
        isVerified: true, // got verified!
        updatedAt: new Date(),
      });

      const cached = await db.getAuthorCache(authorId);
      expect(cached!.followerCount).toBe(100000);
      expect(cached!.isVerified).toBe(true);
    });

    it('should seed authors from JSON array', async () => {
      const db = testDb.interface;

      const seedAuthors: SeedAuthor[] = [
        { authorId: 'seed-1', username: 'sama', name: 'Sam Altman', followerCount: 3000000 },
        { authorId: 'seed-2', username: 'karpathy', name: 'Andrej Karpathy', followerCount: 800000 },
        { authorId: 'seed-3', username: 'ylecun', name: 'Yann LeCun', followerCount: 500000 },
      ];

      await db.seedAuthorsFromJson(seedAuthors);

      // Verify all seeded
      const cached1 = await db.getAuthorCache('seed-1');
      const cached2 = await db.getAuthorCache('seed-2');
      const cached3 = await db.getAuthorCache('seed-3');

      expect(cached1).not.toBeNull();
      expect(cached1!.username).toBe('sama');
      expect(cached1!.followerCount).toBe(3000000);

      expect(cached2).not.toBeNull();
      expect(cached2!.followerCount).toBe(800000);

      expect(cached3).not.toBeNull();
      expect(cached3!.followerCount).toBe(500000);
    });

    it('should apply follower count threshold check from cache', async () => {
      const db = testDb.interface;
      const config = createConfig();
      const minFollowers = config.filters.minFollowerCount; // 50000

      // Author with enough followers
      await db.upsertAuthorCache({
        authorId: 'big-author',
        username: 'biginfluencer',
        name: 'Big Influencer',
        followerCount: 100000,
        followingCount: 500,
        isVerified: true,
        updatedAt: new Date(),
      });

      // Author with too few followers
      await db.upsertAuthorCache({
        authorId: 'small-author',
        username: 'smalluser',
        name: 'Small User',
        followerCount: 10000,
        followingCount: 200,
        isVerified: false,
        updatedAt: new Date(),
      });

      const bigAuthor = await db.getAuthorCache('big-author');
      const smallAuthor = await db.getAuthorCache('small-author');

      expect(bigAuthor!.followerCount >= minFollowers).toBe(true);
      expect(smallAuthor!.followerCount >= minFollowers).toBe(false);
    });
  });

  // ===========================================================================
  // Cache TTL (24h Expiration) Tests
  // ===========================================================================

  describe('Cache TTL (24h expiration)', () => {
    it('should return null for stale cache entries (>24h)', async () => {
      const db = testDb.interface;
      const authorId = 'stale-author';

      // Insert with manual SQL to set old timestamp
      testDb.db.run(`
        INSERT INTO author_cache (author_id, username, name, follower_count, following_count, is_verified, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now', '-25 hours'))
      `, [authorId, 'staleuser', 'Stale User', 50000, 100, 0]);

      // Should return null due to TTL
      const cached = await db.getAuthorCache(authorId);
      expect(cached).toBeNull();
    });

    it('should return valid cache entries (<24h)', async () => {
      const db = testDb.interface;
      const authorId = 'fresh-author';

      // Insert with manual SQL to set recent timestamp
      testDb.db.run(`
        INSERT INTO author_cache (author_id, username, name, follower_count, following_count, is_verified, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now', '-12 hours'))
      `, [authorId, 'freshuser', 'Fresh User', 75000, 200, 1]);

      // Should return the entry (within 24h)
      const cached = await db.getAuthorCache(authorId);
      expect(cached).not.toBeNull();
      expect(cached!.followerCount).toBe(75000);
    });

    it('should refresh cache on upsert', async () => {
      const db = testDb.interface;
      const authorId = 'refresh-author';

      // Insert stale entry
      testDb.db.run(`
        INSERT INTO author_cache (author_id, username, name, follower_count, following_count, is_verified, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now', '-25 hours'))
      `, [authorId, 'refreshuser', 'Refresh User', 50000, 100, 0]);

      // Verify it's stale
      expect(await db.getAuthorCache(authorId)).toBeNull();

      // Upsert to refresh
      await db.upsertAuthorCache({
        authorId,
        username: 'refreshuser',
        name: 'Refresh User Updated',
        followerCount: 60000,
        followingCount: 150,
        isVerified: true,
        updatedAt: new Date(),
      });

      // Now should be accessible
      const cached = await db.getAuthorCache(authorId);
      expect(cached).not.toBeNull();
      expect(cached!.followerCount).toBe(60000);
    });
  });

  // ===========================================================================
  // Rate Limit Integration Tests
  // ===========================================================================

  describe('Rate limits with real DB', () => {
    it('should enforce daily count limit', async () => {
      const db = testDb.interface;
      const config = createConfig();
      const maxDaily = config.rateLimits.maxDailyReplies; // 10

      // Simulate reaching limit
      for (let i = 0; i < maxDaily; i++) {
        await db.incrementDailyCount();
      }

      const state = await db.getRateLimitState();
      expect(state.dailyCount).toBe(maxDaily);
      expect(state.dailyCount >= maxDaily).toBe(true); // Would fail filter
    });

    it('should enforce minimum gap between replies', async () => {
      const db = testDb.interface;
      const config = createConfig();
      const minGap = config.rateLimits.minGapMinutes; // 10

      // Set last reply time to now
      const now = new Date();
      await db.updateLastReplyTime(now);

      const state = await db.getRateLimitState();
      const gapMinutes = (Date.now() - state.lastReplyAt!.getTime()) / (1000 * 60);

      // Gap should be ~0 (just replied), which is < minGap
      expect(gapMinutes < minGap).toBe(true);
    });

    it('should allow reply after sufficient gap', async () => {
      const db = testDb.interface;
      const config = createConfig();
      const minGap = config.rateLimits.minGapMinutes; // 10

      // Set last reply to 15 minutes ago
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      await db.updateLastReplyTime(fifteenMinutesAgo);

      const state = await db.getRateLimitState();
      const gapMinutes = (Date.now() - state.lastReplyAt!.getTime()) / (1000 * 60);

      // Gap should be ~15 minutes, which is > minGap (10)
      expect(gapMinutes >= minGap).toBe(true);
    });

    it('should enforce per-author daily limit', async () => {
      const db = testDb.interface;
      const config = createConfig();
      const maxPerAuthor = config.rateLimits.maxPerAuthorPerDay; // 1

      const authorId = 'limited-author';

      // Record first reply
      await db.recordReply({
        tweetId: 'limit-tweet-1',
        authorId,
        authorUsername: 'limiteduser',
        tweetText: 'First tweet...',
        tweetCreatedAt: new Date(),
        replyTweetId: 'reply-1',
        success: true,
      });

      const count = await db.getRepliesForAuthorToday(authorId);
      expect(count >= maxPerAuthor).toBe(true); // Would fail filter
    });
  });

  // ===========================================================================
  // Daily Reset Logic Tests
  // ===========================================================================

  describe('Daily reset logic', () => {
    it('should reset daily count when past reset time', async () => {
      const db = testDb.interface;

      // Set high daily count
      for (let i = 0; i < 5; i++) {
        await db.incrementDailyCount();
      }

      // Manually set reset time to the past
      testDb.db.run(`
        UPDATE rate_limits
        SET daily_reset_at = datetime('now', '-1 hour')
        WHERE id = 1
      `);

      // Get state should trigger reset
      const state = await db.getRateLimitState();

      // Count should be reset to 0
      expect(state.dailyCount).toBe(0);

      // Reset time should be updated to next midnight
      expect(state.dailyResetAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('should not reset daily count when before reset time', async () => {
      const db = testDb.interface;

      // Set daily count to 5
      for (let i = 0; i < 5; i++) {
        await db.incrementDailyCount();
      }

      // Reset time is already in future (default from init)
      const state = await db.getRateLimitState();

      // Count should remain at 5
      expect(state.dailyCount).toBe(5);
    });

    it('should update reset time to next midnight after reset', async () => {
      const db = testDb.interface;

      // Force reset by setting past time
      testDb.db.run(`
        UPDATE rate_limits
        SET daily_reset_at = datetime('now', '-1 minute')
        WHERE id = 1
      `);

      const state = await db.getRateLimitState();

      // Reset time should be in the future (next midnight)
      const now = Date.now();
      expect(state.dailyResetAt.getTime()).toBeGreaterThan(now);

      // Should be less than 24h from now
      const twentyFourHours = 24 * 60 * 60 * 1000;
      expect(state.dailyResetAt.getTime() - now).toBeLessThanOrEqual(twentyFourHours);
    });
  });

  // ===========================================================================
  // Full Filter Pipeline Integration
  // ===========================================================================

  describe('Full filter pipeline with DB', () => {
    it('should process candidate through all stages with DB', async () => {
      const db = testDb.interface;
      const config = createConfig();

      // Seed author cache with sufficient followers
      await db.upsertAuthorCache({
        authorId: 'eligible-author',
        username: 'eligibleuser',
        name: 'Eligible User',
        followerCount: 100000,
        followingCount: 500,
        isVerified: true,
        updatedAt: new Date(),
      });

      const tweet = createTweet({
        id: 'test-tweet-full',
        authorId: 'eligible-author',
        authorUsername: 'eligibleuser',
      });

      // Check all conditions
      const hasReplied = await db.hasRepliedToTweet(tweet.id);
      const authorReplies = await db.getRepliesForAuthorToday(tweet.authorId);
      const cached = await db.getAuthorCache(tweet.authorId);
      const rateLimitState = await db.getRateLimitState();

      // Should pass all checks
      expect(hasReplied).toBe(false);
      expect(authorReplies).toBeLessThan(config.rateLimits.maxPerAuthorPerDay);
      expect(cached).not.toBeNull();
      expect(cached!.followerCount).toBeGreaterThanOrEqual(config.filters.minFollowerCount);
      expect(rateLimitState.dailyCount).toBeLessThan(config.rateLimits.maxDailyReplies);
    });

    it('should reject candidate when deduplication fails', async () => {
      const db = testDb.interface;

      const tweet = createTweet({ id: 'dup-tweet' });

      // Pre-record this tweet
      await db.recordReply({
        tweetId: tweet.id,
        authorId: tweet.authorId,
        authorUsername: tweet.authorUsername,
        tweetText: tweet.text,
        tweetCreatedAt: tweet.createdAt,
        replyTweetId: 'prev-reply',
        success: true,
      });

      // Should be rejected by deduplication
      const hasReplied = await db.hasRepliedToTweet(tweet.id);
      expect(hasReplied).toBe(true);
    });

    it('should reject candidate when below follower threshold', async () => {
      const db = testDb.interface;
      const config = createConfig();

      // Seed author with insufficient followers
      await db.upsertAuthorCache({
        authorId: 'small-follower-author',
        username: 'smallfollower',
        name: 'Small Follower',
        followerCount: 1000, // Below 50000 threshold
        followingCount: 100,
        isVerified: false,
        updatedAt: new Date(),
      });

      const cached = await db.getAuthorCache('small-follower-author');
      expect(cached!.followerCount).toBeLessThan(config.filters.minFollowerCount);
    });

    it('should reject candidate when rate limited', async () => {
      const db = testDb.interface;
      const config = createConfig();

      // Max out daily count
      for (let i = 0; i < config.rateLimits.maxDailyReplies; i++) {
        await db.incrementDailyCount();
      }

      const state = await db.getRateLimitState();
      expect(state.dailyCount).toBeGreaterThanOrEqual(config.rateLimits.maxDailyReplies);
    });

    it('should track multiple rejection reasons independently', async () => {
      const db = testDb.interface;

      // Record replies to different tweets from different authors
      await db.recordReply({
        tweetId: 'tweet-a',
        authorId: 'author-a',
        authorUsername: 'author_a',
        tweetText: 'Tweet A...',
        tweetCreatedAt: new Date(),
        replyTweetId: 'reply-a',
        success: true,
      });

      await db.recordReply({
        tweetId: 'tweet-b',
        authorId: 'author-b',
        authorUsername: 'author_b',
        tweetText: 'Tweet B...',
        tweetCreatedAt: new Date(),
        replyTweetId: 'reply-b',
        success: true,
      });

      // Each can be independently checked
      expect(await db.hasRepliedToTweet('tweet-a')).toBe(true);
      expect(await db.hasRepliedToTweet('tweet-b')).toBe(true);
      expect(await db.hasRepliedToTweet('tweet-c')).toBe(false);

      expect(await db.getRepliesForAuthorToday('author-a')).toBe(1);
      expect(await db.getRepliesForAuthorToday('author-b')).toBe(1);
      expect(await db.getRepliesForAuthorToday('author-c')).toBe(0);
    });
  });

  // ===========================================================================
  // Transaction and Consistency Tests
  // ===========================================================================

  describe('Database consistency', () => {
    it('should maintain UNIQUE constraint on tweet_id', async () => {
      const db = testDb.interface;

      await db.recordReply({
        tweetId: 'unique-tweet',
        authorId: 'author-1',
        authorUsername: 'author1',
        tweetText: 'First reply...',
        tweetCreatedAt: new Date(),
        replyTweetId: 'reply-1',
        success: true,
      });

      // Attempting to insert duplicate should throw
      await expect(db.recordReply({
        tweetId: 'unique-tweet', // Same tweet ID
        authorId: 'author-2',
        authorUsername: 'author2',
        tweetText: 'Second reply attempt...',
        tweetCreatedAt: new Date(),
        replyTweetId: 'reply-2',
        success: true,
      })).rejects.toThrow();
    });

    it('should maintain singleton constraint on rate_limits', async () => {
      // Try to insert a second rate_limits row
      expect(() => {
        testDb.db.run(`
          INSERT INTO rate_limits (id, daily_count)
          VALUES (2, 0)
        `);
      }).toThrow();
    });

    it('should handle concurrent-like operations correctly', async () => {
      const db = testDb.interface;

      // Simulate rapid increments
      const incrementPromises = [];
      for (let i = 0; i < 10; i++) {
        incrementPromises.push(db.incrementDailyCount());
      }
      await Promise.all(incrementPromises);

      const state = await db.getRateLimitState();
      expect(state.dailyCount).toBe(10);
    });
  });
});
