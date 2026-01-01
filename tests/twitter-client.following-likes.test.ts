import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwitterClient } from '../src/lib/twitter-client.js';
import { type TwitterClientPrivate, validCookies } from './twitter-client-fixtures.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('TwitterClient following/followers', () => {
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

  it('fetches following users and filters invalid entries', async () => {
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
                      type: 'TimelineAddEntries',
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
                        {
                          content: {
                            itemContent: {
                              user_results: {
                                result: { __typename: 'TimelineUser' },
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
    const clientPrivate = client as unknown as TwitterClient & { getFollowingQueryIds: () => Promise<string[]> };
    clientPrivate.getFollowingQueryIds = async () => ['test'];

    const result = await client.getFollowing('123', 2);

    expect(result.success).toBe(true);
    expect(result.users?.length).toBe(1);
    expect(result.users?.[0].username).toBe('alpha');
    expect(result.users?.[0].followersCount).toBe(10);
    expect(result.users?.[0].followingCount).toBe(5);
    expect(result.users?.[0].isBlueVerified).toBe(true);
    expect(result.users?.[0].profileImageUrl).toBe('https://example.com/1.jpg');
    expect(result.users?.[0].createdAt).toBe('2024-01-01T00:00:00Z');
    const [url] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('/Following?');
  });

  it('fetches followers and unwraps visibility results', async () => {
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
                              user_results: {
                                result: {
                                  __typename: 'UserWithVisibilityResults',
                                  user: makeUserResult('9', 'vis', 'Visible'),
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
    const clientPrivate = client as unknown as TwitterClient & { getFollowersQueryIds: () => Promise<string[]> };
    clientPrivate.getFollowersQueryIds = async () => ['test'];

    const result = await client.getFollowers('123', 1);

    expect(result.success).toBe(true);
    expect(result.users?.[0].username).toBe('vis');
    const [url] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('/Followers?');
  });

  it('refreshes query IDs after 404s', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'nope' }).mockResolvedValueOnce({
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
                              user_results: {
                                result: makeUserResult('1', 'alpha', 'Alpha'),
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
    const clientPrivate = client as unknown as TwitterClient & {
      getFollowingQueryIds: () => Promise<string[]>;
      refreshQueryIds: () => Promise<void>;
    };
    clientPrivate.getFollowingQueryIds = async () => ['test'];
    let refreshed = false;
    clientPrivate.refreshQueryIds = async () => {
      refreshed = true;
    };

    const result = await client.getFollowing('123', 1);

    expect(refreshed).toBe(true);
    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('falls back to REST following list after repeated 404s', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'nope' })
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'still nope' })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          users: [
            {
              id_str: '1',
              screen_name: 'alpha',
              name: 'Alpha',
              description: 'bio-1',
              followers_count: 10,
              friends_count: 5,
              verified: true,
              profile_image_url_https: 'https://example.com/1.jpg',
              created_at: '2024-01-01T00:00:00Z',
            },
          ],
        }),
      });

    const client = new TwitterClient({ cookies: validCookies });
    const clientPrivate = client as unknown as TwitterClient & { getFollowingQueryIds: () => Promise<string[]> };
    clientPrivate.getFollowingQueryIds = async () => ['test'];

    const result = await client.getFollowing('123', 1);

    expect(result.success).toBe(true);
    expect(result.users?.[0].username).toBe('alpha');
    expect(mockFetch).toHaveBeenCalledTimes(3);

    const urls = mockFetch.mock.calls.map((call) => String(call[0]));
    expect(urls[0]).toContain('/Following?');
    expect(urls[1]).toContain('/Following?');
    expect(urls[2]).toContain('/friends/list.json?');
  });

  it('falls back to REST followers list after repeated 404s', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'nope' })
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'still nope' })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          users: [
            {
              id_str: '1',
              screen_name: 'alpha',
              name: 'Alpha',
              description: 'bio-1',
              followers_count: 10,
              friends_count: 5,
              verified: true,
              profile_image_url_https: 'https://example.com/1.jpg',
              created_at: '2024-01-01T00:00:00Z',
            },
          ],
        }),
      });

    const client = new TwitterClient({ cookies: validCookies });
    const clientPrivate = client as unknown as TwitterClient & { getFollowersQueryIds: () => Promise<string[]> };
    clientPrivate.getFollowersQueryIds = async () => ['test'];

    const result = await client.getFollowers('123', 1);

    expect(result.success).toBe(true);
    expect(result.users?.[0].username).toBe('alpha');
    expect(mockFetch).toHaveBeenCalledTimes(3);

    const urls = mockFetch.mock.calls.map((call) => String(call[0]));
    expect(urls[0]).toContain('/Followers?');
    expect(urls[1]).toContain('/Followers?');
    expect(urls[2]).toContain('/followers/list.json?');
  });
});

describe('TwitterClient likes', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it('fetches likes and parses tweet results', async () => {
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
                              tweet_results: {
                                result: {
                                  rest_id: '2',
                                  legacy: {
                                    full_text: 'liked',
                                    created_at: '2024-01-01T00:00:00Z',
                                    reply_count: 0,
                                    retweet_count: 0,
                                    favorite_count: 0,
                                    conversation_id_str: '2',
                                  },
                                  core: {
                                    user_results: {
                                      result: {
                                        rest_id: 'u2',
                                        legacy: { screen_name: 'root', name: 'Root' },
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
        },
      }),
    });

    const client = new TwitterClient({ cookies: validCookies });
    const clientPrivate = client as unknown as TwitterClientPrivate;
    clientPrivate.getCurrentUser = async () => ({
      success: true,
      user: { id: '42', username: 'tester', name: 'Tester' },
    });
    clientPrivate.getLikesQueryIds = async () => ['test'];

    const result = await client.getLikes(2);

    expect(result.success).toBe(true);
    expect(result.tweets?.[0].id).toBe('2');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe('GET');
    expect(String(url)).toContain('/Likes?');
    const parsedVars = JSON.parse(new URL(url as string).searchParams.get('variables') as string);
    expect(parsedVars.userId).toBe('42');
    expect(parsedVars.count).toBe(2);
    const parsedFeatures = JSON.parse(new URL(url as string).searchParams.get('features') as string);
    expect(parsedFeatures.graphql_timeline_v2_bookmark_timeline).toBeUndefined();
  });

  it('returns an error when current user is unavailable', async () => {
    const client = new TwitterClient({ cookies: validCookies });
    const clientPrivate = client as unknown as TwitterClientPrivate;
    clientPrivate.getCurrentUser = async () => ({ success: false, error: 'no user' });

    const result = await client.getLikes(1);

    expect(result.success).toBe(false);
    expect(result.error).toBe('no user');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('includes cursor in likes variables when provided', async () => {
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
                              tweet_results: {
                                result: {
                                  rest_id: '1',
                                  legacy: {
                                    full_text: 'liked',
                                    created_at: '2024-01-01T00:00:00Z',
                                    reply_count: 0,
                                    retweet_count: 0,
                                    favorite_count: 0,
                                    conversation_id_str: '1',
                                  },
                                  core: {
                                    user_results: {
                                      result: {
                                        rest_id: 'u1',
                                        legacy: { screen_name: 'root', name: 'Root' },
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
        },
      }),
    });

    const client = new TwitterClient({ cookies: validCookies });
    const clientPrivate = client as unknown as TwitterClientPrivate;
    clientPrivate.getCurrentUser = async () => ({
      success: true,
      user: { id: '42', username: 'tester', name: 'Tester' },
    });
    clientPrivate.getLikesQueryIds = async () => ['test'];

    const result = await client.getLikes(2, 'cursor-1');

    expect(result.success).toBe(true);

    const [url] = mockFetch.mock.calls[0];
    const parsedVars = JSON.parse(new URL(url as string).searchParams.get('variables') as string);
    expect(parsedVars.cursor).toBe('cursor-1');
  });

  it('returns nextCursor from likes response', async () => {
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
                        { content: { cursorType: 'Bottom', value: 'next-cursor-123' } },
                        {
                          content: {
                            itemContent: {
                              tweet_results: {
                                result: {
                                  rest_id: '1',
                                  legacy: {
                                    full_text: 'liked',
                                    created_at: '2024-01-01T00:00:00Z',
                                    reply_count: 0,
                                    retweet_count: 0,
                                    favorite_count: 0,
                                    conversation_id_str: '1',
                                  },
                                  core: {
                                    user_results: {
                                      result: {
                                        rest_id: 'u1',
                                        legacy: { screen_name: 'root', name: 'Root' },
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
        },
      }),
    });

    const client = new TwitterClient({ cookies: validCookies });
    const clientPrivate = client as unknown as TwitterClientPrivate;
    clientPrivate.getCurrentUser = async () => ({
      success: true,
      user: { id: '42', username: 'tester', name: 'Tester' },
    });
    clientPrivate.getLikesQueryIds = async () => ['test'];

    const result = await client.getLikes(1);

    expect(result.success).toBe(true);
    expect(result.nextCursor).toBe('next-cursor-123');
  });
});
