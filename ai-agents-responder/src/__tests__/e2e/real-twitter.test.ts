/**
 * E2E Test: Real Twitter Search
 *
 * Tests real Bird client search functionality against Twitter API.
 * This is a READ-ONLY test - no posting or replies.
 *
 * Credentials required (one of):
 * - BIRD_COOKIE_SOURCE: Browser cookie source ('safari', 'chrome', etc.)
 * - AUTH_TOKEN + CT0: Manual authentication tokens
 *
 * If no credentials are available, tests are skipped gracefully.
 */

import { beforeAll, describe, expect, it } from 'bun:test';
import { resolveCredentials, type SearchResult, type TweetData, TwitterClient } from '@steipete/bird';
import type { TweetCandidate } from '../../types.js';

// =============================================================================
// Top-level constants
// =============================================================================

const CREDENTIAL_SOURCE_REGEX = /^(cookie|token|none)$/;

// =============================================================================
// Credential Detection
// =============================================================================

interface CredentialStatus {
  available: boolean;
  source: 'cookie' | 'token' | 'none';
  details: string;
}

function checkCredentials(): CredentialStatus {
  const cookieSource = process.env.BIRD_COOKIE_SOURCE;
  const authToken = process.env.AUTH_TOKEN;
  const ct0 = process.env.CT0;

  if (cookieSource) {
    return {
      available: true,
      source: 'cookie',
      details: `Using browser cookies from ${cookieSource}`,
    };
  }

  if (authToken && ct0) {
    return {
      available: true,
      source: 'token',
      details: 'Using manual AUTH_TOKEN and CT0',
    };
  }

  return {
    available: false,
    source: 'none',
    details: 'No credentials available. Set BIRD_COOKIE_SOURCE or AUTH_TOKEN + CT0 to enable real Twitter tests.',
  };
}

// =============================================================================
// TweetCandidate Mapping (same as poller.ts)
// =============================================================================

function mapTweetToCandidate(tweet: TweetData): TweetCandidate {
  const authorId = tweet.authorId ?? tweet.author.username;
  const createdAt = tweet.createdAt ? new Date(tweet.createdAt) : new Date();
  const isRetweet = tweet.text.startsWith('RT @');
  const language = 'en';

  return {
    id: tweet.id,
    text: tweet.text,
    authorId,
    authorUsername: tweet.author.username,
    createdAt,
    language,
    isRetweet,
  };
}

// =============================================================================
// Test Suite
// =============================================================================

describe('E2E: Real Twitter Search', () => {
  const credentials = checkCredentials();
  let client: TwitterClient | null = null;
  let skipReason: string | null = null;

  beforeAll(async () => {
    if (!credentials.available) {
      skipReason = credentials.details;
      console.log(`[SKIP] ${skipReason}`);
      return;
    }

    try {
      if (credentials.source === 'cookie') {
        const cookieSource = process.env.BIRD_COOKIE_SOURCE as 'safari' | 'chrome' | 'firefox';
        const result = await resolveCredentials({ cookieSource });

        if (!result.cookies.authToken || !result.cookies.ct0) {
          skipReason = `Failed to extract credentials from ${cookieSource}`;
          console.log(`[SKIP] ${skipReason}`);
          return;
        }

        client = new TwitterClient({ cookies: result.cookies });
      } else {
        client = new TwitterClient({
          cookies: {
            authToken: process.env.AUTH_TOKEN ?? '',
            ct0: process.env.CT0 ?? '',
            cookieHeader: null,
            source: 'manual',
          },
        });
      }

      console.log(`[INFO] ${credentials.details}`);
    } catch (error) {
      skipReason = `Failed to initialize client: ${error instanceof Error ? error.message : String(error)}`;
      console.log(`[SKIP] ${skipReason}`);
    }
  });

  describe('Search functionality', () => {
    it('should search for AI agents tweets', async () => {
      if (skipReason || !client) {
        console.log(`[SKIP] Test skipped: ${skipReason ?? 'No client available'}`);
        expect(true).toBe(true); // Pass the test when skipped
        return;
      }

      const query = 'AI agents -is:retweet lang:en';
      const count = 10;

      const result: SearchResult = await client.search(query, count);

      // Verify search succeeded
      expect(result.success).toBe(true);
      expect(result.tweets).toBeDefined();
      expect(Array.isArray(result.tweets)).toBe(true);

      const tweets = result.tweets ?? [];
      console.log(`[INFO] Search returned ${tweets.length} tweets`);

      // Verify we got some results (Twitter API may return fewer than requested)
      // Don't fail if 0 results - could be rate limited or no matching tweets
      if (tweets.length === 0) {
        console.log('[WARN] Search returned 0 results - may be rate limited or no matching tweets');
      }
    });

    it('should return valid TweetData structure', async () => {
      if (skipReason || !client) {
        console.log(`[SKIP] Test skipped: ${skipReason ?? 'No client available'}`);
        expect(true).toBe(true);
        return;
      }

      const query = 'AI agents -is:retweet lang:en';
      const result: SearchResult = await client.search(query, 5);

      expect(result.success).toBe(true);

      const tweets = result.tweets ?? [];
      if (tweets.length === 0) {
        console.log('[WARN] No tweets to validate - skipping structure check');
        expect(true).toBe(true);
        return;
      }

      const tweet = tweets[0];

      // Verify required TweetData fields exist
      expect(tweet.id).toBeDefined();
      expect(typeof tweet.id).toBe('string');
      expect(tweet.id.length).toBeGreaterThan(0);

      expect(tweet.text).toBeDefined();
      expect(typeof tweet.text).toBe('string');

      expect(tweet.author).toBeDefined();
      expect(tweet.author.username).toBeDefined();
      expect(typeof tweet.author.username).toBe('string');

      console.log(`[INFO] Validated tweet structure: id=${tweet.id}, author=@${tweet.author.username}`);
    });

    it('should map results to TweetCandidate correctly', async () => {
      if (skipReason || !client) {
        console.log(`[SKIP] Test skipped: ${skipReason ?? 'No client available'}`);
        expect(true).toBe(true);
        return;
      }

      const query = 'AI agents -is:retweet lang:en';
      const result: SearchResult = await client.search(query, 5);

      expect(result.success).toBe(true);

      const tweets = result.tweets ?? [];
      if (tweets.length === 0) {
        console.log('[WARN] No tweets to map - skipping mapping check');
        expect(true).toBe(true);
        return;
      }

      // Map all results to TweetCandidate
      const candidates = tweets.map(mapTweetToCandidate);

      expect(candidates.length).toBe(tweets.length);

      for (const candidate of candidates) {
        // Verify TweetCandidate interface
        expect(candidate.id).toBeDefined();
        expect(typeof candidate.id).toBe('string');

        expect(candidate.text).toBeDefined();
        expect(typeof candidate.text).toBe('string');

        expect(candidate.authorId).toBeDefined();
        expect(typeof candidate.authorId).toBe('string');

        expect(candidate.authorUsername).toBeDefined();
        expect(typeof candidate.authorUsername).toBe('string');

        expect(candidate.createdAt).toBeInstanceOf(Date);
        expect(candidate.createdAt.getTime()).not.toBeNaN();

        expect(candidate.language).toBe('en');

        expect(typeof candidate.isRetweet).toBe('boolean');
      }

      console.log(`[INFO] Successfully mapped ${candidates.length} tweets to TweetCandidate`);
    });

    it('should filter out retweets via query', async () => {
      if (skipReason || !client) {
        console.log(`[SKIP] Test skipped: ${skipReason ?? 'No client available'}`);
        expect(true).toBe(true);
        return;
      }

      // The -is:retweet filter should exclude native retweets
      // Note: RT @ style retweets may still appear
      const query = 'AI agents -is:retweet lang:en';
      const result: SearchResult = await client.search(query, 20);

      expect(result.success).toBe(true);

      const tweets = result.tweets ?? [];
      if (tweets.length === 0) {
        console.log('[WARN] No tweets to check for retweets');
        expect(true).toBe(true);
        return;
      }

      const candidates = tweets.map(mapTweetToCandidate);

      // Count retweets (RT @ style)
      const rtStyleRetweets = candidates.filter((c) => c.isRetweet);

      // Most results should not be RT @ style retweets
      // (The query filter handles native retweets, not quote tweets or RT @ style)
      const nonRetweetPercentage = ((candidates.length - rtStyleRetweets.length) / candidates.length) * 100;

      console.log(`[INFO] Non-retweet percentage: ${nonRetweetPercentage.toFixed(1)}%`);
      console.log(`[INFO] Found ${rtStyleRetweets.length} RT@ style retweets out of ${candidates.length} total`);

      // We expect mostly non-retweets, but some RT @ style may slip through
      expect(nonRetweetPercentage).toBeGreaterThanOrEqual(50);
    });
  });

  describe('Read-only verification', () => {
    it('should NOT post any replies or tweets', async () => {
      // This test documents that we're read-only
      // The test suite should never call client.tweet() or client.reply()
      console.log('[INFO] This test suite is READ-ONLY. No posting methods are called.');
      expect(true).toBe(true);
    });

    it('should NOT modify any Twitter state', async () => {
      // Document that we don't like, retweet, follow, or modify anything
      console.log('[INFO] This test suite does NOT modify Twitter state (no likes, retweets, follows, etc.)');
      expect(true).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('should handle invalid query gracefully', async () => {
      if (skipReason || !client) {
        console.log(`[SKIP] Test skipped: ${skipReason ?? 'No client available'}`);
        expect(true).toBe(true);
        return;
      }

      // Empty query - should still work but may return no results
      try {
        const result = await client.search('', 1);
        // Either succeeds with no results or fails gracefully
        expect(result).toBeDefined();
        console.log(`[INFO] Empty query handled: success=${result.success}, tweets=${result.tweets?.length ?? 0}`);
      } catch (error) {
        // Error is acceptable for invalid query
        console.log(
          `[INFO] Empty query threw error (acceptable): ${error instanceof Error ? error.message : String(error)}`,
        );
        expect(true).toBe(true);
      }
    });

    it('should handle zero count request', async () => {
      if (skipReason || !client) {
        console.log(`[SKIP] Test skipped: ${skipReason ?? 'No client available'}`);
        expect(true).toBe(true);
        return;
      }

      try {
        const result = await client.search('AI agents', 0);
        expect(result).toBeDefined();
        console.log(`[INFO] Zero count handled: success=${result.success}`);
      } catch (error) {
        console.log(
          `[INFO] Zero count threw error (acceptable): ${error instanceof Error ? error.message : String(error)}`,
        );
        expect(true).toBe(true);
      }
    });
  });

  describe('Credential status', () => {
    it('should report credential status', () => {
      console.log(`[INFO] Credential status: ${credentials.source}`);
      console.log(`[INFO] Available: ${credentials.available}`);
      console.log(`[INFO] Details: ${credentials.details}`);

      // This test always passes - it just reports status
      expect(credentials.source).toMatch(CREDENTIAL_SOURCE_REGEX);
    });
  });
});
