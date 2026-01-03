// ABOUTME: Tests for TwitterClient list methods.
// ABOUTME: Tests getOwnedLists, getListMemberships, and getListTimeline.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwitterClient } from '../src/lib/twitter-client.js';
import { type TwitterClientPrivate, validCookies } from './twitter-client-fixtures.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('TwitterClient lists', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  describe('getOwnedLists', () => {
    it('fetches owned lists and parses list results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            user: {
              result: {
                timeline: {
                  timeline: {
                    instructions: [
                      {
                        entries: [
                          {
                            content: {
                              itemContent: {
                                list: {
                                  id_str: '1234567890',
                                  name: 'My Test List',
                                  description: 'A test list for testing',
                                  member_count: 10,
                                  subscriber_count: 5,
                                  mode: 'Public',
                                  created_at: '2024-01-01T00:00:00Z',
                                  user_results: {
                                    result: {
                                      rest_id: '12345',
                                      legacy: { screen_name: 'testuser', name: 'Test User' },
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
            },
          },
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      clientPrivate.getCurrentUser = async () => ({
        success: true,
        user: { id: '12345', username: 'testuser', name: 'Test User' },
      });
      clientPrivate.getListOwnershipsQueryIds = async () => ['test'];

      const result = await client.getOwnedLists(100);

      expect(result.success).toBe(true);
      expect(result.lists).toHaveLength(1);
      expect(result.lists?.[0].id).toBe('1234567890');
      expect(result.lists?.[0].name).toBe('My Test List');
      expect(result.lists?.[0].description).toBe('A test list for testing');
      expect(result.lists?.[0].memberCount).toBe(10);
      expect(result.lists?.[0].subscriberCount).toBe(5);
      expect(result.lists?.[0].isPrivate).toBe(false);
      expect(result.lists?.[0].owner?.username).toBe('testuser');
    });

    it('handles private lists correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            user: {
              result: {
                timeline: {
                  timeline: {
                    instructions: [
                      {
                        entries: [
                          {
                            content: {
                              itemContent: {
                                list: {
                                  id_str: '9999',
                                  name: 'Secret List',
                                  mode: 'Private',
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
            },
          },
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      clientPrivate.getCurrentUser = async () => ({
        success: true,
        user: { id: '12345', username: 'testuser', name: 'Test User' },
      });
      clientPrivate.getListOwnershipsQueryIds = async () => ['test'];

      const result = await client.getOwnedLists(100);

      expect(result.success).toBe(true);
      expect(result.lists?.[0].isPrivate).toBe(true);
    });

    it('handles lowercase private mode', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            user: {
              result: {
                timeline: {
                  timeline: {
                    instructions: [
                      {
                        entries: [
                          {
                            content: {
                              itemContent: {
                                list: {
                                  id_str: '8888',
                                  name: 'Lowercase Private',
                                  mode: 'private',
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
            },
          },
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      clientPrivate.getCurrentUser = async () => ({
        success: true,
        user: { id: '12345', username: 'testuser', name: 'Test User' },
      });
      clientPrivate.getListOwnershipsQueryIds = async () => ['test'];

      const result = await client.getOwnedLists(100);

      expect(result.success).toBe(true);
      expect(result.lists?.[0].isPrivate).toBe(true);
    });

    it('returns empty array when no lists exist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            user: {
              result: {
                timeline: {
                  timeline: {
                    instructions: [],
                  },
                },
              },
            },
          },
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      clientPrivate.getCurrentUser = async () => ({
        success: true,
        user: { id: '12345', username: 'testuser', name: 'Test User' },
      });
      clientPrivate.getListOwnershipsQueryIds = async () => ['test'];

      const result = await client.getOwnedLists(100);

      expect(result.success).toBe(true);
      expect(result.lists).toEqual([]);
    });

    it('returns error on API failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      clientPrivate.getCurrentUser = async () => ({
        success: true,
        user: { id: '12345', username: 'testuser', name: 'Test User' },
      });
      clientPrivate.getListOwnershipsQueryIds = async () => ['test'];

      const result = await client.getOwnedLists(100);

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 500');
    });

    it('returns error when getCurrentUser fails', async () => {
      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      clientPrivate.getCurrentUser = async () => ({
        success: false,
        error: 'Unauthorized',
      });

      const result = await client.getOwnedLists(100);

      expect(result.success).toBe(false);
      // When getCurrentUser fails with an error, that error is used; otherwise fallback message is used
      expect(result.error).toContain('Unauthorized');
    });

    it('handles API errors in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          errors: [{ message: 'Rate limit exceeded' }],
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      clientPrivate.getCurrentUser = async () => ({
        success: true,
        user: { id: '12345', username: 'testuser', name: 'Test User' },
      });
      clientPrivate.getListOwnershipsQueryIds = async () => ['test'];

      const result = await client.getOwnedLists(100);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Rate limit exceeded');
    });

    it('retries on 404 error after refreshing query IDs', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: async () => 'Not Found',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              user: {
                result: {
                  timeline: {
                    timeline: {
                      instructions: [
                        {
                          entries: [
                            {
                              content: {
                                itemContent: {
                                  list: {
                                    id_str: '333',
                                    name: 'Retry List',
                                    mode: 'Public',
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
              },
            },
          }),
        });

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      clientPrivate.getCurrentUser = async () => ({
        success: true,
        user: { id: '12345', username: 'testuser', name: 'Test User' },
      });
      clientPrivate.getListOwnershipsQueryIds = async () => ['test'];
      clientPrivate.refreshQueryIds = async () => {};

      const result = await client.getOwnedLists(100);

      expect(result.success).toBe(true);
      expect(result.lists?.[0].id).toBe('333');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('skips list entries with missing id_str or name', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            user: {
              result: {
                timeline: {
                  timeline: {
                    instructions: [
                      {
                        entries: [
                          {
                            content: {
                              itemContent: {
                                list: {
                                  id_str: '111',
                                  name: 'Valid List',
                                },
                              },
                            },
                          },
                          {
                            content: {
                              itemContent: {
                                list: {
                                  // Missing id_str
                                  name: 'Invalid List 1',
                                },
                              },
                            },
                          },
                          {
                            content: {
                              itemContent: {
                                list: {
                                  id_str: '222',
                                  // Missing name
                                },
                              },
                            },
                          },
                          {
                            content: {
                              itemContent: {
                                list: {
                                  id_str: '333',
                                  name: 'Another Valid List',
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
            },
          },
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      clientPrivate.getCurrentUser = async () => ({
        success: true,
        user: { id: '12345', username: 'testuser', name: 'Test User' },
      });
      clientPrivate.getListOwnershipsQueryIds = async () => ['test'];

      const result = await client.getOwnedLists(100);

      expect(result.success).toBe(true);
      expect(result.lists).toHaveLength(2);
      expect(result.lists?.[0].id).toBe('111');
      expect(result.lists?.[1].id).toBe('333');
    });

    it('handles list with missing owner gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            user: {
              result: {
                timeline: {
                  timeline: {
                    instructions: [
                      {
                        entries: [
                          {
                            content: {
                              itemContent: {
                                list: {
                                  id_str: '444',
                                  name: 'List Without Owner',
                                  // No user_results
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
            },
          },
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      clientPrivate.getCurrentUser = async () => ({
        success: true,
        user: { id: '12345', username: 'testuser', name: 'Test User' },
      });
      clientPrivate.getListOwnershipsQueryIds = async () => ['test'];

      const result = await client.getOwnedLists(100);

      expect(result.success).toBe(true);
      expect(result.lists).toHaveLength(1);
      expect(result.lists?.[0].owner).toBeUndefined();
    });
  });

  describe('getListMemberships', () => {
    it('fetches list memberships and parses list results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            user: {
              result: {
                timeline: {
                  timeline: {
                    instructions: [
                      {
                        entries: [
                          {
                            content: {
                              itemContent: {
                                list: {
                                  id_str: '5555',
                                  name: 'Member List',
                                  member_count: 100,
                                  user_results: {
                                    result: {
                                      rest_id: '99999',
                                      legacy: { screen_name: 'otheruser', name: 'Other User' },
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
            },
          },
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      clientPrivate.getCurrentUser = async () => ({
        success: true,
        user: { id: '12345', username: 'testuser', name: 'Test User' },
      });
      clientPrivate.getListMembershipsQueryIds = async () => ['test'];

      const result = await client.getListMemberships(100);

      expect(result.success).toBe(true);
      expect(result.lists?.[0].id).toBe('5555');
      expect(result.lists?.[0].name).toBe('Member List');
      expect(result.lists?.[0].owner?.username).toBe('otheruser');
    });

    it('retries on 404 error after refreshing query IDs', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: async () => 'Not Found',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              user: {
                result: {
                  timeline: {
                    timeline: {
                      instructions: [
                        {
                          entries: [
                            {
                              content: {
                                itemContent: {
                                  list: {
                                    id_str: '6666',
                                    name: 'Retry Membership List',
                                    mode: 'Public',
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
              },
            },
          }),
        });

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      clientPrivate.getCurrentUser = async () => ({
        success: true,
        user: { id: '12345', username: 'testuser', name: 'Test User' },
      });
      clientPrivate.getListMembershipsQueryIds = async () => ['test'];
      clientPrivate.refreshQueryIds = async () => {};

      const result = await client.getListMemberships(100);

      expect(result.success).toBe(true);
      expect(result.lists?.[0].id).toBe('6666');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('getListTimeline', () => {
    it('fetches list timeline and parses tweet results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            list: {
              tweets_timeline: {
                timeline: {
                  instructions: [
                    {
                      entries: [
                        {
                          content: {
                            itemContent: {
                              tweet_results: {
                                result: {
                                  rest_id: '111',
                                  legacy: {
                                    full_text: 'Tweet from list',
                                    created_at: '2024-01-01T00:00:00Z',
                                    reply_count: 0,
                                    retweet_count: 0,
                                    favorite_count: 0,
                                    conversation_id_str: '111',
                                  },
                                  core: {
                                    user_results: {
                                      result: {
                                        rest_id: 'u1',
                                        legacy: { screen_name: 'listmember', name: 'List Member' },
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
          },
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      clientPrivate.getListTimelineQueryIds = async () => ['test'];

      const result = await client.getListTimeline('1234567890', 20);

      expect(result.success).toBe(true);
      expect(result.tweets?.[0].id).toBe('111');
      expect(result.tweets?.[0].text).toBe('Tweet from list');
      expect(result.tweets?.[0].author.username).toBe('listmember');
    });

    it('returns empty array when list has no tweets', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            list: {
              tweets_timeline: {
                timeline: {
                  instructions: [],
                },
              },
            },
          },
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      clientPrivate.getListTimelineQueryIds = async () => ['test'];

      const result = await client.getListTimeline('1234567890', 20);

      expect(result.success).toBe(true);
      expect(result.tweets).toEqual([]);
    });

    it('returns error on API failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      });

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      clientPrivate.getListTimelineQueryIds = async () => ['test'];

      const result = await client.getListTimeline('1234567890', 20);

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 403');
    });

    it('handles API errors in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          errors: [{ message: 'List not found' }],
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      clientPrivate.getListTimelineQueryIds = async () => ['test'];

      const result = await client.getListTimeline('nonexistent', 20);

      expect(result.success).toBe(false);
      expect(result.error).toContain('List not found');
    });

    it('retries on 404 error after refreshing query IDs', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: async () => 'Not Found',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              list: {
                tweets_timeline: {
                  timeline: {
                    instructions: [
                      {
                        entries: [
                          {
                            content: {
                              itemContent: {
                                tweet_results: {
                                  result: {
                                    rest_id: '222',
                                    legacy: {
                                      full_text: 'Retry success',
                                      created_at: '2024-01-01T00:00:00Z',
                                      reply_count: 0,
                                      retweet_count: 0,
                                      favorite_count: 0,
                                      conversation_id_str: '222',
                                    },
                                    core: {
                                      user_results: {
                                        result: {
                                          rest_id: 'u2',
                                          legacy: { screen_name: 'user2', name: 'User Two' },
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
            },
          }),
        });

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      clientPrivate.getListTimelineQueryIds = async () => ['test'];
      clientPrivate.refreshQueryIds = async () => {};

      const result = await client.getListTimeline('1234567890', 20);

      expect(result.success).toBe(true);
      expect(result.tweets?.[0].id).toBe('222');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
