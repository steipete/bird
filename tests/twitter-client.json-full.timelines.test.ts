import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwitterClient } from '../src/lib/twitter-client.js';
import { type TwitterClientPrivate, validCookies } from './twitter-client-fixtures.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('TwitterClient timelines includeRaw', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it('includes _raw for bookmarks when includeRaw is true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          bookmark_timeline_v2: {
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
                                full_text: 'saved',
                                created_at: '2024-01-01T00:00:00Z',
                              },
                              core: {
                                user_results: {
                                  result: { legacy: { screen_name: 'root', name: 'Root' } },
                                },
                              },
                              entities: {
                                hashtags: [{ text: 'bookmark' }],
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
    const result = await client.getBookmarks(1, { includeRaw: true });

    expect(result.success).toBe(true);
    expect(result.tweets).toHaveLength(1);
    expect(result.tweets?.[0]._raw).toBeDefined();
    expect(result.tweets?.[0]._raw?.entities?.hashtags?.[0].text).toBe('bookmark');
  });

  it('includes _raw for bookmark folder timelines when includeRaw is true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          bookmark_collection_timeline: {
            timeline: {
              instructions: [
                {
                  entries: [
                    {
                      content: {
                        itemContent: {
                          tweet_results: {
                            result: {
                              rest_id: '9',
                              legacy: {
                                full_text: 'saved in folder',
                                created_at: '2024-01-01T00:00:00Z',
                              },
                              core: {
                                user_results: {
                                  result: { legacy: { screen_name: 'folder', name: 'Folder' } },
                                },
                              },
                              entities: {
                                urls: [{ url: 'https://t.co/abc', expanded_url: 'https://example.com' }],
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
    const result = await client.getBookmarkFolderTimeline('123', 1, { includeRaw: true });

    expect(result.success).toBe(true);
    expect(result.tweets).toHaveLength(1);
    expect(result.tweets?.[0]._raw).toBeDefined();
    expect(result.tweets?.[0]._raw?.entities?.urls?.[0].expanded_url).toBe('https://example.com');
  });

  it('includes _raw for likes when includeRaw is true', async () => {
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
                                  },
                                  core: {
                                    user_results: {
                                      result: { legacy: { screen_name: 'root', name: 'Root' } },
                                    },
                                  },
                                  entities: {
                                    hashtags: [{ text: 'like' }],
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

    const result = await client.getLikes(1, { includeRaw: true });

    expect(result.success).toBe(true);
    expect(result.tweets).toHaveLength(1);
    expect(result.tweets?.[0]._raw).toBeDefined();
    expect(result.tweets?.[0]._raw?.entities?.hashtags?.[0].text).toBe('like');
  });

  it('includes _raw for list timeline when includeRaw is true', async () => {
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
                                rest_id: '777',
                                legacy: {
                                  full_text: 'from list',
                                  created_at: '2024-01-01T00:00:00Z',
                                },
                                core: {
                                  user_results: {
                                    result: { legacy: { screen_name: 'listmember', name: 'List Member' } },
                                  },
                                },
                                entities: {
                                  hashtags: [{ text: 'listtweet' }],
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

    const result = await client.getListTimeline('12345', 1, { includeRaw: true });

    expect(result.success).toBe(true);
    expect(result.tweets).toHaveLength(1);
    expect(result.tweets?.[0]._raw).toBeDefined();
    expect(result.tweets?.[0]._raw?.entities?.hashtags?.[0].text).toBe('listtweet');
  });
});
