/**
 * Unit tests for config validation
 * Tests all validation rules, error messages, and secret masking
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateConfig, maskSecrets } from '../config.js';
import type { Config } from '../types.js';

/**
 * Create a valid base config for testing
 * All values are within valid ranges and pass validation
 */
function createValidConfig(overrides: Partial<Config> = {}): Config {
  const baseConfig: Config = {
    bird: {
      cookieSource: 'safari',
      authToken: undefined,
      ct0: undefined,
    },
    manus: {
      apiKey: 'test-api-key-12345',
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
      path: './data/responder.db',
    },
    logging: {
      level: 'info',
    },
    features: {
      dryRun: false,
    },
  };

  // Deep merge overrides
  return deepMerge(baseConfig as unknown as Record<string, unknown>, overrides as unknown as Record<string, unknown>) as unknown as Config;
}

/**
 * Deep merge two objects
 */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
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

describe('Config Validation', () => {
  describe('Valid configurations', () => {
    it('should accept valid config with cookieSource auth', () => {
      const config = createValidConfig({
        bird: { cookieSource: 'safari', authToken: undefined, ct0: undefined },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept valid config with manual tokens auth', () => {
      const config = createValidConfig({
        bird: { cookieSource: undefined, authToken: 'auth-token-123', ct0: 'ct0-token-456' },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept valid config with chrome cookieSource', () => {
      const config = createValidConfig({
        bird: { cookieSource: 'chrome', authToken: undefined, ct0: undefined },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
    });

    it('should accept valid config with firefox cookieSource', () => {
      const config = createValidConfig({
        bird: { cookieSource: 'firefox', authToken: undefined, ct0: undefined },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
    });

    it('should accept config with minimum valid values', () => {
      const config = createValidConfig({
        manus: { apiKey: 'key', apiBase: 'https://api.manus.ai', timeoutMs: 60000 },
        rateLimits: { maxDailyReplies: 1, minGapMinutes: 1, maxPerAuthorPerDay: 1, errorCooldownMinutes: 1 },
        filters: { minFollowerCount: 0, maxTweetAgeMinutes: 1, minTweetLength: 0 },
        polling: { intervalSeconds: 10, searchQuery: 'test', resultsPerQuery: 1 },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
    });

    it('should accept config with maximum valid values', () => {
      const config = createValidConfig({
        manus: { apiKey: 'key', apiBase: 'https://api.manus.ai', timeoutMs: 300000 },
        rateLimits: { maxDailyReplies: 100, minGapMinutes: 14, maxPerAuthorPerDay: 10, errorCooldownMinutes: 120 },
        filters: { minFollowerCount: 1000000, maxTweetAgeMinutes: 1440, minTweetLength: 280 },
        polling: { intervalSeconds: 3600, searchQuery: 'test', resultsPerQuery: 100 },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
    });
  });

  describe('MANUS_API_KEY validation', () => {
    it('should reject config with missing MANUS_API_KEY', () => {
      const config = createValidConfig({
        manus: { apiKey: '', apiBase: 'https://api.manus.ai', timeoutMs: 120000 },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('MANUS_API_KEY is required');
    });
  });

  describe('XOR auth validation (cookieSource vs manual tokens)', () => {
    it('should reject config with no auth method', () => {
      const config = createValidConfig({
        bird: { cookieSource: undefined, authToken: undefined, ct0: undefined },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Must provide either BIRD_COOKIE_SOURCE or (AUTH_TOKEN + CT0)');
    });

    it('should reject config with both auth methods', () => {
      const config = createValidConfig({
        bird: { cookieSource: 'safari', authToken: 'token', ct0: 'ct0' },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Cannot provide both BIRD_COOKIE_SOURCE and manual tokens (AUTH_TOKEN + CT0)');
    });

    it('should reject config with only authToken (missing ct0)', () => {
      const config = createValidConfig({
        bird: { cookieSource: undefined, authToken: 'token', ct0: undefined },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Must provide either BIRD_COOKIE_SOURCE or (AUTH_TOKEN + CT0)');
    });

    it('should reject config with only ct0 (missing authToken)', () => {
      const config = createValidConfig({
        bird: { cookieSource: undefined, authToken: undefined, ct0: 'ct0' },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Must provide either BIRD_COOKIE_SOURCE or (AUTH_TOKEN + CT0)');
    });
  });

  describe('Numeric range validation (MANUS_TIMEOUT_MS)', () => {
    it('should reject MANUS_TIMEOUT_MS below minimum (60000)', () => {
      const config = createValidConfig({
        manus: { apiKey: 'key', apiBase: 'https://api.manus.ai', timeoutMs: 59999 },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('MANUS_TIMEOUT_MS must be between 60000 and 300000 (1-5 minutes)');
    });

    it('should reject MANUS_TIMEOUT_MS above maximum (300000)', () => {
      const config = createValidConfig({
        manus: { apiKey: 'key', apiBase: 'https://api.manus.ai', timeoutMs: 300001 },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('MANUS_TIMEOUT_MS must be between 60000 and 300000 (1-5 minutes)');
    });

    it('should accept MANUS_TIMEOUT_MS at minimum boundary (60000)', () => {
      const config = createValidConfig({
        manus: { apiKey: 'key', apiBase: 'https://api.manus.ai', timeoutMs: 60000 },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
    });

    it('should accept MANUS_TIMEOUT_MS at maximum boundary (300000)', () => {
      const config = createValidConfig({
        manus: { apiKey: 'key', apiBase: 'https://api.manus.ai', timeoutMs: 300000 },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
    });
  });

  describe('Rate limit sanity check (maxReplies * minGap < 1440)', () => {
    it('should reject when maxReplies * minGap exceeds 1440 minutes', () => {
      const config = createValidConfig({
        rateLimits: { maxDailyReplies: 100, minGapMinutes: 15, maxPerAuthorPerDay: 1, errorCooldownMinutes: 30 },
      });
      // 100 * 15 = 1500 > 1440
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Impossible rate limits: 100 replies * 15 min gap = 1500 minutes > 1440 minutes (24 hours)'
      );
    });

    it('should accept when maxReplies * minGap equals 1440 minutes', () => {
      const config = createValidConfig({
        rateLimits: { maxDailyReplies: 96, minGapMinutes: 15, maxPerAuthorPerDay: 1, errorCooldownMinutes: 30 },
      });
      // 96 * 15 = 1440 = 1440
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
    });

    it('should accept when maxReplies * minGap is well below 1440', () => {
      const config = createValidConfig({
        rateLimits: { maxDailyReplies: 12, minGapMinutes: 10, maxPerAuthorPerDay: 1, errorCooldownMinutes: 30 },
      });
      // 12 * 10 = 120 < 1440
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
    });
  });

  describe('Rate limit field validations', () => {
    it('should reject MAX_DAILY_REPLIES below minimum (1)', () => {
      const config = createValidConfig({
        rateLimits: { maxDailyReplies: 0, minGapMinutes: 10, maxPerAuthorPerDay: 1, errorCooldownMinutes: 30 },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('MAX_DAILY_REPLIES must be between 1 and 100');
    });

    it('should reject MAX_DAILY_REPLIES above maximum (100)', () => {
      const config = createValidConfig({
        rateLimits: { maxDailyReplies: 101, minGapMinutes: 1, maxPerAuthorPerDay: 1, errorCooldownMinutes: 30 },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('MAX_DAILY_REPLIES must be between 1 and 100');
    });

    it('should reject MIN_GAP_MINUTES below minimum (1)', () => {
      const config = createValidConfig({
        rateLimits: { maxDailyReplies: 12, minGapMinutes: 0, maxPerAuthorPerDay: 1, errorCooldownMinutes: 30 },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('MIN_GAP_MINUTES must be between 1 and 120');
    });

    it('should reject MIN_GAP_MINUTES above maximum (120)', () => {
      const config = createValidConfig({
        rateLimits: { maxDailyReplies: 12, minGapMinutes: 121, maxPerAuthorPerDay: 1, errorCooldownMinutes: 30 },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('MIN_GAP_MINUTES must be between 1 and 120');
    });

    it('should reject MAX_PER_AUTHOR_PER_DAY below minimum (1)', () => {
      const config = createValidConfig({
        rateLimits: { maxDailyReplies: 12, minGapMinutes: 10, maxPerAuthorPerDay: 0, errorCooldownMinutes: 30 },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('MAX_PER_AUTHOR_PER_DAY must be between 1 and 10');
    });

    it('should reject MAX_PER_AUTHOR_PER_DAY above maximum (10)', () => {
      const config = createValidConfig({
        rateLimits: { maxDailyReplies: 12, minGapMinutes: 10, maxPerAuthorPerDay: 11, errorCooldownMinutes: 30 },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('MAX_PER_AUTHOR_PER_DAY must be between 1 and 10');
    });
  });

  describe('Filter validations', () => {
    it('should reject MIN_FOLLOWER_COUNT below zero', () => {
      const config = createValidConfig({
        filters: { minFollowerCount: -1, maxTweetAgeMinutes: 30, minTweetLength: 100 },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('MIN_FOLLOWER_COUNT must be non-negative');
    });

    it('should accept MIN_FOLLOWER_COUNT at zero', () => {
      const config = createValidConfig({
        filters: { minFollowerCount: 0, maxTweetAgeMinutes: 30, minTweetLength: 100 },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(true);
    });

    it('should reject MAX_TWEET_AGE_MINUTES below minimum (1)', () => {
      const config = createValidConfig({
        filters: { minFollowerCount: 50000, maxTweetAgeMinutes: 0, minTweetLength: 100 },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('MAX_TWEET_AGE_MINUTES must be between 1 and 1440');
    });

    it('should reject MAX_TWEET_AGE_MINUTES above maximum (1440)', () => {
      const config = createValidConfig({
        filters: { minFollowerCount: 50000, maxTweetAgeMinutes: 1441, minTweetLength: 100 },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('MAX_TWEET_AGE_MINUTES must be between 1 and 1440');
    });

    it('should reject MIN_TWEET_LENGTH below zero', () => {
      const config = createValidConfig({
        filters: { minFollowerCount: 50000, maxTweetAgeMinutes: 30, minTweetLength: -1 },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('MIN_TWEET_LENGTH must be between 0 and 280');
    });

    it('should reject MIN_TWEET_LENGTH above maximum (280)', () => {
      const config = createValidConfig({
        filters: { minFollowerCount: 50000, maxTweetAgeMinutes: 30, minTweetLength: 281 },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('MIN_TWEET_LENGTH must be between 0 and 280');
    });
  });

  describe('Polling validations', () => {
    it('should reject POLL_INTERVAL_SECONDS below minimum (10)', () => {
      const config = createValidConfig({
        polling: { intervalSeconds: 9, searchQuery: 'test', resultsPerQuery: 50 },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('POLL_INTERVAL_SECONDS must be between 10 and 3600');
    });

    it('should reject POLL_INTERVAL_SECONDS above maximum (3600)', () => {
      const config = createValidConfig({
        polling: { intervalSeconds: 3601, searchQuery: 'test', resultsPerQuery: 50 },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('POLL_INTERVAL_SECONDS must be between 10 and 3600');
    });

    it('should reject RESULTS_PER_QUERY below minimum (1)', () => {
      const config = createValidConfig({
        polling: { intervalSeconds: 60, searchQuery: 'test', resultsPerQuery: 0 },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('RESULTS_PER_QUERY must be between 1 and 100');
    });

    it('should reject RESULTS_PER_QUERY above maximum (100)', () => {
      const config = createValidConfig({
        polling: { intervalSeconds: 60, searchQuery: 'test', resultsPerQuery: 101 },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('RESULTS_PER_QUERY must be between 1 and 100');
    });
  });

  describe('Multiple errors', () => {
    it('should collect all validation errors', () => {
      const config = createValidConfig({
        bird: { cookieSource: undefined, authToken: undefined, ct0: undefined },
        manus: { apiKey: '', apiBase: 'https://api.manus.ai', timeoutMs: 50000 },
        rateLimits: { maxDailyReplies: 0, minGapMinutes: 0, maxPerAuthorPerDay: 0, errorCooldownMinutes: 30 },
      });
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
      expect(result.errors).toContain('Must provide either BIRD_COOKIE_SOURCE or (AUTH_TOKEN + CT0)');
      expect(result.errors).toContain('MANUS_API_KEY is required');
      expect(result.errors).toContain('MANUS_TIMEOUT_MS must be between 60000 and 300000 (1-5 minutes)');
      expect(result.errors).toContain('MAX_DAILY_REPLIES must be between 1 and 100');
    });
  });
});

describe('maskSecrets', () => {
  it('should mask authToken when present', () => {
    const config = createValidConfig({
      bird: { cookieSource: undefined, authToken: 'secret-auth-token-abc123', ct0: 'secret-ct0-xyz789' },
    });
    const masked = maskSecrets(config);
    expect(masked.bird).toBeDefined();
    const birdConfig = masked.bird as Record<string, unknown>;
    expect(birdConfig.authToken).toBe('***');
  });

  it('should mask ct0 when present', () => {
    const config = createValidConfig({
      bird: { cookieSource: undefined, authToken: 'secret-auth-token', ct0: 'secret-ct0-token' },
    });
    const masked = maskSecrets(config);
    const birdConfig = masked.bird as Record<string, unknown>;
    expect(birdConfig.ct0).toBe('***');
  });

  it('should always mask manus apiKey', () => {
    const config = createValidConfig({
      manus: { apiKey: 'super-secret-manus-key', apiBase: 'https://api.manus.ai', timeoutMs: 120000 },
    });
    const masked = maskSecrets(config);
    const manusConfig = masked.manus as Record<string, unknown>;
    expect(manusConfig.apiKey).toBe('***');
  });

  it('should preserve cookieSource value (not a secret)', () => {
    const config = createValidConfig({
      bird: { cookieSource: 'safari', authToken: undefined, ct0: undefined },
    });
    const masked = maskSecrets(config);
    const birdConfig = masked.bird as Record<string, unknown>;
    expect(birdConfig.cookieSource).toBe('safari');
  });

  it('should preserve non-secret values', () => {
    const config = createValidConfig();
    const masked = maskSecrets(config);

    // Rate limits preserved
    expect(masked.rateLimits).toEqual(config.rateLimits);

    // Filters preserved
    expect(masked.filters).toEqual(config.filters);

    // Polling preserved
    expect(masked.polling).toEqual(config.polling);

    // Database preserved
    expect(masked.database).toEqual(config.database);

    // Logging preserved
    expect(masked.logging).toEqual(config.logging);

    // Features preserved
    expect(masked.features).toEqual(config.features);
  });

  it('should preserve manus apiBase and timeoutMs', () => {
    const config = createValidConfig({
      manus: { apiKey: 'secret', apiBase: 'https://custom.api.com', timeoutMs: 180000 },
    });
    const masked = maskSecrets(config);
    const manusConfig = masked.manus as Record<string, unknown>;
    expect(manusConfig.apiBase).toBe('https://custom.api.com');
    expect(manusConfig.timeoutMs).toBe(180000);
  });

  it('should set authToken to undefined when not present', () => {
    const config = createValidConfig({
      bird: { cookieSource: 'safari', authToken: undefined, ct0: undefined },
    });
    const masked = maskSecrets(config);
    const birdConfig = masked.bird as Record<string, unknown>;
    expect(birdConfig.authToken).toBeUndefined();
  });

  it('should set ct0 to undefined when not present', () => {
    const config = createValidConfig({
      bird: { cookieSource: 'safari', authToken: undefined, ct0: undefined },
    });
    const masked = maskSecrets(config);
    const birdConfig = masked.bird as Record<string, unknown>;
    expect(birdConfig.ct0).toBeUndefined();
  });
});
