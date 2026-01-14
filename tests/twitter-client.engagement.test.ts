import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwitterClient } from '../src/lib/twitter-client.js';
import { validCookies } from './twitter-client-fixtures.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('TwitterClient engagement', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  describe('like', () => {
    it('successfully likes a tweet', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { favorite_tweet: 'Done' } }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.like('1234567890');

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe('POST');
      expect(String(url)).toContain('/FavoriteTweet');
      const body = JSON.parse(options.body);
      expect(body.variables.tweet_id).toBe('1234567890');
    });

    it('returns error on HTTP failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.like('1234567890');

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 403');
    });

    it('returns error on GraphQL errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          errors: [{ message: 'You have already favorited this Tweet.' }],
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.like('1234567890');

      expect(result.success).toBe(false);
      expect(result.error).toContain('already favorited');
    });

    it('retries on 404 with refreshed query IDs', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'Not found' })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: { favorite_tweet: 'Done' } }),
        });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.like('1234567890');

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('unlike', () => {
    it('successfully unlikes a tweet', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { unfavorite_tweet: 'Done' } }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.unlike('1234567890');

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe('POST');
      expect(String(url)).toContain('/UnfavoriteTweet');
    });
  });

  describe('retweet', () => {
    it('successfully retweets a tweet', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { create_retweet: { retweet_results: { result: {} } } } }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.retweet('1234567890');

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe('POST');
      expect(String(url)).toContain('/CreateRetweet');
    });
  });

  describe('unretweet', () => {
    it('successfully unrets a tweet', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { unretweet: { source_tweet_results: {} } } }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.unretweet('1234567890');

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe('POST');
      expect(String(url)).toContain('/DeleteRetweet');
    });
  });

  describe('bookmark', () => {
    it('successfully bookmarks a tweet', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { tweet_bookmark_put: 'Done' } }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.bookmark('1234567890');

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe('POST');
      expect(String(url)).toContain('/CreateBookmark');
    });
  });

  describe('error handling', () => {
    it('catches network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.like('1234567890');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });
});
