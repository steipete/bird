/**
 * Main orchestrator for AI Agents Twitter Auto-Responder
 *
 * Runs the poll loop every 60s:
 * 1. Search for tweets via poller
 * 2. Filter candidates
 * 3. TODO: Generate and reply (next task)
 */

import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { initDatabase } from './database.js';
import { Poller } from './poller.js';
import { FilterPipeline } from './filter.js';
import type { Config, Database, CycleResult } from './types.js';

/**
 * Main orchestrator class
 */
class Orchestrator {
  private config: Config;
  private db: Database | null = null;
  private poller: Poller;
  private filter: FilterPipeline;
  private running: boolean = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private currentCyclePromise: Promise<CycleResult> | null = null;

  constructor() {
    // Load config (validates and exits on error)
    this.config = loadConfig();
    this.poller = new Poller();
    this.filter = new FilterPipeline();
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
      // Step 1: Search for tweets
      const searchResult = await this.poller.search(
        this.config.polling.searchQuery,
        this.config.polling.resultsPerQuery
      );

      if (!searchResult.success) {
        const duration = Date.now() - startTime;
        logger.warn('orchestrator', 'search_failed', {
          error: searchResult.error,
          durationMs: duration,
        });
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
          rejected: filterResult.stats.rejectedContent +
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
        textPreview: eligible.text.substring(0, 100) + '...',
      });

      // TODO: Generate and reply (Task 1.20)
      // For now, just log that we found an eligible tweet
      logger.info('orchestrator', 'todo_generate_and_reply', {
        tweetId: eligible.id,
        note: 'Generation and reply will be implemented in Task 1.20',
      });

      const duration = Date.now() - startTime;
      logger.info('orchestrator', 'cycle_complete', {
        status: 'processed',
        tweetId: eligible.id,
        author: eligible.authorUsername,
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
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('orchestrator', 'cycle_error', error as Error, {
        durationMs: duration,
      });

      return {
        status: 'error',
        duration,
        error: errorMessage,
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
      if (!this.running) return;

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
      const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
