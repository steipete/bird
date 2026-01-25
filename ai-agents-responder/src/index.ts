/**
 * Main orchestrator for AI Agents Twitter Auto-Responder
 *
 * Runs the poll loop every 60s:
 * 1. Search for tweets via poller
 * 2. Filter candidates
 * 3. Generate PNG summary via Manus
 * 4. Reply to tweet with PNG attachment
 * 5. Record reply and update rate limits
 */

import { loadConfig } from './config.js';
import { initDatabase } from './database.js';
import { FilterPipeline } from './filter.js';
import { Generator } from './generator.js';
import { logger } from './logger.js';
import { Poller } from './poller.js';
import { Responder } from './responder.js';
import type { Config, CycleResult, Database, GeneratorResult, PollerResult, ReplyLogEntry } from './types.js';
import { executeWithCircuitBreaker } from './utils/circuit-breaker.js';
import { classifyError } from './utils/errors.js';
import { RETRY_CONFIGS, retry } from './utils/retry.js';

/**
 * Main orchestrator class
 */
class Orchestrator {
  private config: Config;
  private db: Database | null = null;
  private poller: Poller;
  private filter: FilterPipeline;
  private generator: Generator;
  private responder: Responder;
  private running: boolean = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private currentCyclePromise: Promise<CycleResult> | null = null;

  constructor() {
    // Load config (validates and exits on error)
    this.config = loadConfig();
    this.poller = new Poller();
    this.filter = new FilterPipeline();
    this.generator = new Generator();
    this.responder = new Responder(this.config);
  }

  /**
   * Initialize all components
   */
  private async initialize(): Promise<void> {
    logger.info('orchestrator', 'initializing', {
      dryRun: this.config.features.dryRun,
      pollIntervalSeconds: this.config.polling.intervalSeconds,
    });

    // Initialize database
    this.db = await initDatabase();

    // Initialize filter pipeline
    await this.filter.initialize();

    // Initialize responder (sets up Bird client if not dry-run)
    await this.responder.initialize();

    logger.info('orchestrator', 'initialized', {});
  }

  /**
   * Run a single poll cycle
   */
  async runCycle(): Promise<CycleResult> {
    const startTime = Date.now();

    logger.info('orchestrator', 'cycle_start', {
      timestamp: new Date().toISOString(),
    });

    try {
      // Step 1: Search for tweets (with retry)
      let searchResult: PollerResult;
      try {
        searchResult = await retry(
          () => this.poller.search(this.config.polling.searchQuery, this.config.polling.resultsPerQuery),
          RETRY_CONFIGS.birdSearch,
          'birdSearch',
        );
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorClass = classifyError(error);
        logger.warn('orchestrator', 'search_failed', {
          error: errorClass.message,
          isAuthError: errorClass.isAuth,
          durationMs: duration,
        });

        // Exit on auth errors - can't operate without valid credentials
        if (errorClass.isAuth) {
          logger.error('orchestrator', 'auth_error_exit', error as Error, {
            reason: 'Search authentication failed - credentials may be expired',
            durationMs: duration,
          });
          process.exit(1);
        }

        return {
          status: 'error',
          duration,
          error: errorClass.message,
        };
      }

      if (!searchResult.success) {
        const duration = Date.now() - startTime;
        const searchErrorClass = classifyError(searchResult.error);
        logger.warn('orchestrator', 'search_failed', {
          error: searchResult.error,
          isAuthError: searchErrorClass.isAuth,
          durationMs: duration,
        });

        // Exit on auth errors
        if (searchErrorClass.isAuth) {
          logger.error('orchestrator', 'auth_error_exit', new Error(searchResult.error), {
            reason: 'Search authentication failed - credentials may be expired',
            durationMs: duration,
          });
          process.exit(1);
        }

        return {
          status: 'error',
          duration,
          error: searchResult.error,
        };
      }

      logger.info('orchestrator', 'search_complete', {
        resultCount: searchResult.tweets.length,
      });

      // Step 2: Filter candidates
      const filterResult = await this.filter.filter(searchResult.tweets);

      if (!filterResult.eligible) {
        const duration = Date.now() - startTime;
        logger.info('orchestrator', 'no_eligible_tweets', {
          total: filterResult.stats.total,
          rejected:
            filterResult.stats.rejectedContent +
            filterResult.stats.rejectedDuplicate +
            filterResult.stats.rejectedFollowers +
            filterResult.stats.rejectedRateLimit,
          durationMs: duration,
        });
        return {
          status: 'no_eligible',
          duration,
        };
      }

      const eligible = filterResult.eligible;
      logger.info('orchestrator', 'eligible_tweet_found', {
        tweetId: eligible.id,
        author: eligible.authorUsername,
        textPreview: `${eligible.text.substring(0, 100)}...`,
      });

      // Step 3: Generate PNG summary via Manus (with circuit breaker)
      logger.info('orchestrator', 'generating_summary', {
        tweetId: eligible.id,
      });

      // Check circuit breaker state and execute generation
      let generateResult: GeneratorResult | null;
      try {
        if (!this.db) {
          throw new Error('Database not initialized');
        }
        generateResult = await executeWithCircuitBreaker(() => this.generator.generate(eligible), this.db);
      } catch (error) {
        // Circuit breaker recorded the failure, now handle the error
        const duration = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('orchestrator', 'generation_failed', error as Error, {
          tweetId: eligible.id,
          author: eligible.authorUsername,
          durationMs: duration,
        });

        // Record failed attempt
        if (this.db) {
          const logEntry: ReplyLogEntry = {
            tweetId: eligible.id,
            authorId: eligible.authorId,
            authorUsername: eligible.authorUsername,
            tweetText: eligible.text,
            tweetCreatedAt: eligible.createdAt,
            replyTweetId: null,
            success: false,
            errorMessage: `Generation failed: ${errorMessage}`,
          };
          await this.db.recordReply(logEntry);
        }

        return {
          status: 'error',
          duration,
          error: `Generation failed: ${errorMessage}`,
        };
      }

      // Circuit breaker is open - skip this cycle
      if (generateResult === null) {
        const duration = Date.now() - startTime;
        logger.warn('orchestrator', 'circuit_breaker_open', {
          tweetId: eligible.id,
          author: eligible.authorUsername,
          durationMs: duration,
        });
        return {
          status: 'error',
          duration,
          error: 'Circuit breaker open - Manus API temporarily unavailable',
        };
      }

      if (!generateResult.success || !generateResult.png) {
        const duration = Date.now() - startTime;
        logger.error(
          'orchestrator',
          'generation_failed',
          new Error(generateResult.error || 'Unknown generation error'),
          {
            tweetId: eligible.id,
            author: eligible.authorUsername,
            manusTaskId: generateResult.manusTaskId,
            durationMs: duration,
          },
        );

        // Record failed attempt
        if (this.db) {
          const logEntry: ReplyLogEntry = {
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
          };
          await this.db.recordReply(logEntry);
        }

        return {
          status: 'error',
          duration,
          error: `Generation failed: ${generateResult.error}`,
        };
      }

      logger.info('orchestrator', 'generation_complete', {
        tweetId: eligible.id,
        pngSize: generateResult.pngSize,
        manusDuration: generateResult.manusDuration,
      });

      // Step 4: Reply to tweet with PNG
      logger.info('orchestrator', 'posting_reply', {
        tweetId: eligible.id,
        author: eligible.authorUsername,
      });

      const replyResult = await this.responder.reply(eligible, generateResult.png);

      if (!replyResult.success) {
        const duration = Date.now() - startTime;
        const replyErrorClass = classifyError(replyResult.error);
        logger.error('orchestrator', 'reply_failed', new Error(replyResult.error || 'Unknown reply error'), {
          tweetId: eligible.id,
          author: eligible.authorUsername,
          isAuthError: replyErrorClass.isAuth,
          durationMs: duration,
        });

        // Record failed attempt
        if (this.db) {
          const logEntry: ReplyLogEntry = {
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
          };
          await this.db.recordReply(logEntry);
        }

        // Exit on auth errors - can't post without valid credentials
        if (replyErrorClass.isAuth) {
          logger.error('orchestrator', 'auth_error_exit', new Error(replyResult.error || 'Auth error'), {
            reason: 'Reply authentication failed - credentials may be expired',
            durationMs: duration,
          });
          process.exit(1);
        }

        return {
          status: 'error',
          duration,
          error: `Reply failed: ${replyResult.error}`,
        };
      }

      // Step 5: Record successful reply and update rate limits
      if (this.db) {
        const logEntry: ReplyLogEntry = {
          tweetId: eligible.id,
          authorId: eligible.authorId,
          authorUsername: eligible.authorUsername,
          tweetText: eligible.text,
          tweetCreatedAt: eligible.createdAt,
          replyTweetId: replyResult.replyTweetId || null,
          success: true,
          manusTaskId: generateResult.manusTaskId,
          manusDuration: generateResult.manusDuration,
          pngSize: generateResult.pngSize,
          templateIndex: replyResult.templateUsed,
        };
        await this.db.recordReply(logEntry);
        await this.db.incrementDailyCount();
        await this.db.updateLastReplyTime(new Date());
      }

      const duration = Date.now() - startTime;
      logger.info('orchestrator', 'cycle_complete', {
        status: 'processed',
        tweetId: eligible.id,
        author: eligible.authorUsername,
        replyTweetId: replyResult.replyTweetId,
        templateUsed: replyResult.templateUsed,
        pngSize: generateResult.pngSize,
        durationMs: duration,
      });

      return {
        status: 'processed',
        tweetId: eligible.id,
        author: eligible.authorUsername,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      // Classify the error using error detection utilities
      const errorClass = classifyError(error);

      logger.error('orchestrator', 'cycle_error', error as Error, {
        durationMs: duration,
        isAuthError: errorClass.isAuth,
        isDatabaseError: errorClass.isDatabase,
        isCritical: errorClass.isCritical,
      });

      // Handle auth errors (401/403 from Bird) - critical, exit process
      if (errorClass.isAuth) {
        logger.error('orchestrator', 'auth_error_exit', error as Error, {
          reason: 'Authentication error detected - credentials may be expired or invalid',
          durationMs: duration,
        });
        process.exit(1);
      }

      // Handle database errors (corruption, connection failures)
      if (errorClass.isDatabase && errorClass.isCritical) {
        logger.error('orchestrator', 'database_error_exit', error as Error, {
          reason: 'Critical database error detected - data integrity at risk',
          durationMs: duration,
        });
        process.exit(1);
      }

      // Check for other critical errors that warrant process exit
      if (errorClass.isCritical) {
        logger.error('orchestrator', 'critical_error_exit', error as Error, {
          reason: 'Critical error detected, exiting process',
          durationMs: duration,
        });
        process.exit(1);
      }

      // Non-critical errors: log and return error status (will retry on next cycle)
      return {
        status: 'error',
        duration,
        error: errorClass.message,
      };
    }
  }

  /**
   * Start the poll loop
   */
  async start(): Promise<void> {
    await this.initialize();

    this.running = true;

    logger.info('orchestrator', 'started', {
      intervalSeconds: this.config.polling.intervalSeconds,
    });

    // Run first cycle immediately
    this.currentCyclePromise = this.runCycle();
    await this.currentCyclePromise;

    // Set up interval for subsequent cycles
    const intervalMs = this.config.polling.intervalSeconds * 1000;
    this.intervalId = setInterval(async () => {
      if (!this.running) {
        return;
      }

      this.currentCyclePromise = this.runCycle();
      await this.currentCyclePromise;
    }, intervalMs);
  }

  /**
   * Graceful shutdown handler
   */
  async shutdown(signal: string): Promise<void> {
    logger.info('orchestrator', 'shutdown_initiated', { signal });

    // Stop accepting new cycles
    this.running = false;

    // Clear interval
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Wait for current cycle to complete (with 5 minute timeout)
    if (this.currentCyclePromise) {
      logger.info('orchestrator', 'waiting_for_current_cycle', {});

      const timeoutMs = 5 * 60 * 1000; // 5 minutes
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      await Promise.race([
        this.currentCyclePromise,
        sleep(timeoutMs).then(() => {
          logger.warn('orchestrator', 'cycle_timeout', {
            timeoutMs,
          });
        }),
      ]);
    }

    // Close database connection
    if (this.db) {
      await this.db.close();
    }

    // Close filter pipeline
    await this.filter.close();

    logger.info('orchestrator', 'shutdown_complete', {});

    process.exit(0);
  }
}

// Main entry point
async function main(): Promise<void> {
  const orchestrator = new Orchestrator();

  // Register signal handlers for graceful shutdown
  process.on('SIGTERM', () => {
    orchestrator.shutdown('SIGTERM');
  });

  process.on('SIGINT', () => {
    orchestrator.shutdown('SIGINT');
  });

  // Start the orchestrator
  await orchestrator.start();
}

// Run main
main().catch((error) => {
  logger.error('orchestrator', 'startup_failed', error, {});
  process.exit(1);
});
