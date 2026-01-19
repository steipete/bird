/**
 * Filter pipeline for AI Agents Twitter Auto-Responder
 * Multi-stage validation: content → deduplication
 * POC: Skips follower count (Stage 3) and rate limit checks (Stage 4)
 */

import type {
  TweetCandidate,
  FilterResult,
  FilterStats,
  Database,
} from './types.js';
import { initDatabase } from './database.js';
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
 * FilterPipeline class - runs candidates through all filter stages
 */
export class FilterPipeline {
  private db: Database | null = null;

  /**
   * Initialize the filter pipeline with database connection
   */
  async initialize(): Promise<void> {
    if (!this.db) {
      this.db = await initDatabase();
    }
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

      // POC: Skip Stage 3 (follower count) and Stage 4 (rate limits)
      // These will be added in Phase 2 refactoring

      // Found an eligible tweet
      eligible = tweet;
      break;
    }

    // Log filter stats
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
  }
}
