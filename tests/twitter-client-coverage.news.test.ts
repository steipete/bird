import { afterEach, describe, expect, it, vi } from 'vitest';
import { TwitterClient } from '../src/lib/twitter-client.js';

const validCookies = {
  authToken: 'test_auth_token',
  ct0: 'test_ct0_token',
  cookieHeader: 'auth_token=test_auth_token; ct0=test_ct0_token',
  source: 'test',
};

type ResponseLike = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

const makeResponse = (overrides: Partial<ResponseLike> = {}): ResponseLike => ({
  ok: true,
  status: 200,
  json: async (): Promise<unknown> => ({}),
  text: async (): Promise<string> => '',
  ...overrides,
});

// Helper to create GenericTimelineById response structure
const makeTimelineResponse = (items: any[]) => ({
  data: {
    timeline: {
      timeline: {
        instructions: [
          {
            type: 'TimelineAddEntries',
            entries: items.map((item, index) => ({
              entryId: `test-entry-${index}`,
              content: {
                items: [
                  {
                    item: {
                      itemContent: item,
                    },
                  },
                ],
              },
            })),
          },
        ],
      },
    },
  },
});

describe('TwitterClient news API coverage', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('getNews', () => {
    it('returns news items from timeline tabs', async () => {
      // Mock multiple tab requests (forYou, news, sports, entertainment)
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          makeResponse({
            json: async () =>
              makeTimelineResponse([
                {
                  is_ai_trend: true,
                  name: 'AI Breakthrough in Machine Learning',
                  social_context: {
                    text: 'AI · 2h ago · 15.5K posts',
                  },
                  trend_url: {
                    url: 'https://x.com/hashtag/AI',
                  },
                },
              ]),
          }),
        )
        .mockResolvedValue(makeResponse({ json: async () => makeTimelineResponse([]) }));

      global.fetch = mockFetch as unknown as typeof fetch;

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getNews(1);

      expect(result.success).toBe(true);
      expect(result.items).toBeDefined();
      expect(result.items?.length).toBe(1);
      expect(result.items?.[0].headline).toBe('AI Breakthrough in Machine Learning');
      expect(result.items?.[0].category).toBe('AI · AI');
      expect(result.items?.[0].timeAgo).toBe('2h ago');
      expect(result.items?.[0].postCount).toBe(15500);
      expect(result.items?.[0].url).toBe('https://x.com/hashtag/AI');
    });

    it('filters to AI-only items when aiOnly is true', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          makeResponse({
            json: async () =>
              makeTimelineResponse([
                {
                  is_ai_trend: true,
                  name: 'AI News',
                },
                {
                  is_ai_trend: false,
                  name: 'Regular News',
                },
              ]),
          }),
        )
        .mockResolvedValue(makeResponse({ json: async () => makeTimelineResponse([]) }));

      global.fetch = mockFetch as unknown as typeof fetch;

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getNews(10, { aiOnly: true });

      expect(result.success).toBe(true);
      expect(result.items?.length).toBe(1);
      expect(result.items?.[0].headline).toBe('AI News');
    });

    it('returns error for non-ok responses', async () => {
      // Mock all 4 default tabs (forYou, news, sports, entertainment) to return HTTP 500
      const mockFetch = vi
        .fn()
        .mockResolvedValue(makeResponse({ ok: false, status: 500, text: async () => 'Server error' }));

      global.fetch = mockFetch as unknown as typeof fetch;

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getNews(10);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No news items found');
    });

    it('returns error when API returns errors', async () => {
      // Mock all 4 default tabs to return API errors
      const mockFetch = vi.fn().mockResolvedValue(
        makeResponse({
          json: async () => ({
            errors: [{ message: 'Rate limited' }, { message: 'Too many requests' }],
          }),
        }),
      );

      global.fetch = mockFetch as unknown as typeof fetch;

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getNews(10);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No news items found');
    });

    it('returns error when no news items found', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(makeResponse({ json: async () => makeTimelineResponse([]) }));

      global.fetch = mockFetch as unknown as typeof fetch;

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getNews(10);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No news items found');
    });

    it('deduplicates headlines across tabs', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          makeResponse({
            json: async () =>
              makeTimelineResponse([
                {
                  is_ai_trend: true,
                  name: 'Duplicate Headline',
                },
              ]),
          }),
        )
        .mockResolvedValueOnce(
          makeResponse({
            json: async () =>
              makeTimelineResponse([
                {
                  is_ai_trend: true,
                  name: 'Duplicate Headline',
                },
              ]),
          }),
        )
        .mockResolvedValue(makeResponse({ json: async () => makeTimelineResponse([]) }));

      global.fetch = mockFetch as unknown as typeof fetch;

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getNews(10);

      expect(result.success).toBe(true);
      expect(result.items?.length).toBe(1);
      expect(result.items?.[0].headline).toBe('Duplicate Headline');
    });

    it('respects count parameter', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          makeResponse({
            json: async () =>
              makeTimelineResponse([
                {
                  is_ai_trend: true,
                  name: 'News 1',
                },
                {
                  is_ai_trend: true,
                  name: 'News 2',
                },
                {
                  is_ai_trend: true,
                  name: 'News 3',
                },
              ]),
          }),
        )
        .mockResolvedValue(makeResponse({ json: async () => makeTimelineResponse([]) }));

      global.fetch = mockFetch as unknown as typeof fetch;

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getNews(2);

      expect(result.success).toBe(true);
      expect(result.items?.length).toBe(2);
    });
  });
});
