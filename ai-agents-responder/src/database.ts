/**
 * SQLite database operations for AI Agents Twitter Auto-Responder
 * Uses bun:sqlite for high-performance SQLite access
 */

import { Database as BunDatabase } from 'bun:sqlite';
import type {
  Database,
  RateLimitState,
  CircuitBreakerState,
  CircuitBreakerUpdate,
  AuthorCacheEntry,
  ReplyLogEntry,
  SeedAuthor,
} from './types.js';
import { logger } from './logger.js';

// Database singleton instance
let dbInstance: BunDatabase | null = null;

/**
 * Get database path from environment
 */
function getDatabasePath(): string {
  return process.env.DATABASE_PATH || './data/responder.db';
}

/**
 * Initialize database connection and create tables
 */
export async function initDatabase(): Promise<Database> {
  const dbPath = getDatabasePath();

  // Ensure data directory exists
  const dir = dbPath.substring(0, dbPath.lastIndexOf('/'));
  if (dir && dir !== '.') {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });
  }

  // Create or open database
  dbInstance = new BunDatabase(dbPath);

  // Enable WAL mode for better concurrent access
  dbInstance.run('PRAGMA journal_mode = WAL');

  // Create tables
  createTables(dbInstance);

  // Create indexes
  createIndexes(dbInstance);

  // Initialize rate_limits singleton with circuit breaker defaults
  initializeRateLimitsSingleton(dbInstance);

  logger.info('database', 'initialized', { path: dbPath });

  return createDatabaseInterface(dbInstance);
}

/**
 * Create all required tables
 */
function createTables(db: BunDatabase): void {
  // Table: replied_tweets - track all reply attempts
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

  // Table: rate_limits - singleton row for global rate limiting and circuit breaker
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

  // Table: author_cache - cached author data with 24h TTL
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
}

/**
 * Create all required indexes
 */
function createIndexes(db: BunDatabase): void {
  // replied_tweets indexes
  db.run('CREATE INDEX IF NOT EXISTS idx_replied_tweets_author ON replied_tweets(author_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_replied_tweets_date ON replied_tweets(replied_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_replied_tweets_success ON replied_tweets(success)');

  // author_cache indexes
  db.run('CREATE INDEX IF NOT EXISTS idx_author_cache_followers ON author_cache(follower_count)');
  db.run('CREATE INDEX IF NOT EXISTS idx_author_cache_updated ON author_cache(updated_at)');
}

/**
 * Initialize rate_limits singleton row with circuit breaker defaults
 */
function initializeRateLimitsSingleton(db: BunDatabase): void {
  // Check if singleton row exists
  const existing = db.query('SELECT id FROM rate_limits WHERE id = 1').get();

  if (!existing) {
    // Insert singleton with circuit breaker defaults
    db.run(`
      INSERT INTO rate_limits (id, daily_count, daily_reset_at, circuit_breaker_state, circuit_breaker_failures, circuit_breaker_opened_at)
      VALUES (1, 0, datetime('now', 'start of day', '+1 day'), 'closed', 0, NULL)
    `);
    logger.info('database', 'rate_limits_singleton_created', {
      circuit_state: 'closed',
      circuit_failure_count: 0,
    });
  }
}

/**
 * Create the Database interface implementation
 */
function createDatabaseInterface(db: BunDatabase): Database {
  return {
    // Deduplication methods
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

    // Rate limit methods
    async getRateLimitState(): Promise<RateLimitState> {
      const row = db.query(`
        SELECT daily_count, last_reply_at, daily_reset_at
        FROM rate_limits WHERE id = 1
      `).get() as {
        daily_count: number;
        last_reply_at: string | null;
        daily_reset_at: string;
      } | null;

      if (!row) {
        // Shouldn't happen after initialization, but handle gracefully
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
      // Reset if past midnight UTC
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

    // Circuit breaker methods
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
      // Build dynamic UPDATE statement based on provided fields
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

      // Note: lastFailureAt is logged but not stored in the current schema
      // The schema uses circuit_breaker_opened_at for timing

      if (setClauses.length === 0) {
        // Nothing to update
        return;
      }

      const sql = `UPDATE rate_limits SET ${setClauses.join(', ')} WHERE id = 1`;
      db.run(sql, values);

      logger.info('database', 'circuit_breaker_state_updated', {
        state: update.state,
        failureCount: update.failureCount,
        openedAt: update.openedAt?.toISOString() ?? null,
      });
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

    // Author cache methods
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

      logger.info('database', 'authors_seeded', { count: authors.length });
    },

    // Reply logging
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

      logger.info('database', 'reply_recorded', {
        tweetId: log.tweetId,
        authorId: log.authorId,
        success: log.success,
      });
    },

    // Lifecycle methods
    async initialize(): Promise<void> {
      // Already initialized in initDatabase()
    },

    async close(): Promise<void> {
      if (dbInstance) {
        dbInstance.close();
        dbInstance = null;
        logger.info('database', 'closed');
      }
    },
  };
}

/**
 * Get the raw database instance (for testing/advanced usage)
 */
export function getRawDatabase(): BunDatabase | null {
  return dbInstance;
}
