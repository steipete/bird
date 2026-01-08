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

describe('TwitterClient news API coverage', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('getNews', () => {
    it('returns news items from ExplorePage', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(
        makeResponse({
          json: async () => ({
            data: {
              explore_page: {
                body: {
                  initialTimeline: {
                    timeline: {
                      timeline: {
                        instructions: [
                          {
                            type: 'TimelineAddEntries',
                            entries: [
                              {
                                entryId: 'test-entry-1',
                                content: {
                                  items: [
                                    {
                                      itemContent: {
                                        is_ai_trend: true,
                                        name: 'AI Breakthrough in Machine Learning',
                                        social_context: {
                                          text: 'AI · 2h ago · 15.5K posts',
                                        },
                                        trend_url: {
                                          url: 'https://x.com/hashtag/AI',
                                        },
                                      },
                                    },
                                  ],
                                },
                              },
                            ],
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          }),
        }),
      );

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
      const mockFetch = vi.fn().mockResolvedValueOnce(
        makeResponse({
          json: async () => ({
            data: {
              explore_page: {
                body: {
                  initialTimeline: {
                    timeline: {
                      timeline: {
                        instructions: [
                          {
                            type: 'TimelineAddEntries',
                            entries: [
                              {
                                entryId: 'test-entry-1',
                                content: {
                                  items: [
                                    {
                                      itemContent: {
                                        is_ai_trend: true,
                                        name: 'AI News',
                                      },
                                    },
                                  ],
                                },
                              },
                              {
                                entryId: 'test-entry-2',
                                content: {
                                  items: [
                                    {
                                      itemContent: {
                                        is_ai_trend: false,
                                        name: 'Regular News',
                                      },
                                    },
                                  ],
                                },
                              },
                            ],
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          }),
        }),
      );

      global.fetch = mockFetch as unknown as typeof fetch;

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getNews(10, { aiOnly: true });

      expect(result.success).toBe(true);
      expect(result.items?.length).toBe(1);
      expect(result.items?.[0].headline).toBe('AI News');
    });

    it('returns error for non-ok responses', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(makeResponse({ ok: false, status: 500, text: async () => 'Server error' }));

      global.fetch = mockFetch as unknown as typeof fetch;

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getNews(10);

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 500');
    });

    it('returns error when API returns errors', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(
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
      expect(result.error).toContain('Rate limited');
      expect(result.error).toContain('Too many requests');
    });

    it('returns error when no news items found', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(
        makeResponse({
          json: async () => ({
            data: {
              explore_page: {
                body: {
                  initialTimeline: {
                    timeline: {
                      timeline: {
                        instructions: [],
                      },
                    },
                  },
                },
              },
            },
          }),
        }),
      );

      global.fetch = mockFetch as unknown as typeof fetch;

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getNews(10);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No news items found');
    });

    it('deduplicates headlines', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(
        makeResponse({
          json: async () => ({
            data: {
              explore_page: {
                body: {
                  initialTimeline: {
                    timeline: {
                      timeline: {
                        instructions: [
                          {
                            type: 'TimelineAddEntries',
                            entries: [
                              {
                                entryId: 'test-entry-1',
                                content: {
                                  items: [
                                    {
                                      itemContent: {
                                        is_ai_trend: true,
                                        name: 'Duplicate Headline',
                                      },
                                    },
                                  ],
                                },
                              },
                              {
                                entryId: 'test-entry-2',
                                content: {
                                  items: [
                                    {
                                      itemContent: {
                                        is_ai_trend: true,
                                        name: 'Duplicate Headline',
                                      },
                                    },
                                  ],
                                },
                              },
                            ],
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          }),
        }),
      );

      global.fetch = mockFetch as unknown as typeof fetch;

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getNews(10);

      expect(result.success).toBe(true);
      expect(result.items?.length).toBe(1);
      expect(result.items?.[0].headline).toBe('Duplicate Headline');
    });

    it('respects count parameter', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(
        makeResponse({
          json: async () => ({
            data: {
              explore_page: {
                body: {
                  initialTimeline: {
                    timeline: {
                      timeline: {
                        instructions: [
                          {
                            type: 'TimelineAddEntries',
                            entries: [
                              {
                                entryId: 'test-entry-1',
                                content: {
                                  items: [
                                    {
                                      itemContent: {
                                        is_ai_trend: true,
                                        name: 'News 1',
                                      },
                                    },
                                  ],
                                },
                              },
                              {
                                entryId: 'test-entry-2',
                                content: {
                                  items: [
                                    {
                                      itemContent: {
                                        is_ai_trend: true,
                                        name: 'News 2',
                                      },
                                    },
                                  ],
                                },
                              },
                              {
                                entryId: 'test-entry-3',
                                content: {
                                  items: [
                                    {
                                      itemContent: {
                                        is_ai_trend: true,
                                        name: 'News 3',
                                      },
                                    },
                                  ],
                                },
                              },
                            ],
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          }),
        }),
      );

      global.fetch = mockFetch as unknown as typeof fetch;

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getNews(2);

      expect(result.success).toBe(true);
      expect(result.items?.length).toBe(2);
    });
  });
});
