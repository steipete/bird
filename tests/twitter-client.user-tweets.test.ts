import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwitterClient } from '../src/lib/twitter-client.js';
import { validCookies } from './twitter-client-fixtures.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('TwitterClient getUserIdByUsername', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it('resolves username to userId via GraphQL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          user: {
            result: {
              __typename: 'User',
              rest_id: '12345',
              legacy: {
                screen_name: 'testuser',
                name: 'Test User',
              },
            },
          },
        },
      }),
    });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getUserIdByUsername('@testuser');

    expect(result.success).toBe(true);
    expect(result.userId).toBe('12345');
    expect(result.username).toBe('testuser');
    expect(result.name).toBe('Test User');
  });

  it('handles username without @ prefix', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          user: {
            result: {
              __typename: 'User',
              rest_id: '67890',
              legacy: {
                screen_name: 'anotheruser',
                name: 'Another User',
              },
            },
          },
        },
      }),
    });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getUserIdByUsername('anotheruser');

    expect(result.success).toBe(true);
    expect(result.userId).toBe('67890');
  });

  it('returns error for invalid username format', async () => {
    const client = new TwitterClient({ cookies: validCookies });

    const result = await client.getUserIdByUsername('invalid handle with spaces');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid username');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns error for empty username', async () => {
    const client = new TwitterClient({ cookies: validCookies });

    const result = await client.getUserIdByUsername('');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid username');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns error for username exceeding 15 characters', async () => {
    const client = new TwitterClient({ cookies: validCookies });

    const result = await client.getUserIdByUsername('thisusernameiswaytoolong');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid username');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns error when user is unavailable', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          user: {
            result: {
              __typename: 'UserUnavailable',
            },
          },
        },
      }),
    });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getUserIdByUsername('suspended');

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found or unavailable');
  });

  it('retries with fallback query IDs on 404', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Not found',
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Not found',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            user: {
              result: {
                __typename: 'User',
                rest_id: '99999',
                legacy: {
                  screen_name: 'founduser',
                  name: 'Found User',
                },
              },
            },
          },
        }),
      });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getUserIdByUsername('founduser');

    expect(result.success).toBe(true);
    expect(result.userId).toBe('99999');
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});

describe('TwitterClient getUserTweets', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  const makeTweetResult = (id: string, text: string, username = 'testuser') => ({
    rest_id: id,
    legacy: {
      full_text: text,
      created_at: '2024-01-01T00:00:00Z',
      reply_count: 1,
      retweet_count: 2,
      favorite_count: 3,
      conversation_id_str: id,
    },
    core: {
      user_results: {
        result: {
          rest_id: '12345',
          legacy: {
            screen_name: username,
            name: 'Test User',
          },
        },
      },
    },
  });

  const makeTimelineResponse = (tweets: ReturnType<typeof makeTweetResult>[], cursor?: string) => ({
    data: {
      user: {
        result: {
          timeline: {
            timeline: {
              instructions: [
                {
                  type: 'TimelineAddEntries',
                  entries: [
                    ...tweets.map((t) => ({
                      entryId: `tweet-${t.rest_id}`,
                      content: {
                        entryType: 'TimelineTimelineItem',
                        itemContent: {
                          tweet_results: {
                            result: t,
                          },
                        },
                      },
                    })),
                    ...(cursor
                      ? [
                          {
                            entryId: 'cursor-bottom-123',
                            content: {
                              entryType: 'TimelineTimelineCursor',
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
        },
      },
    },
  });

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it('fetches and parses user tweets', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () =>
        makeTimelineResponse([makeTweetResult('1', 'First tweet'), makeTweetResult('2', 'Second tweet')]),
    });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getUserTweets('12345', 10);

    expect(result.success).toBe(true);
    expect(result.tweets?.length).toBe(2);
    expect(result.tweets?.[0].id).toBe('1');
    expect(result.tweets?.[0].text).toBe('First tweet');
    expect(result.tweets?.[1].id).toBe('2');
    expect(result.tweets?.[1].text).toBe('Second tweet');
  });

  it('respects count parameter', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () =>
        makeTimelineResponse([
          makeTweetResult('1', 'First'),
          makeTweetResult('2', 'Second'),
          makeTweetResult('3', 'Third'),
        ]),
    });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getUserTweets('12345', 2);

    expect(result.success).toBe(true);
    expect(result.tweets?.length).toBe(2);
  });

  it('returns empty array for user with no tweets', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => makeTimelineResponse([]),
    });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getUserTweets('12345', 10);

    expect(result.success).toBe(true);
    expect(result.tweets).toEqual([]);
  });

  it('extracts cursor for pagination', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => makeTimelineResponse([makeTweetResult('1', 'Tweet')], 'next-cursor-abc'),
    });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getUserTweetsPaged('12345', { maxPages: 1 });

    expect(result.success).toBe(true);
    expect(result.nextCursor).toBe('next-cursor-abc');
  });

  it('handles API errors gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getUserTweets('12345', 10);

    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 500');
  });
});

describe('TwitterClient getUserTweetsPaged', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  const makeTweetResult = (id: string, text: string) => ({
    rest_id: id,
    legacy: {
      full_text: text,
      created_at: '2024-01-01T00:00:00Z',
      reply_count: 0,
      retweet_count: 0,
      favorite_count: 0,
      conversation_id_str: id,
    },
    core: {
      user_results: {
        result: {
          rest_id: '12345',
          legacy: {
            screen_name: 'testuser',
            name: 'Test User',
          },
        },
      },
    },
  });

  const makeTimelineResponse = (tweets: ReturnType<typeof makeTweetResult>[], cursor?: string) => ({
    data: {
      user: {
        result: {
          timeline: {
            timeline: {
              instructions: [
                {
                  type: 'TimelineAddEntries',
                  entries: [
                    ...tweets.map((t) => ({
                      entryId: `tweet-${t.rest_id}`,
                      content: {
                        entryType: 'TimelineTimelineItem',
                        itemContent: {
                          tweet_results: {
                            result: t,
                          },
                        },
                      },
                    })),
                    ...(cursor
                      ? [
                          {
                            entryId: 'cursor-bottom-123',
                            content: {
                              entryType: 'TimelineTimelineCursor',
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
        },
      },
    },
  });

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it('fetches multiple pages with cursor', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeTimelineResponse([makeTweetResult('1', 'Page 1 Tweet')], 'cursor-page-2'),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeTimelineResponse([makeTweetResult('2', 'Page 2 Tweet')], 'cursor-page-3'),
      });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getUserTweetsPaged('12345', {
      maxPages: 2,
      pageDelayMs: 0, // No delay for tests
    });

    expect(result.success).toBe(true);
    expect(result.tweets?.length).toBe(2);
    expect(result.tweets?.[0].id).toBe('1');
    expect(result.tweets?.[1].id).toBe('2');
    expect(result.nextCursor).toBe('cursor-page-3');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('respects maxPages limit', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeTimelineResponse([makeTweetResult('1', 'Tweet 1')], 'cursor-2'),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeTimelineResponse([makeTweetResult('2', 'Tweet 2')], 'cursor-3'),
      });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getUserTweetsPaged('12345', {
      maxPages: 2,
      pageDelayMs: 0,
    });

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.nextCursor).toBe('cursor-3'); // Has more but stopped at maxPages
  });

  it('stops when no more cursor is returned', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeTimelineResponse([makeTweetResult('1', 'Tweet 1')], 'cursor-2'),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeTimelineResponse([makeTweetResult('2', 'Tweet 2')]), // No cursor = end
      });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getUserTweetsPaged('12345', {
      maxPages: 5,
      pageDelayMs: 0,
    });

    expect(result.success).toBe(true);
    expect(result.tweets?.length).toBe(2);
    expect(result.nextCursor).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('deduplicates tweets across pages', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeTimelineResponse([makeTweetResult('1', 'Tweet 1')], 'cursor-2'),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () =>
          makeTimelineResponse([
            makeTweetResult('1', 'Tweet 1'), // Duplicate
            makeTweetResult('2', 'Tweet 2'),
          ]),
      });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getUserTweetsPaged('12345', {
      maxPages: 2,
      pageDelayMs: 0,
    });

    expect(result.success).toBe(true);
    expect(result.tweets?.length).toBe(2); // Not 3
    expect(result.tweets?.map((t) => t.id)).toEqual(['1', '2']);
  });

  it('resumes from provided cursor', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => makeTimelineResponse([makeTweetResult('5', 'Resumed Tweet')]),
    });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getUserTweetsPaged('12345', {
      maxPages: 1,
      cursor: 'resume-cursor-xyz',
      pageDelayMs: 0,
    });

    expect(result.success).toBe(true);
    expect(result.tweets?.[0].id).toBe('5');

    // Verify cursor was passed in the request
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('resume-cursor-xyz');
  });
});
