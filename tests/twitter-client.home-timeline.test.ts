import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwitterClient } from '../src/lib/twitter-client.js';
import { validCookies } from './twitter-client-fixtures.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

// Realistic fixture based on actual Twitter API response structure
const makeHomeTimelineResponse = (tweetId: string, text: string, username: string) => ({
  data: {
    home: {
      home_timeline_urt: {
        instructions: [
          {
            entries: [
              {
                content: {
                  itemContent: {
                    tweet_results: {
                      result: {
                        __typename: 'Tweet',
                        rest_id: tweetId,
                        legacy: {
                          full_text: text,
                          created_at: 'Mon Jan 06 00:00:00 +0000 2025',
                          reply_count: 5,
                          retweet_count: 10,
                          favorite_count: 25,
                          conversation_id_str: tweetId,
                        },
                        core: {
                          user_results: {
                            result: {
                              __typename: 'User',
                              rest_id: 'u123',
                              legacy: {
                                screen_name: username,
                                name: `${username} Name`,
                              },
                            },
                          },
                        },
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
  },
});

describe('TwitterClient home timeline', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  describe('getHomeTimeline', () => {
    it('should return tweets from For You feed', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeHomeTimelineResponse('123456', 'Hello from For You feed!', 'testuser'),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getHomeTimeline(1);

      expect(result.success).toBe(true);
      expect(result.tweets).toHaveLength(1);
      expect(result.tweets?.[0].id).toBe('123456');
      expect(result.tweets?.[0].text).toBe('Hello from For You feed!');
      expect(result.tweets?.[0].author.username).toBe('testuser');
    });

    it('should return error on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getHomeTimeline(1);

      expect(result.success).toBe(false);
      expect(result.error).toContain('401');
    });

    it('should return error when API returns errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          errors: [{ message: 'Rate limit exceeded' }],
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getHomeTimeline(1);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Rate limit exceeded');
    });
  });

  describe('getHomeLatestTimeline', () => {
    it('should return tweets from Following feed', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => makeHomeTimelineResponse('789012', 'Hello from Following feed!', 'chronouser'),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getHomeLatestTimeline(1);

      expect(result.success).toBe(true);
      expect(result.tweets).toHaveLength(1);
      expect(result.tweets?.[0].id).toBe('789012');
      expect(result.tweets?.[0].text).toBe('Hello from Following feed!');
      expect(result.tweets?.[0].author.username).toBe('chronouser');
    });

    it('should return error on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getHomeLatestTimeline(1);

      expect(result.success).toBe(false);
      expect(result.error).toContain('403');
    });
  });

  describe('pagination', () => {
    it('should deduplicate tweets across pages', async () => {
      // First page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            home: {
              home_timeline_urt: {
                instructions: [
                  {
                    entries: [
                      {
                        content: {
                          itemContent: {
                            tweet_results: {
                              result: {
                                rest_id: 'tweet1',
                                legacy: { full_text: 'First tweet', created_at: 'Mon Jan 06 00:00:00 +0000 2025' },
                                core: {
                                  user_results: {
                                    result: { rest_id: 'u1', legacy: { screen_name: 'user1', name: 'User 1' } },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                      {
                        content: {
                          cursorType: 'Bottom',
                          value: 'cursor123',
                        },
                      },
                    ],
                  },
                ],
              },
            },
          },
        }),
      });

      // Second page with duplicate
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            home: {
              home_timeline_urt: {
                instructions: [
                  {
                    entries: [
                      {
                        content: {
                          itemContent: {
                            tweet_results: {
                              result: {
                                rest_id: 'tweet1', // duplicate
                                legacy: { full_text: 'First tweet', created_at: 'Mon Jan 06 00:00:00 +0000 2025' },
                                core: {
                                  user_results: {
                                    result: { rest_id: 'u1', legacy: { screen_name: 'user1', name: 'User 1' } },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                      {
                        content: {
                          itemContent: {
                            tweet_results: {
                              result: {
                                rest_id: 'tweet2',
                                legacy: { full_text: 'Second tweet', created_at: 'Mon Jan 06 00:00:00 +0000 2025' },
                                core: {
                                  user_results: {
                                    result: { rest_id: 'u2', legacy: { screen_name: 'user2', name: 'User 2' } },
                                  },
                                },
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
          },
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getHomeTimeline(2);

      expect(result.success).toBe(true);
      expect(result.tweets).toHaveLength(2);
      expect(result.tweets?.[0].id).toBe('tweet1');
      expect(result.tweets?.[1].id).toBe('tweet2');
    });

    it('stops when a page only returns duplicates', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            home: {
              home_timeline_urt: {
                instructions: [
                  {
                    entries: [
                      {
                        content: {
                          itemContent: {
                            tweet_results: {
                              result: {
                                rest_id: 'tweet1',
                                legacy: { full_text: 'First tweet', created_at: 'Mon Jan 06 00:00:00 +0000 2025' },
                                core: {
                                  user_results: {
                                    result: { rest_id: 'u1', legacy: { screen_name: 'user1', name: 'User 1' } },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                      {
                        content: {
                          cursorType: 'Bottom',
                          value: 'cursor123',
                        },
                      },
                    ],
                  },
                ],
              },
            },
          },
        }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            home: {
              home_timeline_urt: {
                instructions: [
                  {
                    entries: [
                      {
                        content: {
                          itemContent: {
                            tweet_results: {
                              result: {
                                rest_id: 'tweet1',
                                legacy: { full_text: 'First tweet', created_at: 'Mon Jan 06 00:00:00 +0000 2025' },
                                core: {
                                  user_results: {
                                    result: { rest_id: 'u1', legacy: { screen_name: 'user1', name: 'User 1' } },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                      {
                        content: {
                          cursorType: 'Bottom',
                          value: 'cursor456',
                        },
                      },
                    ],
                  },
                ],
              },
            },
          },
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getHomeTimeline(5);

      expect(result.success).toBe(true);
      expect(result.tweets).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('respects maxPages option', async () => {
      // First page with cursor
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            home: {
              home_timeline_urt: {
                instructions: [
                  {
                    entries: [
                      {
                        content: {
                          itemContent: {
                            tweet_results: {
                              result: {
                                rest_id: 'tweet1',
                                legacy: { full_text: 'First tweet', created_at: 'Mon Jan 06 00:00:00 +0000 2025' },
                                core: {
                                  user_results: {
                                    result: { rest_id: 'u1', legacy: { screen_name: 'user1', name: 'User 1' } },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                      {
                        content: {
                          cursorType: 'Bottom',
                          value: 'cursor-page-2',
                        },
                      },
                    ],
                  },
                ],
              },
            },
          },
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getHomeTimeline(10, { maxPages: 1 });

      expect(result.success).toBe(true);
      expect(result.tweets).toHaveLength(1);
      expect(result.nextCursor).toBe('cursor-page-2');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('resumes from provided cursor', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            home: {
              home_timeline_urt: {
                instructions: [
                  {
                    entries: [
                      {
                        content: {
                          itemContent: {
                            tweet_results: {
                              result: {
                                rest_id: 'tweet2',
                                legacy: {
                                  full_text: 'Second page tweet',
                                  created_at: 'Mon Jan 06 00:00:00 +0000 2025',
                                },
                                core: {
                                  user_results: {
                                    result: { rest_id: 'u2', legacy: { screen_name: 'user2', name: 'User 2' } },
                                  },
                                },
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
          },
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getHomeTimeline(1, { cursor: 'resume-cursor' });

      expect(result.success).toBe(true);
      expect(result.tweets).toHaveLength(1);
      expect(result.tweets?.[0].id).toBe('tweet2');

      // Verify cursor was passed in the request
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('resume-cursor');
    });

    it('returns undefined nextCursor when no more pages', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            home: {
              home_timeline_urt: {
                instructions: [
                  {
                    entries: [
                      {
                        content: {
                          itemContent: {
                            tweet_results: {
                              result: {
                                rest_id: 'tweet1',
                                legacy: { full_text: 'Only tweet', created_at: 'Mon Jan 06 00:00:00 +0000 2025' },
                                core: {
                                  user_results: {
                                    result: { rest_id: 'u1', legacy: { screen_name: 'user1', name: 'User 1' } },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                      // No cursor entry - end of timeline
                    ],
                  },
                ],
              },
            },
          },
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getHomeTimeline(1);

      expect(result.success).toBe(true);
      expect(result.tweets).toHaveLength(1);
      expect(result.nextCursor).toBeUndefined();
    });

    it('works with getHomeLatestTimeline too', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            home: {
              home_timeline_urt: {
                instructions: [
                  {
                    entries: [
                      {
                        content: {
                          itemContent: {
                            tweet_results: {
                              result: {
                                rest_id: 'latest1',
                                legacy: { full_text: 'Latest tweet', created_at: 'Mon Jan 06 00:00:00 +0000 2025' },
                                core: {
                                  user_results: {
                                    result: { rest_id: 'u1', legacy: { screen_name: 'user1', name: 'User 1' } },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                      {
                        content: {
                          cursorType: 'Bottom',
                          value: 'latest-cursor',
                        },
                      },
                    ],
                  },
                ],
              },
            },
          },
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getHomeLatestTimeline(10, { maxPages: 1 });

      expect(result.success).toBe(true);
      expect(result.tweets).toHaveLength(1);
      expect(result.nextCursor).toBe('latest-cursor');
    });
  });
});
