import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwitterClient } from '../src/lib/twitter-client.js';
import { validCookies } from './twitter-client-fixtures.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('TwitterClient pagination for thread and replies', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  const makeConversationPayload = (tweetIds: string[], cursor?: string, inReplyTo?: string, conversationId = '1') => ({
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: [
          {
            type: 'TimelineAddEntries',
            entries: [
              ...tweetIds.map((id, i) => ({
                entryId: `tweet-${id}`,
                content: {
                  itemContent: {
                    tweet_results: {
                      result: {
                        rest_id: id,
                        legacy: {
                          full_text: `tweet ${id}`,
                          created_at: `2024-01-0${i + 1}T00:00:00Z`,
                          reply_count: 0,
                          retweet_count: 0,
                          favorite_count: 0,
                          conversation_id_str: conversationId,
                          ...(inReplyTo ? { in_reply_to_status_id_str: inReplyTo } : {}),
                        },
                        core: {
                          user_results: { result: { legacy: { screen_name: `user${id}`, name: `User ${id}` } } },
                        },
                      },
                    },
                  },
                },
              })),
              // Add cursor entry if provided
              ...(cursor
                ? [
                    {
                      entryId: `cursor-bottom-${Date.now()}`,
                      content: {
                        cursorType: 'Bottom',
                        value: cursor,
                      },
                    },
                  ]
                : []),
            ],
          },
        ],
      },
    },
  });

  describe('getRepliesPaged', () => {
    it('returns replies from single page when no cursor in response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => makeConversationPayload(['2', '3'], undefined, '1'),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getRepliesPaged('1');

      expect(result.success).toBe(true);
      expect(result.tweets?.length).toBe(2);
      expect(result.nextCursor).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('fetches multiple pages when cursor is present and --all is used', async () => {
      // First page returns cursor, second page does not
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeConversationPayload(['2', '3'], 'cursor-page-2', '1'),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeConversationPayload(['4', '5'], undefined, '1'),
        });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getRepliesPaged('1', { pageDelayMs: 0 });

      expect(result.success).toBe(true);
      expect(result.tweets?.length).toBe(4);
      expect(result.tweets?.map((t) => t.id)).toEqual(['2', '3', '4', '5']);
      expect(result.nextCursor).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('respects maxPages option', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeConversationPayload(['2', '3'], 'cursor-page-2', '1'),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeConversationPayload(['4', '5'], 'cursor-page-3', '1'),
        });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getRepliesPaged('1', { maxPages: 2, pageDelayMs: 0 });

      expect(result.success).toBe(true);
      expect(result.tweets?.length).toBe(4);
      expect(result.nextCursor).toBe('cursor-page-3');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('resumes from provided cursor', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => makeConversationPayload(['4', '5'], undefined, '1'),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getRepliesPaged('1', { cursor: 'resume-cursor', pageDelayMs: 0 });

      expect(result.success).toBe(true);
      expect(result.tweets?.length).toBe(2);
      // Verify cursor was passed in the request
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('resume-cursor');
    });

    it('deduplicates tweets across pages', async () => {
      // Second page returns a duplicate tweet
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeConversationPayload(['2', '3'], 'cursor-page-2', '1'),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeConversationPayload(['3', '4'], undefined, '1'), // '3' is duplicate
        });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getRepliesPaged('1', { pageDelayMs: 0 });

      expect(result.success).toBe(true);
      expect(result.tweets?.length).toBe(3); // 2, 3, 4 (no duplicate)
      expect(result.tweets?.map((t) => t.id)).toEqual(['2', '3', '4']);
    });

    it('returns partial results on error after first page', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeConversationPayload(['2', '3'], 'cursor-page-2', '1'),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => 'Internal Server Error',
        });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getRepliesPaged('1', { pageDelayMs: 0 });

      expect(result.success).toBe(true);
      expect(result.tweets?.length).toBe(2);
      expect(result.error).toContain('500');
      expect(result.nextCursor).toBe('cursor-page-2');
    });
  });

  describe('getThreadPaged', () => {
    it('returns thread tweets from single page', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => makeConversationPayload(['1', '2', '3'], undefined, undefined, '1'),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getThreadPaged('1');

      expect(result.success).toBe(true);
      expect(result.tweets?.length).toBe(3);
      expect(result.nextCursor).toBeUndefined();
    });

    it('fetches multiple pages for thread', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeConversationPayload(['1', '2'], 'cursor-page-2', undefined, '1'),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeConversationPayload(['3', '4'], undefined, undefined, '1'),
        });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getThreadPaged('1', { pageDelayMs: 0 });

      expect(result.success).toBe(true);
      expect(result.tweets?.length).toBe(4);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('sorts thread tweets by creation time', async () => {
      // Return tweets in non-chronological order
      const payload = {
        data: {
          threaded_conversation_with_injections_v2: {
            instructions: [
              {
                type: 'TimelineAddEntries',
                entries: [
                  {
                    entryId: 'tweet-3',
                    content: {
                      itemContent: {
                        tweet_results: {
                          result: {
                            rest_id: '3',
                            legacy: {
                              full_text: 'tweet 3',
                              created_at: '2024-01-03T00:00:00Z',
                              reply_count: 0,
                              retweet_count: 0,
                              favorite_count: 0,
                              conversation_id_str: '1',
                            },
                            core: { user_results: { result: { legacy: { screen_name: 'user3', name: 'User 3' } } } },
                          },
                        },
                      },
                    },
                  },
                  {
                    entryId: 'tweet-1',
                    content: {
                      itemContent: {
                        tweet_results: {
                          result: {
                            rest_id: '1',
                            legacy: {
                              full_text: 'tweet 1',
                              created_at: '2024-01-01T00:00:00Z',
                              reply_count: 0,
                              retweet_count: 0,
                              favorite_count: 0,
                              conversation_id_str: '1',
                            },
                            core: { user_results: { result: { legacy: { screen_name: 'user1', name: 'User 1' } } } },
                          },
                        },
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => payload,
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getThreadPaged('1');

      expect(result.success).toBe(true);
      expect(result.tweets?.map((t) => t.id)).toEqual(['1', '3']); // Sorted by date
    });

    it('filters by conversation ID', async () => {
      // Include a tweet from a different conversation
      const payload = {
        data: {
          threaded_conversation_with_injections_v2: {
            instructions: [
              {
                type: 'TimelineAddEntries',
                entries: [
                  {
                    entryId: 'tweet-1',
                    content: {
                      itemContent: {
                        tweet_results: {
                          result: {
                            rest_id: '1',
                            legacy: {
                              full_text: 'tweet 1',
                              created_at: '2024-01-01T00:00:00Z',
                              reply_count: 0,
                              retweet_count: 0,
                              favorite_count: 0,
                              conversation_id_str: '1',
                            },
                            core: { user_results: { result: { legacy: { screen_name: 'user1', name: 'User 1' } } } },
                          },
                        },
                      },
                    },
                  },
                  {
                    entryId: 'tweet-99',
                    content: {
                      itemContent: {
                        tweet_results: {
                          result: {
                            rest_id: '99',
                            legacy: {
                              full_text: 'different conversation',
                              created_at: '2024-01-02T00:00:00Z',
                              reply_count: 0,
                              retweet_count: 0,
                              favorite_count: 0,
                              conversation_id_str: '99', // Different conversation
                            },
                            core: { user_results: { result: { legacy: { screen_name: 'user99', name: 'User 99' } } } },
                          },
                        },
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => payload,
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getThreadPaged('1');

      expect(result.success).toBe(true);
      expect(result.tweets?.length).toBe(1);
      expect(result.tweets?.[0].id).toBe('1');
    });

    it('respects maxPages for thread', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeConversationPayload(['1', '2'], 'cursor-page-2', undefined, '1'),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeConversationPayload(['3', '4'], 'cursor-page-3', undefined, '1'),
        });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getThreadPaged('1', { maxPages: 2, pageDelayMs: 0 });

      expect(result.success).toBe(true);
      expect(result.tweets?.length).toBe(4);
      expect(result.nextCursor).toBe('cursor-page-3');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
