/**
 * Configuration loading and validation for AI Agents Twitter Auto-Responder
 */

import { config as loadDotenv } from 'dotenv';
import type { Config, ConfigValidationResult } from './types.js';

// Load .env file on module import
loadDotenv();

/**
 * Default configuration values matching design.md
 */
const DEFAULTS = {
  manus: {
    apiBase: 'https://api.manus.ai/v1',
    timeoutMs: 120000, // 2 minutes
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
    path: './data/responder.db',
  },
  logging: {
    level: 'info' as const,
  },
  features: {
    dryRun: false,
  },
};

/**
 * Parse boolean from environment variable
 */
function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === '') {
    return defaultValue;
  }
  return value.toLowerCase() === 'true';
}

/**
 * Parse integer from environment variable with optional default
 */
function parseIntOrDefault(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value === '') {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Validate log level is valid
 */
function parseLogLevel(value: string | undefined): 'info' | 'warn' | 'error' {
  if (value === 'info' || value === 'warn' || value === 'error') {
    return value;
  }
  return DEFAULTS.logging.level;
}

/**
 * Validate cookie source
 */
function parseCookieSource(value: string | undefined): 'safari' | 'chrome' | 'firefox' | undefined {
  if (value === 'safari' || value === 'chrome' || value === 'firefox') {
    return value;
  }
  return undefined;
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(): Config {
  const config: Config = {
    bird: {
      cookieSource: parseCookieSource(process.env.BIRD_COOKIE_SOURCE),
      authToken: process.env.AUTH_TOKEN || undefined,
      ct0: process.env.CT0 || undefined,
    },
    manus: {
      apiKey: process.env.MANUS_API_KEY || '',
      apiBase: process.env.MANUS_API_BASE || DEFAULTS.manus.apiBase,
      timeoutMs: parseIntOrDefault(process.env.MANUS_TIMEOUT_MS, DEFAULTS.manus.timeoutMs),
    },
    rateLimits: {
      maxDailyReplies: parseIntOrDefault(process.env.MAX_DAILY_REPLIES, DEFAULTS.rateLimits.maxDailyReplies),
      minGapMinutes: parseIntOrDefault(process.env.MIN_GAP_MINUTES, DEFAULTS.rateLimits.minGapMinutes),
      maxPerAuthorPerDay: parseIntOrDefault(process.env.MAX_PER_AUTHOR_PER_DAY, DEFAULTS.rateLimits.maxPerAuthorPerDay),
      errorCooldownMinutes: parseIntOrDefault(
        process.env.ERROR_COOLDOWN_MINUTES,
        DEFAULTS.rateLimits.errorCooldownMinutes,
      ),
    },
    filters: {
      minFollowerCount: parseIntOrDefault(process.env.MIN_FOLLOWER_COUNT, DEFAULTS.filters.minFollowerCount),
      maxTweetAgeMinutes: parseIntOrDefault(process.env.MAX_TWEET_AGE_MINUTES, DEFAULTS.filters.maxTweetAgeMinutes),
      minTweetLength: parseIntOrDefault(process.env.MIN_TWEET_LENGTH, DEFAULTS.filters.minTweetLength),
    },
    polling: {
      intervalSeconds: parseIntOrDefault(process.env.POLL_INTERVAL_SECONDS, DEFAULTS.polling.intervalSeconds),
      searchQuery: process.env.SEARCH_QUERY || DEFAULTS.polling.searchQuery,
      resultsPerQuery: parseIntOrDefault(process.env.RESULTS_PER_QUERY, DEFAULTS.polling.resultsPerQuery),
    },
    database: {
      path: process.env.DATABASE_PATH || DEFAULTS.database.path,
    },
    logging: {
      level: parseLogLevel(process.env.LOG_LEVEL),
    },
    features: {
      dryRun: parseBoolean(process.env.DRY_RUN, DEFAULTS.features.dryRun),
    },
  };

  // Validate and exit on error
  const validation = validateConfig(config);
  if (!validation.valid) {
    console.error('Configuration validation failed:');
    for (const error of validation.errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  // Log masked config on startup
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      component: 'config',
      event: 'config_loaded',
      metadata: maskSecrets(config),
    }),
  );

  return config;
}

/**
 * Validate configuration values
 */
export function validateConfig(config: Config): ConfigValidationResult {
  const errors: string[] = [];

  // Auth validation - XOR: cookieSource OR (authToken + ct0)
  const hasBrowserAuth = !!config.bird.cookieSource;
  const hasManualAuth = !!(config.bird.authToken && config.bird.ct0);

  if (!hasBrowserAuth && !hasManualAuth) {
    errors.push('Must provide either BIRD_COOKIE_SOURCE or (AUTH_TOKEN + CT0)');
  }
  if (hasBrowserAuth && hasManualAuth) {
    errors.push('Cannot provide both BIRD_COOKIE_SOURCE and manual tokens (AUTH_TOKEN + CT0)');
  }

  // Manus validation
  if (!config.manus.apiKey) {
    errors.push('MANUS_API_KEY is required');
  }
  if (config.manus.timeoutMs < 60000 || config.manus.timeoutMs > 300000) {
    errors.push('MANUS_TIMEOUT_MS must be between 60000 and 300000 (1-5 minutes)');
  }

  // Rate limit sanity check: maxDailyReplies * minGapMinutes < 1440 (24 hours)
  const dailyMinutes = 24 * 60; // 1440
  const requiredMinutes = config.rateLimits.maxDailyReplies * config.rateLimits.minGapMinutes;
  if (requiredMinutes > dailyMinutes) {
    errors.push(
      `Impossible rate limits: ${config.rateLimits.maxDailyReplies} replies * ${config.rateLimits.minGapMinutes} min gap = ${requiredMinutes} minutes > 1440 minutes (24 hours)`,
    );
  }

  // Numeric range validations
  if (config.rateLimits.maxDailyReplies < 1 || config.rateLimits.maxDailyReplies > 100) {
    errors.push('MAX_DAILY_REPLIES must be between 1 and 100');
  }
  if (config.rateLimits.minGapMinutes < 1 || config.rateLimits.minGapMinutes > 120) {
    errors.push('MIN_GAP_MINUTES must be between 1 and 120');
  }
  if (config.rateLimits.maxPerAuthorPerDay < 1 || config.rateLimits.maxPerAuthorPerDay > 10) {
    errors.push('MAX_PER_AUTHOR_PER_DAY must be between 1 and 10');
  }
  if (config.filters.minFollowerCount < 0) {
    errors.push('MIN_FOLLOWER_COUNT must be non-negative');
  }
  if (config.filters.maxTweetAgeMinutes < 1 || config.filters.maxTweetAgeMinutes > 1440) {
    errors.push('MAX_TWEET_AGE_MINUTES must be between 1 and 1440');
  }
  if (config.filters.minTweetLength < 0 || config.filters.minTweetLength > 280) {
    errors.push('MIN_TWEET_LENGTH must be between 0 and 280');
  }
  if (config.polling.intervalSeconds < 10 || config.polling.intervalSeconds > 3600) {
    errors.push('POLL_INTERVAL_SECONDS must be between 10 and 3600');
  }
  if (config.polling.resultsPerQuery < 1 || config.polling.resultsPerQuery > 100) {
    errors.push('RESULTS_PER_QUERY must be between 1 and 100');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Mask secrets in config for logging
 */
export function maskSecrets(config: Config): Record<string, unknown> {
  return {
    bird: {
      cookieSource: config.bird.cookieSource,
      authToken: config.bird.authToken ? '***' : undefined,
      ct0: config.bird.ct0 ? '***' : undefined,
    },
    manus: {
      apiKey: '***',
      apiBase: config.manus.apiBase,
      timeoutMs: config.manus.timeoutMs,
    },
    rateLimits: config.rateLimits,
    filters: config.filters,
    polling: config.polling,
    database: config.database,
    logging: config.logging,
    features: config.features,
  };
}
