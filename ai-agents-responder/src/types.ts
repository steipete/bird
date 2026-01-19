/**
 * Core TypeScript interfaces for AI Agents Twitter Auto-Responder
 */

// =============================================================================
// Tweet & Candidate Interfaces
// =============================================================================

export interface TweetCandidate {
  id: string;
  text: string;
  authorId: string;
  authorUsername: string;
  createdAt: Date;
  language: string;
  isRetweet: boolean;
}

// =============================================================================
// Poller Interfaces
// =============================================================================

export interface PollerResult {
  success: boolean;
  tweets: TweetCandidate[];
  error?: string;
}

// =============================================================================
// Filter Interfaces
// =============================================================================

export interface FilterResult {
  eligible: TweetCandidate | null;
  stats: FilterStats;
}

export interface FilterStats {
  total: number;
  rejectedContent: number;
  rejectedDuplicate: number;
  rejectedFollowers: number;
  rejectedRateLimit: number;
  reasons: Record<string, number>;
}

export interface FilterContext {
  db: Database;
  config: Config;
  birdClient: unknown; // TwitterClient type from bird
}

export interface FilterDecision {
  pass: boolean;
  reason?: string;
}

export type FilterFn = (tweet: TweetCandidate, context: FilterContext) => Promise<FilterDecision>;

// =============================================================================
// Generator Interfaces
// =============================================================================

export interface GeneratorResult {
  success: boolean;
  png?: Uint8Array;
  manusTaskId?: string;
  manusDuration?: number;
  pngSize?: number;
  error?: string;
}

// =============================================================================
// Manus API Interfaces
// =============================================================================

export interface ManusTaskResponse {
  taskId: string;
  taskUrl: string;
  shareUrl: string;
}

export interface ManusTaskResult {
  status: 'completed' | 'processing' | 'failed' | 'cancelled';
  outputUrl?: string;
  error?: string;
}

export interface PollOptions {
  timeoutMs: number;
  pollIntervalMs: number;
}

// =============================================================================
// PDF Converter Interfaces
// =============================================================================

export interface ConversionOptions {
  width: number;
  dpi: number;
  quality: number;
}

// =============================================================================
// Responder Interfaces
// =============================================================================

export interface ResponderResult {
  success: boolean;
  replyTweetId?: string;
  templateUsed?: number;
  error?: string;
}

// =============================================================================
// Database Interfaces
// =============================================================================

export interface Database {
  // Deduplication
  hasRepliedToTweet(tweetId: string): Promise<boolean>;
  getRepliesForAuthorToday(authorId: string): Promise<number>;

  // Rate limits
  getRateLimitState(): Promise<RateLimitState>;
  incrementDailyCount(): Promise<void>;
  resetDailyCountIfNeeded(): Promise<void>;
  updateLastReplyTime(timestamp: Date): Promise<void>;

  // Circuit breaker
  getCircuitBreakerState(): Promise<CircuitBreakerState>;
  updateCircuitBreakerState(update: CircuitBreakerUpdate): Promise<void>;
  recordManusFailure(): Promise<void>;
  recordManusSuccess(): Promise<void>;

  // Author cache
  getAuthorCache(authorId: string): Promise<AuthorCacheEntry | null>;
  upsertAuthorCache(author: AuthorCacheEntry): Promise<void>;
  seedAuthorsFromJson(authors: SeedAuthor[]): Promise<void>;

  // Reply logging
  recordReply(log: ReplyLogEntry): Promise<void>;

  // Initialization
  initialize(): Promise<void>;
  close(): Promise<void>;
}

export interface RateLimitState {
  dailyCount: number;
  lastReplyAt: Date | null;
  dailyResetAt: Date;
}

export interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  openedAt: Date | null;
  lastFailureAt?: Date | null;
}

export interface CircuitBreakerUpdate {
  state?: 'closed' | 'open' | 'half-open';
  failureCount?: number;
  openedAt?: Date | null;
  lastFailureAt?: Date | null;
}

export interface AuthorCacheEntry {
  authorId: string;
  username: string;
  name: string;
  followerCount: number;
  followingCount: number;
  isVerified: boolean;
  updatedAt: Date;
}

export interface SeedAuthor {
  authorId: string;
  username: string;
  name: string;
  followerCount: number;
  followingCount?: number;
  isVerified?: boolean;
}

export interface ReplyLogEntry {
  tweetId: string;
  authorId: string;
  authorUsername: string;
  tweetText: string;
  tweetCreatedAt: Date;
  replyTweetId: string | null;
  success: boolean;
  errorMessage?: string;
  manusTaskId?: string;
  manusDuration?: number;
  pngSize?: number;
  templateIndex?: number;
}

// =============================================================================
// Config Interfaces
// =============================================================================

export interface Config {
  bird: {
    cookieSource?: 'safari' | 'chrome' | 'firefox';
    authToken?: string;
    ct0?: string;
  };
  manus: {
    apiKey: string;
    apiBase: string;
    timeoutMs: number;
  };
  rateLimits: {
    maxDailyReplies: number;
    minGapMinutes: number;
    maxPerAuthorPerDay: number;
    errorCooldownMinutes: number;
  };
  filters: {
    minFollowerCount: number;
    maxTweetAgeMinutes: number;
    minTweetLength: number;
  };
  polling: {
    intervalSeconds: number;
    searchQuery: string;
    resultsPerQuery: number;
  };
  database: {
    path: string;
  };
  logging: {
    level: 'info' | 'warn' | 'error';
  };
  features: {
    dryRun: boolean;
  };
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
}

// =============================================================================
// Logger Interfaces
// =============================================================================

export interface Logger {
  info(component: string, event: string, metadata?: Record<string, unknown>): void;
  warn(component: string, event: string, metadata?: Record<string, unknown>): void;
  error(component: string, event: string, error: Error, metadata?: Record<string, unknown>): void;
}

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  component: string;
  event: string;
  metadata?: Record<string, unknown>;
  stack?: string;
}

// =============================================================================
// Main Orchestrator Interfaces
// =============================================================================

export interface MainOrchestrator {
  start(): Promise<void>;
  stop(): Promise<void>;
  runCycle(): Promise<CycleResult>;
}

export interface CycleResult {
  status: 'processed' | 'rate_limited' | 'no_eligible' | 'error';
  tweetId?: string;
  author?: string;
  duration: number;
  error?: string;
}

// =============================================================================
// Retry Interfaces
// =============================================================================

export interface RetryOptions {
  maxAttempts: number;
  backoff: 'exponential' | 'linear' | 'fixed';
  baseDelayMs: number;
  maxDelayMs: number;
}
