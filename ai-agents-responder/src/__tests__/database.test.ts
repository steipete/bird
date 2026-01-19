/**
 * Unit tests for database operations
 * Tests all core queries using in-memory SQLite
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database as BunDatabase } from 'bun:sqlite';
import type {
  Database,
  RateLimitState,
  CircuitBreakerState,
  AuthorCacheEntry,
  ReplyLogEntry,
  SeedAuthor,
  CircuitBreakerUpdate,
} from '../types.js';

// =============================================================================
// Test Database Setup
// =============================================================================

/**
 * Create an in-memory database for testing
 * Replicates the schema from database.ts
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

  // Create database interface
  const dbInterface = createDatabaseInterface(db);

  return { db, interface: dbInterface };
}

/**
 * Create the Database interface implementation for testing
 * Same implementation as database.ts but using provided db instance
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
        return {
          dailyCount: 0,
          lastReplyAt: null,
          dailyResetAt: new Date(),
        };
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
      db.run(
        'UPDATE rate_limits SET last_reply_at = ? WHERE id = 1',
        [timestamp.toISOString()]
      );
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
        return {
          state: 'closed',
          failureCount: 0,
          openedAt: null,
        };
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

      if (setClauses.length === 0) {
        return;
      }

      const sql = `UPDATE rate_limits SET ${setClauses.join(', ')} WHERE id = 1`;
      db.run(sql, values);
    },

    async recordManusFailure(): Promise<void> {
      db.run(`
        UPDATE rate_limits
        SET circuit_breaker_failures = circuit_breaker_failures + 1
        WHERE id = 1
      `);
    },

    async recordManusSuccess(): Promise<void> {
      db.run(`
        UPDATE rate_limits
        SET circuit_breaker_failures = 0,
            circuit_breaker_state = 'closed',
            circuit_breaker_opened_at = NULL
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

      if (!row) {
        return null;
      }

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

    async initialize(): Promise<void> {
      // Already initialized
    },

    async close(): Promise<void> {
      db.close();
    },
  };
}

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a sample reply log entry for testing
 */
function createSampleReplyLog(overrides: Partial<ReplyLogEntry> = {}): ReplyLogEntry {
  return {
    tweetId: 'tweet_123',
    authorId: 'author_456',
    authorUsername: 'testuser',
    tweetText: 'This is a test tweet about AI agents',
    tweetCreatedAt: new Date('2026-01-19T10:00:00Z'),
    replyTweetId: 'reply_789',
    success: true,
    errorMessage: undefined,
    manusTaskId: 'manus_task_001',
    manusDuration: 45000,
    pngSize: 250000,
    templateIndex: 3,
    ...overrides,
  };
}

/**
 * Create a sample author cache entry for testing
 */
function createSampleAuthor(overrides: Partial<AuthorCacheEntry> = {}): AuthorCacheEntry {
  return {
    authorId: 'author_123',
    username: 'testinfluencer',
    name: 'Test Influencer',
    followerCount: 100000,
    followingCount: 500,
    isVerified: true,
    updatedAt: new Date(),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Database Operations', () => {
  let testDb: { db: BunDatabase; interface: Database };

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  afterEach(() => {
    testDb.db.close();
  });

  // ---------------------------------------------------------------------------
  // Schema Creation Tests
  // ---------------------------------------------------------------------------

  describe('initDatabase - schema creation', () => {
    it('should create replied_tweets table with all columns', () => {
      const tableInfo = testDb.db
        .query("SELECT name FROM sqlite_master WHERE type='table' AND name='replied_tweets'")
        .get();
      expect(tableInfo).not.toBeNull();

      const columns = testDb.db
        .query("PRAGMA table_info(replied_tweets)")
        .all() as { name: string }[];
      const columnNames = columns.map(c => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('tweet_id');
      expect(columnNames).toContain('author_id');
      expect(columnNames).toContain('author_username');
      expect(columnNames).toContain('tweet_text');
      expect(columnNames).toContain('tweet_created_at');
      expect(columnNames).toContain('reply_tweet_id');
      expect(columnNames).toContain('replied_at');
      expect(columnNames).toContain('success');
      expect(columnNames).toContain('error_message');
      expect(columnNames).toContain('manus_task_id');
      expect(columnNames).toContain('manus_duration_ms');
      expect(columnNames).toContain('png_size_bytes');
      expect(columnNames).toContain('reply_template_index');
    });

    it('should create rate_limits table with circuit breaker columns', () => {
      const tableInfo = testDb.db
        .query("SELECT name FROM sqlite_master WHERE type='table' AND name='rate_limits'")
        .get();
      expect(tableInfo).not.toBeNull();

      const columns = testDb.db
        .query("PRAGMA table_info(rate_limits)")
        .all() as { name: string }[];
      const columnNames = columns.map(c => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('last_reply_at');
      expect(columnNames).toContain('daily_count');
      expect(columnNames).toContain('daily_reset_at');
      expect(columnNames).toContain('circuit_breaker_state');
      expect(columnNames).toContain('circuit_breaker_failures');
      expect(columnNames).toContain('circuit_breaker_opened_at');
    });

    it('should create author_cache table with all columns', () => {
      const tableInfo = testDb.db
        .query("SELECT name FROM sqlite_master WHERE type='table' AND name='author_cache'")
        .get();
      expect(tableInfo).not.toBeNull();

      const columns = testDb.db
        .query("PRAGMA table_info(author_cache)")
        .all() as { name: string }[];
      const columnNames = columns.map(c => c.name);

      expect(columnNames).toContain('author_id');
      expect(columnNames).toContain('username');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('follower_count');
      expect(columnNames).toContain('following_count');
      expect(columnNames).toContain('is_verified');
      expect(columnNames).toContain('created_at');
      expect(columnNames).toContain('updated_at');
    });

    it('should create all required indexes', () => {
      const indexes = testDb.db
        .query("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
        .all() as { name: string }[];
      const indexNames = indexes.map(i => i.name);

      expect(indexNames).toContain('idx_replied_tweets_author');
      expect(indexNames).toContain('idx_replied_tweets_date');
      expect(indexNames).toContain('idx_replied_tweets_success');
      expect(indexNames).toContain('idx_author_cache_followers');
      expect(indexNames).toContain('idx_author_cache_updated');
    });

    it('should initialize rate_limits singleton row', () => {
      const row = testDb.db.query('SELECT * FROM rate_limits WHERE id = 1').get() as {
        id: number;
        daily_count: number;
        circuit_breaker_state: string;
        circuit_breaker_failures: number;
      };

      expect(row).not.toBeNull();
      expect(row.id).toBe(1);
      expect(row.daily_count).toBe(0);
      expect(row.circuit_breaker_state).toBe('closed');
      expect(row.circuit_breaker_failures).toBe(0);
    });

    it('should enforce singleton constraint on rate_limits', () => {
      // Try to insert a second row - should fail
      expect(() => {
        testDb.db.run(`
          INSERT INTO rate_limits (id, daily_count)
          VALUES (2, 0)
        `);
      }).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // hasRepliedToTweet Tests
  // ---------------------------------------------------------------------------

  describe('hasRepliedToTweet', () => {
    it('should return false for unknown tweet', async () => {
      const result = await testDb.interface.hasRepliedToTweet('unknown_tweet_id');
      expect(result).toBe(false);
    });

    it('should return true after recording reply', async () => {
      const log = createSampleReplyLog({ tweetId: 'tweet_abc' });
      await testDb.interface.recordReply(log);

      const result = await testDb.interface.hasRepliedToTweet('tweet_abc');
      expect(result).toBe(true);
    });

    it('should still return false for different tweet id', async () => {
      const log = createSampleReplyLog({ tweetId: 'tweet_abc' });
      await testDb.interface.recordReply(log);

      const result = await testDb.interface.hasRepliedToTweet('tweet_xyz');
      expect(result).toBe(false);
    });

    it('should handle multiple tweets correctly', async () => {
      await testDb.interface.recordReply(createSampleReplyLog({ tweetId: 'tweet_1' }));
      await testDb.interface.recordReply(createSampleReplyLog({ tweetId: 'tweet_2' }));
      await testDb.interface.recordReply(createSampleReplyLog({ tweetId: 'tweet_3' }));

      expect(await testDb.interface.hasRepliedToTweet('tweet_1')).toBe(true);
      expect(await testDb.interface.hasRepliedToTweet('tweet_2')).toBe(true);
      expect(await testDb.interface.hasRepliedToTweet('tweet_3')).toBe(true);
      expect(await testDb.interface.hasRepliedToTweet('tweet_4')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // getRepliesForAuthorToday Tests
  // ---------------------------------------------------------------------------

  describe('getRepliesForAuthorToday', () => {
    it('should return 0 for author with no replies', async () => {
      const count = await testDb.interface.getRepliesForAuthorToday('unknown_author');
      expect(count).toBe(0);
    });

    it('should count replies for specific author', async () => {
      await testDb.interface.recordReply(createSampleReplyLog({
        tweetId: 'tweet_1',
        authorId: 'author_A',
      }));
      await testDb.interface.recordReply(createSampleReplyLog({
        tweetId: 'tweet_2',
        authorId: 'author_A',
      }));
      await testDb.interface.recordReply(createSampleReplyLog({
        tweetId: 'tweet_3',
        authorId: 'author_B',
      }));

      const countA = await testDb.interface.getRepliesForAuthorToday('author_A');
      const countB = await testDb.interface.getRepliesForAuthorToday('author_B');

      expect(countA).toBe(2);
      expect(countB).toBe(1);
    });

    it('should only count replies within 24 hours', async () => {
      // Insert a reply with replied_at in the past (more than 24h ago)
      testDb.db.run(`
        INSERT INTO replied_tweets (
          tweet_id, author_id, author_username, tweet_text, tweet_created_at, replied_at, success
        ) VALUES (
          'old_tweet', 'author_old', 'olduser', 'Old text', datetime('now'), datetime('now', '-25 hours'), 1
        )
      `);

      // Insert a recent reply
      await testDb.interface.recordReply(createSampleReplyLog({
        tweetId: 'recent_tweet',
        authorId: 'author_old',
      }));

      const count = await testDb.interface.getRepliesForAuthorToday('author_old');
      expect(count).toBe(1); // Only the recent one should count
    });
  });

  // ---------------------------------------------------------------------------
  // getRateLimitState Tests
  // ---------------------------------------------------------------------------

  describe('getRateLimitState', () => {
    it('should return correct initial state structure', async () => {
      const state = await testDb.interface.getRateLimitState();

      expect(state).toHaveProperty('dailyCount');
      expect(state).toHaveProperty('lastReplyAt');
      expect(state).toHaveProperty('dailyResetAt');
      expect(typeof state.dailyCount).toBe('number');
      expect(state.dailyResetAt).toBeInstanceOf(Date);
    });

    it('should return 0 daily count initially', async () => {
      const state = await testDb.interface.getRateLimitState();
      expect(state.dailyCount).toBe(0);
    });

    it('should return null lastReplyAt initially', async () => {
      const state = await testDb.interface.getRateLimitState();
      expect(state.lastReplyAt).toBeNull();
    });

    it('should return dailyResetAt in the future', async () => {
      const state = await testDb.interface.getRateLimitState();
      expect(state.dailyResetAt.getTime()).toBeGreaterThan(Date.now() - 1000);
    });

    it('should reflect incremented count', async () => {
      await testDb.interface.incrementDailyCount();
      await testDb.interface.incrementDailyCount();
      await testDb.interface.incrementDailyCount();

      const state = await testDb.interface.getRateLimitState();
      expect(state.dailyCount).toBe(3);
    });

    it('should reflect updated lastReplyAt', async () => {
      const timestamp = new Date('2026-01-19T15:30:00Z');
      await testDb.interface.updateLastReplyTime(timestamp);

      const state = await testDb.interface.getRateLimitState();
      expect(state.lastReplyAt).not.toBeNull();
      expect(state.lastReplyAt?.toISOString()).toBe(timestamp.toISOString());
    });
  });

  // ---------------------------------------------------------------------------
  // incrementDailyCount Tests
  // ---------------------------------------------------------------------------

  describe('incrementDailyCount', () => {
    it('should increment from 0 to 1', async () => {
      await testDb.interface.incrementDailyCount();
      const state = await testDb.interface.getRateLimitState();
      expect(state.dailyCount).toBe(1);
    });

    it('should increment multiple times correctly', async () => {
      for (let i = 0; i < 10; i++) {
        await testDb.interface.incrementDailyCount();
      }
      const state = await testDb.interface.getRateLimitState();
      expect(state.dailyCount).toBe(10);
    });
  });

  // ---------------------------------------------------------------------------
  // updateLastReplyTime Tests
  // ---------------------------------------------------------------------------

  describe('updateLastReplyTime', () => {
    it('should update lastReplyAt correctly', async () => {
      const timestamp = new Date('2026-01-19T12:00:00Z');
      await testDb.interface.updateLastReplyTime(timestamp);

      const state = await testDb.interface.getRateLimitState();
      expect(state.lastReplyAt?.toISOString()).toBe(timestamp.toISOString());
    });

    it('should overwrite previous timestamp', async () => {
      const first = new Date('2026-01-19T10:00:00Z');
      const second = new Date('2026-01-19T11:00:00Z');

      await testDb.interface.updateLastReplyTime(first);
      await testDb.interface.updateLastReplyTime(second);

      const state = await testDb.interface.getRateLimitState();
      expect(state.lastReplyAt?.toISOString()).toBe(second.toISOString());
    });
  });

  // ---------------------------------------------------------------------------
  // resetDailyCountIfNeeded Tests
  // ---------------------------------------------------------------------------

  describe('resetDailyCountIfNeeded', () => {
    it('should not reset when daily_reset_at is in the future', async () => {
      // Increment the count first
      await testDb.interface.incrementDailyCount();
      await testDb.interface.incrementDailyCount();

      // Reset should NOT happen (reset_at is tomorrow)
      await testDb.interface.resetDailyCountIfNeeded();

      const state = await testDb.interface.getRateLimitState();
      expect(state.dailyCount).toBe(2);
    });

    it('should reset when daily_reset_at is in the past', async () => {
      // Increment the count
      await testDb.interface.incrementDailyCount();
      await testDb.interface.incrementDailyCount();
      await testDb.interface.incrementDailyCount();

      // Set reset time to the past
      testDb.db.run(`
        UPDATE rate_limits SET daily_reset_at = datetime('now', '-1 hour') WHERE id = 1
      `);

      // Now reset should happen via getRateLimitState (which calls resetDailyCountIfNeeded)
      const state = await testDb.interface.getRateLimitState();
      expect(state.dailyCount).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // recordReply Tests
  // ---------------------------------------------------------------------------

  describe('recordReply', () => {
    it('should insert log entry with all fields', async () => {
      const log = createSampleReplyLog();
      await testDb.interface.recordReply(log);

      const row = testDb.db.query('SELECT * FROM replied_tweets WHERE tweet_id = ?')
        .get(log.tweetId) as Record<string, unknown>;

      expect(row).not.toBeNull();
      expect(row.tweet_id).toBe(log.tweetId);
      expect(row.author_id).toBe(log.authorId);
      expect(row.author_username).toBe(log.authorUsername);
      expect(row.tweet_text).toBe(log.tweetText);
      expect(row.reply_tweet_id).toBe(log.replyTweetId);
      expect(row.success).toBe(1); // SQLite boolean
      expect(row.manus_task_id).toBe(log.manusTaskId);
      expect(row.manus_duration_ms).toBe(log.manusDuration);
      expect(row.png_size_bytes).toBe(log.pngSize);
      expect(row.reply_template_index).toBe(log.templateIndex);
    });

    it('should insert failed reply with error message', async () => {
      const log = createSampleReplyLog({
        tweetId: 'failed_tweet',
        success: false,
        replyTweetId: null,
        errorMessage: 'API rate limit exceeded',
      });
      await testDb.interface.recordReply(log);

      const row = testDb.db.query('SELECT * FROM replied_tweets WHERE tweet_id = ?')
        .get(log.tweetId) as Record<string, unknown>;

      expect(row.success).toBe(0);
      expect(row.reply_tweet_id).toBeNull();
      expect(row.error_message).toBe('API rate limit exceeded');
    });

    it('should handle null optional fields', async () => {
      const log: ReplyLogEntry = {
        tweetId: 'minimal_tweet',
        authorId: 'author_1',
        authorUsername: 'user1',
        tweetText: 'Minimal tweet',
        tweetCreatedAt: new Date(),
        replyTweetId: null,
        success: true,
      };
      await testDb.interface.recordReply(log);

      const row = testDb.db.query('SELECT * FROM replied_tweets WHERE tweet_id = ?')
        .get(log.tweetId) as Record<string, unknown>;

      expect(row.manus_task_id).toBeNull();
      expect(row.manus_duration_ms).toBeNull();
      expect(row.png_size_bytes).toBeNull();
      expect(row.reply_template_index).toBeNull();
    });

    it('should reject duplicate tweet_id', async () => {
      const log = createSampleReplyLog({ tweetId: 'duplicate_tweet' });
      await testDb.interface.recordReply(log);

      // Second insert with same tweet_id should fail
      await expect(testDb.interface.recordReply(log)).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Author Cache Tests
  // ---------------------------------------------------------------------------

  describe('author cache operations', () => {
    describe('upsertAuthorCache', () => {
      it('should insert new author', async () => {
        const author = createSampleAuthor({ authorId: 'new_author' });
        await testDb.interface.upsertAuthorCache(author);

        const cached = await testDb.interface.getAuthorCache('new_author');
        expect(cached).not.toBeNull();
        expect(cached?.username).toBe(author.username);
        expect(cached?.followerCount).toBe(author.followerCount);
      });

      it('should update existing author', async () => {
        const author = createSampleAuthor({ authorId: 'update_author', followerCount: 50000 });
        await testDb.interface.upsertAuthorCache(author);

        // Update with new follower count
        const updated = { ...author, followerCount: 75000, name: 'Updated Name' };
        await testDb.interface.upsertAuthorCache(updated);

        const cached = await testDb.interface.getAuthorCache('update_author');
        expect(cached?.followerCount).toBe(75000);
        expect(cached?.name).toBe('Updated Name');
      });
    });

    describe('getAuthorCache', () => {
      it('should return null for unknown author', async () => {
        const cached = await testDb.interface.getAuthorCache('nonexistent_author');
        expect(cached).toBeNull();
      });

      it('should return cached author with correct structure', async () => {
        const author = createSampleAuthor({
          authorId: 'struct_test',
          username: 'structuser',
          name: 'Structure Test',
          followerCount: 123456,
          followingCount: 789,
          isVerified: true,
        });
        await testDb.interface.upsertAuthorCache(author);

        const cached = await testDb.interface.getAuthorCache('struct_test');
        expect(cached).not.toBeNull();
        expect(cached?.authorId).toBe('struct_test');
        expect(cached?.username).toBe('structuser');
        expect(cached?.name).toBe('Structure Test');
        expect(cached?.followerCount).toBe(123456);
        expect(cached?.followingCount).toBe(789);
        expect(cached?.isVerified).toBe(true);
        expect(cached?.updatedAt).toBeInstanceOf(Date);
      });

      it('should return null for stale cache (>24h)', async () => {
        const author = createSampleAuthor({ authorId: 'stale_author' });
        await testDb.interface.upsertAuthorCache(author);

        // Set updated_at to more than 24h ago
        testDb.db.run(`
          UPDATE author_cache SET updated_at = datetime('now', '-25 hours')
          WHERE author_id = 'stale_author'
        `);

        const cached = await testDb.interface.getAuthorCache('stale_author');
        expect(cached).toBeNull();
      });

      it('should return fresh cache within 24h', async () => {
        const author = createSampleAuthor({ authorId: 'fresh_author' });
        await testDb.interface.upsertAuthorCache(author);

        // Set updated_at to 23h ago (still valid)
        testDb.db.run(`
          UPDATE author_cache SET updated_at = datetime('now', '-23 hours')
          WHERE author_id = 'fresh_author'
        `);

        const cached = await testDb.interface.getAuthorCache('fresh_author');
        expect(cached).not.toBeNull();
        expect(cached?.authorId).toBe('fresh_author');
      });
    });

    describe('seedAuthorsFromJson', () => {
      it('should insert multiple authors', async () => {
        const authors: SeedAuthor[] = [
          { authorId: 'seed_1', username: 'user1', name: 'User One', followerCount: 100000 },
          { authorId: 'seed_2', username: 'user2', name: 'User Two', followerCount: 200000 },
          { authorId: 'seed_3', username: 'user3', name: 'User Three', followerCount: 300000 },
        ];

        await testDb.interface.seedAuthorsFromJson(authors);

        const cached1 = await testDb.interface.getAuthorCache('seed_1');
        const cached2 = await testDb.interface.getAuthorCache('seed_2');
        const cached3 = await testDb.interface.getAuthorCache('seed_3');

        expect(cached1?.username).toBe('user1');
        expect(cached2?.username).toBe('user2');
        expect(cached3?.username).toBe('user3');
      });

      it('should handle optional fields in seed data', async () => {
        const authors: SeedAuthor[] = [
          { authorId: 'opt_1', username: 'optuser', name: 'Optional', followerCount: 50000 },
          { authorId: 'opt_2', username: 'fulluser', name: 'Full', followerCount: 60000, followingCount: 100, isVerified: true },
        ];

        await testDb.interface.seedAuthorsFromJson(authors);

        const cached1 = await testDb.interface.getAuthorCache('opt_1');
        const cached2 = await testDb.interface.getAuthorCache('opt_2');

        expect(cached1?.followingCount).toBe(0); // Default
        expect(cached1?.isVerified).toBe(false); // Default
        expect(cached2?.followingCount).toBe(100);
        expect(cached2?.isVerified).toBe(true);
      });

      it('should update existing authors on re-seed', async () => {
        const initial: SeedAuthor[] = [
          { authorId: 'reseed_1', username: 'original', name: 'Original', followerCount: 50000 },
        ];
        await testDb.interface.seedAuthorsFromJson(initial);

        const updated: SeedAuthor[] = [
          { authorId: 'reseed_1', username: 'updated', name: 'Updated', followerCount: 100000 },
        ];
        await testDb.interface.seedAuthorsFromJson(updated);

        const cached = await testDb.interface.getAuthorCache('reseed_1');
        expect(cached?.username).toBe('updated');
        expect(cached?.name).toBe('Updated');
        expect(cached?.followerCount).toBe(100000);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Circuit Breaker State Tests
  // ---------------------------------------------------------------------------

  describe('circuit breaker operations', () => {
    describe('getCircuitBreakerState', () => {
      it('should return initial closed state', async () => {
        const state = await testDb.interface.getCircuitBreakerState();

        expect(state.state).toBe('closed');
        expect(state.failureCount).toBe(0);
        expect(state.openedAt).toBeNull();
      });

      it('should return correct structure', async () => {
        const state = await testDb.interface.getCircuitBreakerState();

        expect(state).toHaveProperty('state');
        expect(state).toHaveProperty('failureCount');
        expect(state).toHaveProperty('openedAt');
        expect(['closed', 'open', 'half-open']).toContain(state.state);
        expect(typeof state.failureCount).toBe('number');
      });
    });

    describe('updateCircuitBreakerState', () => {
      it('should update state to open', async () => {
        const openedAt = new Date();
        await testDb.interface.updateCircuitBreakerState({
          state: 'open',
          failureCount: 3,
          openedAt,
        });

        const state = await testDb.interface.getCircuitBreakerState();
        expect(state.state).toBe('open');
        expect(state.failureCount).toBe(3);
        expect(state.openedAt?.toISOString()).toBe(openedAt.toISOString());
      });

      it('should update state to half-open', async () => {
        await testDb.interface.updateCircuitBreakerState({
          state: 'half-open',
        });

        const state = await testDb.interface.getCircuitBreakerState();
        expect(state.state).toBe('half-open');
      });

      it('should update only provided fields', async () => {
        // Set initial state
        await testDb.interface.updateCircuitBreakerState({
          state: 'open',
          failureCount: 5,
          openedAt: new Date(),
        });

        // Update only failureCount
        await testDb.interface.updateCircuitBreakerState({
          failureCount: 10,
        });

        const state = await testDb.interface.getCircuitBreakerState();
        expect(state.state).toBe('open'); // Unchanged
        expect(state.failureCount).toBe(10); // Updated
      });

      it('should handle clearing openedAt', async () => {
        await testDb.interface.updateCircuitBreakerState({
          state: 'open',
          openedAt: new Date(),
        });

        await testDb.interface.updateCircuitBreakerState({
          state: 'closed',
          openedAt: null,
        });

        const state = await testDb.interface.getCircuitBreakerState();
        expect(state.state).toBe('closed');
        expect(state.openedAt).toBeNull();
      });

      it('should do nothing with empty update', async () => {
        // Set initial state
        await testDb.interface.updateCircuitBreakerState({
          state: 'open',
          failureCount: 2,
        });

        // Empty update
        await testDb.interface.updateCircuitBreakerState({});

        const state = await testDb.interface.getCircuitBreakerState();
        expect(state.state).toBe('open');
        expect(state.failureCount).toBe(2);
      });
    });

    describe('recordManusFailure', () => {
      it('should increment failure count', async () => {
        await testDb.interface.recordManusFailure();
        let state = await testDb.interface.getCircuitBreakerState();
        expect(state.failureCount).toBe(1);

        await testDb.interface.recordManusFailure();
        state = await testDb.interface.getCircuitBreakerState();
        expect(state.failureCount).toBe(2);

        await testDb.interface.recordManusFailure();
        state = await testDb.interface.getCircuitBreakerState();
        expect(state.failureCount).toBe(3);
      });

      it('should not change state (only count)', async () => {
        const initialState = await testDb.interface.getCircuitBreakerState();
        expect(initialState.state).toBe('closed');

        await testDb.interface.recordManusFailure();

        const afterState = await testDb.interface.getCircuitBreakerState();
        expect(afterState.state).toBe('closed'); // State change handled by circuit-breaker.ts
      });
    });

    describe('recordManusSuccess', () => {
      it('should reset failure count to 0', async () => {
        // Build up failures
        await testDb.interface.recordManusFailure();
        await testDb.interface.recordManusFailure();
        await testDb.interface.recordManusFailure();

        let state = await testDb.interface.getCircuitBreakerState();
        expect(state.failureCount).toBe(3);

        // Record success
        await testDb.interface.recordManusSuccess();

        state = await testDb.interface.getCircuitBreakerState();
        expect(state.failureCount).toBe(0);
      });

      it('should reset state to closed', async () => {
        // Set open state
        await testDb.interface.updateCircuitBreakerState({
          state: 'open',
          failureCount: 3,
          openedAt: new Date(),
        });

        // Record success
        await testDb.interface.recordManusSuccess();

        const state = await testDb.interface.getCircuitBreakerState();
        expect(state.state).toBe('closed');
        expect(state.failureCount).toBe(0);
        expect(state.openedAt).toBeNull();
      });

      it('should reset from half-open state', async () => {
        await testDb.interface.updateCircuitBreakerState({
          state: 'half-open',
          failureCount: 1,
        });

        await testDb.interface.recordManusSuccess();

        const state = await testDb.interface.getCircuitBreakerState();
        expect(state.state).toBe('closed');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Database Lifecycle Tests
  // ---------------------------------------------------------------------------

  describe('database lifecycle', () => {
    it('should close database without error', async () => {
      // Close should complete without throwing
      await testDb.interface.close();
      // If we get here, it succeeded
      expect(true).toBe(true);
    });

    it('should throw on queries after close', async () => {
      await testDb.interface.close();

      // Queries should fail after close
      expect(() => {
        testDb.db.query('SELECT 1').get();
      }).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Edge Cases and Error Handling
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('should handle empty string tweet_id', async () => {
      const log = createSampleReplyLog({ tweetId: '' });
      await testDb.interface.recordReply(log);

      const result = await testDb.interface.hasRepliedToTweet('');
      expect(result).toBe(true);
    });

    it('should handle very long tweet text', async () => {
      const longText = 'A'.repeat(10000);
      const log = createSampleReplyLog({ tweetId: 'long_tweet', tweetText: longText });
      await testDb.interface.recordReply(log);

      const row = testDb.db.query('SELECT tweet_text FROM replied_tweets WHERE tweet_id = ?')
        .get('long_tweet') as { tweet_text: string };
      expect(row.tweet_text).toBe(longText);
    });

    it('should handle special characters in username', async () => {
      const author = createSampleAuthor({
        authorId: 'special_chars',
        username: 'user_with-dashes.and_underscores',
        name: "User's Name with \"quotes\"",
      });
      await testDb.interface.upsertAuthorCache(author);

      const cached = await testDb.interface.getAuthorCache('special_chars');
      expect(cached?.username).toBe('user_with-dashes.and_underscores');
      expect(cached?.name).toBe("User's Name with \"quotes\"");
    });

    it('should handle large follower counts', async () => {
      const author = createSampleAuthor({
        authorId: 'big_account',
        followerCount: 150000000, // 150M followers
      });
      await testDb.interface.upsertAuthorCache(author);

      const cached = await testDb.interface.getAuthorCache('big_account');
      expect(cached?.followerCount).toBe(150000000);
    });

    it('should handle boundary timestamp values', async () => {
      const veryOldDate = new Date('1970-01-01T00:00:00Z');
      const futureDate = new Date('2099-12-31T23:59:59Z');

      await testDb.interface.updateLastReplyTime(veryOldDate);
      let state = await testDb.interface.getRateLimitState();
      expect(state.lastReplyAt?.toISOString()).toBe(veryOldDate.toISOString());

      await testDb.interface.updateLastReplyTime(futureDate);
      state = await testDb.interface.getRateLimitState();
      expect(state.lastReplyAt?.toISOString()).toBe(futureDate.toISOString());
    });
  });
});
