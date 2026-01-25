/**
 * E2E Test: Full Pipeline with Mocks
 *
 * Tests the complete pipeline flow: Search -> Filter -> Generate -> Reply -> Record
 *
 * All external dependencies are mocked:
 * - Bird search (returns sample tweets)
 * - Bird getUserByScreenName (returns follower counts)
 * - Manus API (createTask, pollTask, downloadPdf)
 * - PDF converter (returns mock PNG bytes)
 * - Bird uploadMedia and reply
 *
 * Uses real in-memory SQLite for database verification.
 */

import { Database as BunDatabase } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type {
  AuthorCacheEntry,
  CircuitBreakerState,
  CircuitBreakerUpdate,
  Config,
  Database,
  GeneratorResult,
  ManusTaskResponse,
  ManusTaskResult,
  PollerResult,
  PollOptions,
  RateLimitState,
  ReplyLogEntry,
  ResponderResult,
  SeedAuthor,
  TweetCandidate,
} from '../../types.js';

// =============================================================================
// Test Database Setup (Real In-Memory SQLite)
// =============================================================================

/**
 * Create an in-memory database for testing
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

  // Initialize rate_limits singleton
  db.run(`
    INSERT INTO rate_limits (id, daily_count, daily_reset_at, circuit_breaker_state, circuit_breaker_failures)
    VALUES (1, 0, datetime('now', 'start of day', '+1 day'), 'closed', 0)
  `);

  // Create database interface
  const dbInterface: Database = {
    async hasRepliedToTweet(tweetId: string): Promise<boolean> {
      const result = db.query('SELECT 1 FROM replied_tweets WHERE tweet_id = ?').get(tweetId);
      return result !== null;
    },

    async getRepliesForAuthorToday(authorId: string): Promise<number> {
      const result = db
        .query(`
        SELECT COUNT(*) as count FROM replied_tweets
        WHERE author_id = ? AND replied_at > datetime('now', '-24 hours')
      `)
        .get(authorId) as { count: number } | null;
      return result?.count ?? 0;
    },

    async getRateLimitState(): Promise<RateLimitState> {
      await this.resetDailyCountIfNeeded();
      const row = db
        .query(`
        SELECT daily_count, last_reply_at, daily_reset_at FROM rate_limits WHERE id = 1
      `)
        .get() as { daily_count: number; last_reply_at: string | null; daily_reset_at: string } | null;

      return {
        dailyCount: row?.daily_count ?? 0,
        lastReplyAt: row?.last_reply_at ? new Date(row.last_reply_at) : null,
        dailyResetAt: new Date(row?.daily_reset_at ?? new Date()),
      };
    },

    async incrementDailyCount(): Promise<void> {
      db.run('UPDATE rate_limits SET daily_count = daily_count + 1 WHERE id = 1');
    },

    async resetDailyCountIfNeeded(): Promise<void> {
      db.run(`
        UPDATE rate_limits
        SET daily_count = 0, daily_reset_at = datetime('now', 'start of day', '+1 day')
        WHERE id = 1 AND daily_reset_at < datetime('now')
      `);
    },

    async updateLastReplyTime(timestamp: Date): Promise<void> {
      db.run('UPDATE rate_limits SET last_reply_at = ? WHERE id = 1', [timestamp.toISOString()]);
    },

    async getCircuitBreakerState(): Promise<CircuitBreakerState> {
      const row = db
        .query(`
        SELECT circuit_breaker_state, circuit_breaker_failures, circuit_breaker_opened_at
        FROM rate_limits WHERE id = 1
      `)
        .get() as {
        circuit_breaker_state: string;
        circuit_breaker_failures: number;
        circuit_breaker_opened_at: string | null;
      } | null;

      return {
        state: (row?.circuit_breaker_state as 'closed' | 'open' | 'half-open') ?? 'closed',
        failureCount: row?.circuit_breaker_failures ?? 0,
        openedAt: row?.circuit_breaker_opened_at ? new Date(row.circuit_breaker_opened_at) : null,
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
        values.push(update.openedAt?.toISOString() ?? null);
      }

      if (setClauses.length > 0) {
        db.run(`UPDATE rate_limits SET ${setClauses.join(', ')} WHERE id = 1`, values);
      }
    },

    async recordManusFailure(): Promise<void> {
      db.run('UPDATE rate_limits SET circuit_breaker_failures = circuit_breaker_failures + 1 WHERE id = 1');
    },

    async recordManusSuccess(): Promise<void> {
      db.run(`
        UPDATE rate_limits SET circuit_breaker_failures = 0, circuit_breaker_state = 'closed', circuit_breaker_opened_at = NULL
        WHERE id = 1
      `);
    },

    async getAuthorCache(authorId: string): Promise<AuthorCacheEntry | null> {
      const row = db
        .query(`
        SELECT author_id, username, name, follower_count, following_count, is_verified, updated_at
        FROM author_cache WHERE author_id = ? AND updated_at > datetime('now', '-24 hours')
      `)
        .get(authorId) as {
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
      db.run(
        `
        INSERT INTO author_cache (author_id, username, name, follower_count, following_count, is_verified, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(author_id) DO UPDATE SET
          username = excluded.username, name = excluded.name, follower_count = excluded.follower_count,
          following_count = excluded.following_count, is_verified = excluded.is_verified, updated_at = datetime('now')
      `,
        [
          author.authorId,
          author.username,
          author.name,
          author.followerCount,
          author.followingCount,
          author.isVerified ? 1 : 0,
        ],
      );
    },

    async seedAuthorsFromJson(authors: SeedAuthor[]): Promise<void> {
      for (const author of authors) {
        db.run(
          `
          INSERT INTO author_cache (author_id, username, name, follower_count, following_count, is_verified, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(author_id) DO UPDATE SET username = excluded.username, name = excluded.name,
            follower_count = excluded.follower_count, updated_at = datetime('now')
        `,
          [
            author.authorId,
            author.username,
            author.name,
            author.followerCount,
            author.followingCount ?? 0,
            author.isVerified ? 1 : 0,
          ],
        );
      }
    },

    async recordReply(log: ReplyLogEntry): Promise<void> {
      db.run(
        `
        INSERT INTO replied_tweets (tweet_id, author_id, author_username, tweet_text, tweet_created_at,
          reply_tweet_id, success, error_message, manus_task_id, manus_duration_ms, png_size_bytes, reply_template_index)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
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
        ],
      );
    },

    async initialize(): Promise<void> {},
    async close(): Promise<void> {
      db.close();
    },
  };

  return { db, interface: dbInterface };
}

// =============================================================================
// Mock Data Factories
// =============================================================================

/**
 * Create a sample tweet candidate
 */
function createSampleTweet(overrides: Partial<TweetCandidate> = {}): TweetCandidate {
  return {
    id: `tweet_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    text: 'This is a really interesting thread about AI agents and their potential to transform software development workflows. The future of autonomous coding assistants is here.',
    authorId: 'author_123',
    authorUsername: 'ai_enthusiast',
    createdAt: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
    language: 'en',
    isRetweet: false,
    ...overrides,
  };
}

/**
 * Create sample config
 */
function createTestConfig(): Config {
  return {
    bird: {
      cookieSource: 'safari',
    },
    manus: {
      apiKey: 'test_api_key',
      apiBase: 'https://api.manus.ai/v1',
      timeoutMs: 120000,
    },
    rateLimits: {
      maxDailyReplies: 15,
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
    database: {
      path: ':memory:',
    },
    logging: {
      level: 'info',
    },
    features: {
      dryRun: true,
    },
  };
}

/**
 * Create sample PNG bytes (fake PNG header + data)
 */
function createSamplePng(): Uint8Array {
  // PNG signature (8 bytes) + IHDR chunk (25 bytes minimum)
  const pngSignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // Create a simple fake PNG with additional data
  const fakeData = new Uint8Array(1024);
  for (let i = 0; i < fakeData.length; i++) {
    fakeData[i] = (i * 7) % 256;
  }
  // Combine signature and data
  const result = new Uint8Array(pngSignature.length + fakeData.length);
  result.set(pngSignature, 0);
  result.set(fakeData, pngSignature.length);
  return result;
}

/**
 * Create sample PDF bytes (fake PDF header)
 */
function createSamplePdf(): Uint8Array {
  const pdfHeader = '%PDF-1.4\n';
  const encoder = new TextEncoder();
  const headerBytes = encoder.encode(pdfHeader);
  const fakeData = new Uint8Array(2048);
  for (let i = 0; i < fakeData.length; i++) {
    fakeData[i] = (i * 11) % 256;
  }
  const result = new Uint8Array(headerBytes.length + fakeData.length);
  result.set(headerBytes, 0);
  result.set(fakeData, headerBytes.length);
  return result;
}

// =============================================================================
// Mock Classes
// =============================================================================

/**
 * Mock Poller that returns predefined tweets
 */
class MockPoller {
  private mockTweets: TweetCandidate[] = [];

  setMockTweets(tweets: TweetCandidate[]): void {
    this.mockTweets = tweets;
  }

  async search(_query: string, count: number): Promise<PollerResult> {
    return {
      success: true,
      tweets: this.mockTweets.slice(0, count),
    };
  }
}

/**
 * Mock Manus Client
 */
class MockManusClient {
  public createTaskCalls: string[] = [];
  public pollTaskCalls: string[] = [];
  public downloadPdfCalls: string[] = [];

  private mockPdf: Uint8Array = createSamplePdf();
  private shouldFail: boolean = false;
  private failMessage: string = '';

  setShouldFail(fail: boolean, message: string = 'Manus error'): void {
    this.shouldFail = fail;
    this.failMessage = message;
  }

  async createTask(prompt: string): Promise<ManusTaskResponse> {
    this.createTaskCalls.push(prompt);
    if (this.shouldFail) {
      throw new Error(this.failMessage);
    }
    return {
      taskId: `task_${Date.now()}`,
      taskUrl: 'https://manus.ai/task/123',
      shareUrl: 'https://manus.ai/share/123',
    };
  }

  async pollTask(taskId: string, _options?: PollOptions): Promise<ManusTaskResult | null> {
    this.pollTaskCalls.push(taskId);
    if (this.shouldFail) {
      return {
        status: 'failed',
        error: this.failMessage,
      };
    }
    return {
      status: 'completed',
      outputUrl: 'https://manus.ai/output/123.pdf',
    };
  }

  async downloadPdf(url: string): Promise<Uint8Array> {
    this.downloadPdfCalls.push(url);
    if (this.shouldFail) {
      throw new Error(this.failMessage);
    }
    return this.mockPdf;
  }
}

/**
 * Mock PDF Converter
 */
class MockPdfConverter {
  public convertCalls: number = 0;
  public compressCalls: number = 0;
  private mockPng: Uint8Array = createSamplePng();

  async convertToPng(
    _pdf: Uint8Array,
    _options?: { width?: number; dpi?: number; quality?: number },
  ): Promise<Uint8Array> {
    this.convertCalls++;
    return this.mockPng;
  }

  async compress(png: Uint8Array, _quality: number): Promise<Uint8Array> {
    this.compressCalls++;
    return png;
  }
}

/**
 * Mock Generator using mock Manus client and PDF converter
 */
class MockGenerator {
  private manusClient: MockManusClient;
  private pdfConverter: MockPdfConverter;
  private shouldFail: boolean = false;
  private failError: string = '';

  constructor(manusClient: MockManusClient, pdfConverter: MockPdfConverter) {
    this.manusClient = manusClient;
    this.pdfConverter = pdfConverter;
  }

  setShouldFail(fail: boolean, error: string = 'Generation failed'): void {
    this.shouldFail = fail;
    this.failError = error;
  }

  async generate(tweet: TweetCandidate): Promise<GeneratorResult> {
    if (this.shouldFail) {
      return {
        success: false,
        error: this.failError,
      };
    }

    try {
      // Simulate full pipeline
      const taskResponse = await this.manusClient.createTask(`Generate summary for @${tweet.authorUsername}`);
      const taskResult = await this.manusClient.pollTask(taskResponse.taskId);

      if (!taskResult || taskResult.status !== 'completed' || !taskResult.outputUrl) {
        return {
          success: false,
          error: taskResult?.error ?? 'Task did not complete',
          manusTaskId: taskResponse.taskId,
        };
      }

      const pdfBytes = await this.manusClient.downloadPdf(taskResult.outputUrl);
      const pngBytes = await this.pdfConverter.convertToPng(pdfBytes);

      return {
        success: true,
        png: pngBytes,
        manusTaskId: taskResponse.taskId,
        manusDuration: 5000,
        pngSize: pngBytes.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * Mock Responder
 */
class MockResponder {
  public replyCalls: Array<{ tweet: TweetCandidate; png: Uint8Array }> = [];
  private shouldFail: boolean = false;
  private failError: string = '';
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  async initialize(): Promise<void> {}

  setShouldFail(fail: boolean, error: string = 'Reply failed'): void {
    this.shouldFail = fail;
    this.failError = error;
  }

  async reply(tweet: TweetCandidate, png: Uint8Array): Promise<ResponderResult> {
    this.replyCalls.push({ tweet, png });

    if (this.shouldFail) {
      return {
        success: false,
        error: this.failError,
      };
    }

    // In dry-run mode, return fake success
    if (this.config.features.dryRun) {
      return {
        success: true,
        replyTweetId: `DRY_RUN_${Date.now()}`,
        templateUsed: Math.floor(Math.random() * 7),
      };
    }

    return {
      success: true,
      replyTweetId: `reply_${Date.now()}`,
      templateUsed: 0,
    };
  }
}

// =============================================================================
// Pipeline Executor (Simplified orchestrator for testing)
// =============================================================================

interface PipelineComponents {
  poller: MockPoller;
  db: Database;
  generator: MockGenerator;
  responder: MockResponder;
  config: Config;
}

interface PipelineResult {
  status: 'processed' | 'no_eligible' | 'error';
  tweetId?: string;
  author?: string;
  replyTweetId?: string;
  error?: string;
}

/**
 * Execute a single pipeline cycle
 * Mimics the Orchestrator.runCycle() logic
 */
async function executePipelineCycle(components: PipelineComponents): Promise<PipelineResult> {
  const { poller, db, generator, responder, config } = components;

  try {
    // Step 1: Search for tweets
    const searchResult = await poller.search(config.polling.searchQuery, config.polling.resultsPerQuery);

    if (!searchResult.success) {
      return { status: 'error', error: searchResult.error };
    }

    // Step 2: Filter candidates
    // Simplified filter - just find first eligible
    let eligible: TweetCandidate | null = null;

    for (const tweet of searchResult.tweets) {
      // Content filters
      if (tweet.text.length < config.filters.minTweetLength) {
        continue;
      }
      if (tweet.language !== 'en') {
        continue;
      }
      if (tweet.isRetweet) {
        continue;
      }

      const ageMinutes = (Date.now() - tweet.createdAt.getTime()) / (1000 * 60);
      if (ageMinutes > config.filters.maxTweetAgeMinutes) {
        continue;
      }

      // Deduplication
      const hasReplied = await db.hasRepliedToTweet(tweet.id);
      if (hasReplied) {
        continue;
      }

      const authorReplies = await db.getRepliesForAuthorToday(tweet.authorId);
      if (authorReplies >= config.rateLimits.maxPerAuthorPerDay) {
        continue;
      }

      // Follower check (using cache)
      const cached = await db.getAuthorCache(tweet.authorId);
      if (!cached) {
        // In E2E test, we'll pre-seed the cache
        continue;
      }
      if (cached.followerCount < config.filters.minFollowerCount) {
        continue;
      }

      // Rate limit check
      const rateLimits = await db.getRateLimitState();
      if (rateLimits.dailyCount >= config.rateLimits.maxDailyReplies) {
        continue;
      }

      if (rateLimits.lastReplyAt) {
        const gapMinutes = (Date.now() - rateLimits.lastReplyAt.getTime()) / (1000 * 60);
        if (gapMinutes < config.rateLimits.minGapMinutes) {
          continue;
        }
      }

      eligible = tweet;
      break;
    }

    if (!eligible) {
      return { status: 'no_eligible' };
    }

    // Step 3: Generate PNG
    const generateResult = await generator.generate(eligible);

    if (!generateResult.success || !generateResult.png) {
      // Record failed attempt
      await db.recordReply({
        tweetId: eligible.id,
        authorId: eligible.authorId,
        authorUsername: eligible.authorUsername,
        tweetText: eligible.text,
        tweetCreatedAt: eligible.createdAt,
        replyTweetId: null,
        success: false,
        errorMessage: `Generation failed: ${generateResult.error}`,
        manusTaskId: generateResult.manusTaskId,
        manusDuration: generateResult.manusDuration,
      });

      return { status: 'error', error: generateResult.error };
    }

    // Step 4: Reply
    const replyResult = await responder.reply(eligible, generateResult.png);

    if (!replyResult.success) {
      await db.recordReply({
        tweetId: eligible.id,
        authorId: eligible.authorId,
        authorUsername: eligible.authorUsername,
        tweetText: eligible.text,
        tweetCreatedAt: eligible.createdAt,
        replyTweetId: null,
        success: false,
        errorMessage: `Reply failed: ${replyResult.error}`,
        manusTaskId: generateResult.manusTaskId,
        manusDuration: generateResult.manusDuration,
        pngSize: generateResult.pngSize,
      });

      return { status: 'error', error: replyResult.error };
    }

    // Step 5: Record success
    await db.recordReply({
      tweetId: eligible.id,
      authorId: eligible.authorId,
      authorUsername: eligible.authorUsername,
      tweetText: eligible.text,
      tweetCreatedAt: eligible.createdAt,
      replyTweetId: replyResult.replyTweetId ?? null,
      success: true,
      manusTaskId: generateResult.manusTaskId,
      manusDuration: generateResult.manusDuration,
      pngSize: generateResult.pngSize,
      templateIndex: replyResult.templateUsed,
    });

    await db.incrementDailyCount();
    await db.updateLastReplyTime(new Date());

    return {
      status: 'processed',
      tweetId: eligible.id,
      author: eligible.authorUsername,
      replyTweetId: replyResult.replyTweetId,
    };
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// =============================================================================
// E2E Tests
// =============================================================================

describe('E2E: Full Pipeline with Mocks', () => {
  let testDb: { db: BunDatabase; interface: Database };
  let config: Config;
  let poller: MockPoller;
  let manusClient: MockManusClient;
  let pdfConverter: MockPdfConverter;
  let generator: MockGenerator;
  let responder: MockResponder;

  beforeEach(async () => {
    // Create fresh test database
    testDb = createTestDatabase();
    config = createTestConfig();

    // Create mock components
    poller = new MockPoller();
    manusClient = new MockManusClient();
    pdfConverter = new MockPdfConverter();
    generator = new MockGenerator(manusClient, pdfConverter);
    responder = new MockResponder(config);

    // Pre-seed author cache with a high-follower author
    await testDb.interface.upsertAuthorCache({
      authorId: 'author_123',
      username: 'ai_enthusiast',
      name: 'AI Enthusiast',
      followerCount: 100000,
      followingCount: 500,
      isVerified: true,
      updatedAt: new Date(),
    });
  });

  afterEach(async () => {
    await testDb.interface.close();
  });

  describe('Full cycle execution', () => {
    it('should process a tweet through the full pipeline', async () => {
      // Setup: Provide sample tweets
      const sampleTweet = createSampleTweet();
      poller.setMockTweets([sampleTweet]);

      // Execute pipeline
      const result = await executePipelineCycle({
        poller,
        db: testDb.interface,
        generator,
        responder,
        config,
      });

      // Verify success
      expect(result.status).toBe('processed');
      expect(result.tweetId).toBe(sampleTweet.id);
      expect(result.author).toBe(sampleTweet.authorUsername);
      expect(result.replyTweetId).toBeDefined();
      expect(result.replyTweetId).toContain('DRY_RUN');

      // Verify all components were called
      expect(manusClient.createTaskCalls.length).toBe(1);
      expect(manusClient.pollTaskCalls.length).toBe(1);
      expect(manusClient.downloadPdfCalls.length).toBe(1);
      expect(pdfConverter.convertCalls).toBe(1);
      expect(responder.replyCalls.length).toBe(1);
    });

    it('should create DB entry after successful reply', async () => {
      const sampleTweet = createSampleTweet();
      poller.setMockTweets([sampleTweet]);

      await executePipelineCycle({
        poller,
        db: testDb.interface,
        generator,
        responder,
        config,
      });

      // Verify DB entry
      const hasReplied = await testDb.interface.hasRepliedToTweet(sampleTweet.id);
      expect(hasReplied).toBe(true);

      // Verify rate limit was updated
      const rateLimits = await testDb.interface.getRateLimitState();
      expect(rateLimits.dailyCount).toBe(1);
      expect(rateLimits.lastReplyAt).not.toBeNull();
    });

    it('should increment daily count after each reply', async () => {
      // Process first tweet
      const tweet1 = createSampleTweet({ id: 'tweet_1', authorId: 'author_1' });
      await testDb.interface.upsertAuthorCache({
        authorId: 'author_1',
        username: 'user1',
        name: 'User 1',
        followerCount: 100000,
        followingCount: 500,
        isVerified: false,
        updatedAt: new Date(),
      });
      poller.setMockTweets([tweet1]);

      await executePipelineCycle({
        poller,
        db: testDb.interface,
        generator,
        responder,
        config,
      });

      let rateLimits = await testDb.interface.getRateLimitState();
      expect(rateLimits.dailyCount).toBe(1);

      // Process second tweet (different author to avoid per-author limit)
      const tweet2 = createSampleTweet({ id: 'tweet_2', authorId: 'author_2' });
      await testDb.interface.upsertAuthorCache({
        authorId: 'author_2',
        username: 'user2',
        name: 'User 2',
        followerCount: 200000,
        followingCount: 1000,
        isVerified: true,
        updatedAt: new Date(),
      });

      // Clear last reply time to avoid gap check
      testDb.db.run('UPDATE rate_limits SET last_reply_at = NULL WHERE id = 1');

      poller.setMockTweets([tweet2]);

      await executePipelineCycle({
        poller,
        db: testDb.interface,
        generator,
        responder,
        config,
      });

      rateLimits = await testDb.interface.getRateLimitState();
      expect(rateLimits.dailyCount).toBe(2);
    });
  });

  describe('Filter stage verification', () => {
    it('should skip tweets that are too short', async () => {
      const shortTweet = createSampleTweet({ text: 'Too short' });
      poller.setMockTweets([shortTweet]);

      const result = await executePipelineCycle({
        poller,
        db: testDb.interface,
        generator,
        responder,
        config,
      });

      expect(result.status).toBe('no_eligible');
      expect(manusClient.createTaskCalls.length).toBe(0);
    });

    it('should skip tweets from low-follower accounts', async () => {
      // Add low-follower author to cache
      await testDb.interface.upsertAuthorCache({
        authorId: 'low_follower_author',
        username: 'smallaccount',
        name: 'Small Account',
        followerCount: 1000, // Below 50000 threshold
        followingCount: 500,
        isVerified: false,
        updatedAt: new Date(),
      });

      const lowFollowerTweet = createSampleTweet({
        authorId: 'low_follower_author',
        authorUsername: 'smallaccount',
      });
      poller.setMockTweets([lowFollowerTweet]);

      const result = await executePipelineCycle({
        poller,
        db: testDb.interface,
        generator,
        responder,
        config,
      });

      expect(result.status).toBe('no_eligible');
    });

    it('should skip already replied tweets (deduplication)', async () => {
      const sampleTweet = createSampleTweet();

      // Record a reply to this tweet first
      await testDb.interface.recordReply({
        tweetId: sampleTweet.id,
        authorId: sampleTweet.authorId,
        authorUsername: sampleTweet.authorUsername,
        tweetText: sampleTweet.text,
        tweetCreatedAt: sampleTweet.createdAt,
        replyTweetId: 'previous_reply',
        success: true,
      });

      poller.setMockTweets([sampleTweet]);

      const result = await executePipelineCycle({
        poller,
        db: testDb.interface,
        generator,
        responder,
        config,
      });

      expect(result.status).toBe('no_eligible');
    });

    it('should skip when daily rate limit is reached', async () => {
      // Set daily count to max
      for (let i = 0; i < 15; i++) {
        await testDb.interface.incrementDailyCount();
      }

      const sampleTweet = createSampleTweet();
      poller.setMockTweets([sampleTweet]);

      const result = await executePipelineCycle({
        poller,
        db: testDb.interface,
        generator,
        responder,
        config,
      });

      expect(result.status).toBe('no_eligible');
    });

    it('should skip when minimum gap not met', async () => {
      // Set last reply time to just now
      await testDb.interface.updateLastReplyTime(new Date());

      const sampleTweet = createSampleTweet();
      poller.setMockTweets([sampleTweet]);

      const result = await executePipelineCycle({
        poller,
        db: testDb.interface,
        generator,
        responder,
        config,
      });

      expect(result.status).toBe('no_eligible');
    });

    it('should skip retweets', async () => {
      const retweet = createSampleTweet({ isRetweet: true });
      poller.setMockTweets([retweet]);

      const result = await executePipelineCycle({
        poller,
        db: testDb.interface,
        generator,
        responder,
        config,
      });

      expect(result.status).toBe('no_eligible');
    });

    it('should skip old tweets', async () => {
      const oldTweet = createSampleTweet({
        createdAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
      });
      poller.setMockTweets([oldTweet]);

      const result = await executePipelineCycle({
        poller,
        db: testDb.interface,
        generator,
        responder,
        config,
      });

      expect(result.status).toBe('no_eligible');
    });
  });

  describe('Generator stage verification', () => {
    it('should call Manus API with correct sequence', async () => {
      const sampleTweet = createSampleTweet();
      poller.setMockTweets([sampleTweet]);

      await executePipelineCycle({
        poller,
        db: testDb.interface,
        generator,
        responder,
        config,
      });

      // Verify Manus API call sequence
      expect(manusClient.createTaskCalls.length).toBe(1);
      expect(manusClient.createTaskCalls[0]).toContain('@ai_enthusiast');
      expect(manusClient.pollTaskCalls.length).toBe(1);
      expect(manusClient.downloadPdfCalls.length).toBe(1);
    });

    it('should handle generation failure gracefully', async () => {
      const sampleTweet = createSampleTweet();
      poller.setMockTweets([sampleTweet]);
      generator.setShouldFail(true, 'Manus API timeout');

      const result = await executePipelineCycle({
        poller,
        db: testDb.interface,
        generator,
        responder,
        config,
      });

      expect(result.status).toBe('error');
      expect(result.error).toContain('Manus API timeout');

      // Verify failed reply was recorded
      const hasReplied = await testDb.interface.hasRepliedToTweet(sampleTweet.id);
      expect(hasReplied).toBe(true);
    });

    it('should record failed attempt in DB on generation error', async () => {
      const sampleTweet = createSampleTweet();
      poller.setMockTweets([sampleTweet]);
      generator.setShouldFail(true, 'PDF conversion error');

      await executePipelineCycle({
        poller,
        db: testDb.interface,
        generator,
        responder,
        config,
      });

      // Query DB directly to check the error was recorded
      const row = testDb.db
        .query('SELECT success, error_message FROM replied_tweets WHERE tweet_id = ?')
        .get(sampleTweet.id) as {
        success: number;
        error_message: string;
      };

      expect(row).toBeDefined();
      expect(row.success).toBe(0); // Failed
      expect(row.error_message).toContain('Generation failed');
    });
  });

  describe('Responder stage verification', () => {
    it('should call responder with correct tweet and PNG', async () => {
      const sampleTweet = createSampleTweet();
      poller.setMockTweets([sampleTweet]);

      await executePipelineCycle({
        poller,
        db: testDb.interface,
        generator,
        responder,
        config,
      });

      expect(responder.replyCalls.length).toBe(1);
      expect(responder.replyCalls[0].tweet.id).toBe(sampleTweet.id);
      expect(responder.replyCalls[0].png).toBeInstanceOf(Uint8Array);
      expect(responder.replyCalls[0].png.length).toBeGreaterThan(0);
    });

    it('should handle reply failure gracefully', async () => {
      const sampleTweet = createSampleTweet();
      poller.setMockTweets([sampleTweet]);
      responder.setShouldFail(true, 'Twitter API error');

      const result = await executePipelineCycle({
        poller,
        db: testDb.interface,
        generator,
        responder,
        config,
      });

      expect(result.status).toBe('error');
      expect(result.error).toContain('Twitter API error');
    });

    it('should record failed reply in DB', async () => {
      const sampleTweet = createSampleTweet();
      poller.setMockTweets([sampleTweet]);
      responder.setShouldFail(true, 'Upload failed');

      await executePipelineCycle({
        poller,
        db: testDb.interface,
        generator,
        responder,
        config,
      });

      const row = testDb.db
        .query('SELECT success, error_message FROM replied_tweets WHERE tweet_id = ?')
        .get(sampleTweet.id) as {
        success: number;
        error_message: string;
      };

      expect(row).toBeDefined();
      expect(row.success).toBe(0);
      expect(row.error_message).toContain('Reply failed');
    });
  });

  describe('Dry-run mode verification', () => {
    it('should use DRY_RUN prefix in reply ID', async () => {
      const sampleTweet = createSampleTweet();
      poller.setMockTweets([sampleTweet]);

      const result = await executePipelineCycle({
        poller,
        db: testDb.interface,
        generator,
        responder,
        config,
      });

      expect(result.status).toBe('processed');
      expect(result.replyTweetId).toContain('DRY_RUN');
    });

    it('should still record reply in DB during dry-run', async () => {
      const sampleTweet = createSampleTweet();
      poller.setMockTweets([sampleTweet]);

      await executePipelineCycle({
        poller,
        db: testDb.interface,
        generator,
        responder,
        config,
      });

      const row = testDb.db
        .query('SELECT reply_tweet_id FROM replied_tweets WHERE tweet_id = ?')
        .get(sampleTweet.id) as {
        reply_tweet_id: string;
      };

      expect(row).toBeDefined();
      expect(row.reply_tweet_id).toContain('DRY_RUN');
    });
  });

  describe('DB state after cycle', () => {
    it('should have correct replied_tweets entry after success', async () => {
      const sampleTweet = createSampleTweet();
      poller.setMockTweets([sampleTweet]);

      await executePipelineCycle({
        poller,
        db: testDb.interface,
        generator,
        responder,
        config,
      });

      const row = testDb.db
        .query(`
        SELECT tweet_id, author_id, author_username, success, manus_task_id, png_size_bytes
        FROM replied_tweets WHERE tweet_id = ?
      `)
        .get(sampleTweet.id) as {
        tweet_id: string;
        author_id: string;
        author_username: string;
        success: number;
        manus_task_id: string;
        png_size_bytes: number;
      };

      expect(row).toBeDefined();
      expect(row.tweet_id).toBe(sampleTweet.id);
      expect(row.author_id).toBe(sampleTweet.authorId);
      expect(row.author_username).toBe(sampleTweet.authorUsername);
      expect(row.success).toBe(1);
      expect(row.manus_task_id).toBeDefined();
      expect(row.png_size_bytes).toBeGreaterThan(0);
    });

    it('should update rate_limits after success', async () => {
      const sampleTweet = createSampleTweet();
      poller.setMockTweets([sampleTweet]);

      const beforeState = await testDb.interface.getRateLimitState();
      expect(beforeState.dailyCount).toBe(0);

      await executePipelineCycle({
        poller,
        db: testDb.interface,
        generator,
        responder,
        config,
      });

      const afterState = await testDb.interface.getRateLimitState();
      expect(afterState.dailyCount).toBe(1);
      expect(afterState.lastReplyAt).not.toBeNull();
    });
  });

  describe('Multiple candidates handling', () => {
    it('should process first eligible tweet from multiple candidates', async () => {
      // Create tweets: first ineligible (short), second eligible
      const shortTweet = createSampleTweet({ id: 'short_1', text: 'Short' });
      const eligibleTweet = createSampleTweet({ id: 'eligible_1' });

      poller.setMockTweets([shortTweet, eligibleTweet]);

      const result = await executePipelineCycle({
        poller,
        db: testDb.interface,
        generator,
        responder,
        config,
      });

      expect(result.status).toBe('processed');
      expect(result.tweetId).toBe('eligible_1');
    });

    it('should return no_eligible when all candidates filtered out', async () => {
      const shortTweet1 = createSampleTweet({ id: 'short_1', text: 'Too short 1' });
      const shortTweet2 = createSampleTweet({ id: 'short_2', text: 'Too short 2' });

      poller.setMockTweets([shortTweet1, shortTweet2]);

      const result = await executePipelineCycle({
        poller,
        db: testDb.interface,
        generator,
        responder,
        config,
      });

      expect(result.status).toBe('no_eligible');
    });
  });

  describe('Empty search results', () => {
    it('should handle empty search results gracefully', async () => {
      poller.setMockTweets([]);

      const result = await executePipelineCycle({
        poller,
        db: testDb.interface,
        generator,
        responder,
        config,
      });

      expect(result.status).toBe('no_eligible');
      expect(manusClient.createTaskCalls.length).toBe(0);
    });
  });
});
