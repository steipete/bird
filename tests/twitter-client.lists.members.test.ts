// ABOUTME: Tests for TwitterClient list methods.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwitterClient } from '../src/lib/twitter-client.js';
import { type TwitterClientPrivate, validCookies } from './twitter-client-fixtures.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('TwitterClient lists members', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  const makeUserResult = (id: string, username: string, name = username) => ({
    __typename: 'User',
    rest_id: id,
    is_blue_verified: true,
    legacy: {
      screen_name: username,
      name,
      description: `bio-${id}`,
      followers_count: 10,
      friends_count: 5,
      profile_image_url_https: `https://example.com/${id}.jpg`,
      created_at: '2024-01-01T00:00:00Z',
    },
  });

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  describe('getListMembers', () => {
    it('fetches list members and parses user results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            list: {
              members_timeline: {
                timeline: {
                  instructions: [
                    {
                      entries: [
                        {
                          content: {
                            itemContent: {
                              user_results: {
                                result: makeUserResult('1', 'alpha', 'Alpha'),
                              },
                            },
                          },
                        },
                        {
                          content: {
                            itemContent: {
                              user_results: {
                                result: { __typename: 'User', rest_id: '2' },
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
      clientPrivate.getListMembersQueryIds = async () => ['test'];

      const result = await client.getListMembers('1234567890', 20);

      expect(result.success).toBe(true);
      expect(result.members).toHaveLength(1);
      expect(result.members?.[0].id).toBe('1');
      expect(result.members?.[0].username).toBe('alpha');
      expect(result.members?.[0].followersCount).toBe(10);
      expect(result.members?.[0].followingCount).toBe(5);
      expect(result.members?.[0].isBlueVerified).toBe(true);
      expect(result.members?.[0].profileImageUrl).toBe('https://example.com/1.jpg');
      expect(result.members?.[0].createdAt).toBe('2024-01-01T00:00:00Z');
    });

    it('passes cursor parameter and returns nextCursor', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            list: {
              members_timeline: {
                timeline: {
                  instructions: [
                    {
                      entries: [
                        {
                          content: {
                            itemContent: {
                              user_results: {
                                result: makeUserResult('9', 'beta', 'Beta'),
                              },
                            },
                          },
                        },
                        {
                          content: {
                            cursorType: 'Bottom',
                            value: 'members-next-cursor',
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
      clientPrivate.getListMembersQueryIds = async () => ['test'];

      const result = await client.getListMembers('1234567890', 50, 'my-cursor');

      expect(result.success).toBe(true);
      expect(result.members?.[0].username).toBe('beta');
      expect(result.nextCursor).toBe('members-next-cursor');

      const [url] = mockFetch.mock.calls[0];
      const parsedVars = JSON.parse(new URL(url as string).searchParams.get('variables') as string);
      expect(parsedVars.cursor).toBe('my-cursor');
    });

    it('returns error on HTTP failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      clientPrivate.getListMembersQueryIds = async () => ['test'];

      const result = await client.getListMembers('1234567890', 20);

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 500');
    });

    it('handles API errors in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          errors: [{ message: 'List members unavailable' }],
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      clientPrivate.getListMembersQueryIds = async () => ['test'];

      const result = await client.getListMembers('1234567890', 20);

      expect(result.success).toBe(false);
      expect(result.error).toContain('List members unavailable');
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
                members_timeline: {
                  timeline: {
                    instructions: [
                      {
                        entries: [
                          {
                            content: {
                              itemContent: {
                                user_results: {
                                  result: makeUserResult('3', 'gamma', 'Gamma'),
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
      clientPrivate.getListMembersQueryIds = async () => ['test'];
      clientPrivate.refreshQueryIds = async () => {};

      const result = await client.getListMembers('1234567890', 20);

      expect(result.success).toBe(true);
      expect(result.members?.[0].id).toBe('3');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
