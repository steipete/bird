import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwitterClient } from '../src/lib/twitter-client.js';
import { validCookies } from './twitter-client-fixtures.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('TwitterClient search', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it('retries on 404 and posts search payload', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            search_by_raw_query: {
              search_timeline: {
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
                                    full_text: 'found',
                                    created_at: '2024-01-01T00:00:00Z',
                                    reply_count: 0,
                                    retweet_count: 0,
                                    favorite_count: 0,
                                    conversation_id_str: '1',
                                  },
                                  core: {
                                    user_results: {
                                      result: { legacy: { screen_name: 'root', name: 'Root' } },
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
    const result = await client.search('needle', 1);

    expect(result.success).toBe(true);
    expect(result.tweets?.[0].id).toBe('1');
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const [url, options] = mockFetch.mock.calls[1];
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(body.features).toBeDefined();
    expect(body.queryId).toBeDefined();
    const urlVars = new URL(url as string).searchParams.get('variables');
    expect(urlVars).toBeTruthy();
    const parsed = JSON.parse(urlVars as string) as { rawQuery?: string };
    expect(parsed.rawQuery).toBe('needle');
  });

  it('refreshes query IDs when all search endpoints 404', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => '' })
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => '' })
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => '' })
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => '' })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            search_by_raw_query: {
              search_timeline: {
                timeline: {
                  instructions: [],
                },
              },
            },
          },
        }),
      });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.search('hello', 5);

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });

  it('returns an unknown error when no query IDs are available', async () => {
    const client = new TwitterClient({ cookies: validCookies });
    (client as unknown as { getSearchTimelineQueryIds: () => Promise<string[]> }).getSearchTimelineQueryIds =
      async () => [];

    const result = await client.search('hello', 5);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown error fetching search results');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('paginates search results using the bottom cursor', async () => {
    const makeSearchEntry = (id: string, text: string) => ({
      content: {
        itemContent: {
          tweet_results: {
            result: {
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
                  result: { legacy: { screen_name: 'root', name: 'Root' } },
                },
              },
            },
          },
        },
      },
    });

    const makeResponse = (ids: string[], cursor?: string) => ({
      data: {
        search_by_raw_query: {
          search_timeline: {
            timeline: {
              instructions: [
                {
                  entries: [
                    ...ids.map((id) => makeSearchEntry(id, `tweet-${id}`)),
                    ...(cursor ? [{ content: { cursorType: 'Bottom', value: cursor } }] : []),
                  ],
                },
              ],
            },
          },
        },
      },
    });

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeResponse(['1', '2'], 'cursor-1'),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeResponse(['2', '3']),
      });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.search('needle', 3);

    expect(result.success).toBe(true);
    expect(result.tweets?.map((tweet) => tweet.id)).toEqual(['1', '2', '3']);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const firstVars = JSON.parse(
      new URL(mockFetch.mock.calls[0][0] as string).searchParams.get('variables') as string,
    ) as { cursor?: string };
    const secondVars = JSON.parse(
      new URL(mockFetch.mock.calls[1][0] as string).searchParams.get('variables') as string,
    ) as { cursor?: string };

    expect(firstVars.cursor).toBeUndefined();
    expect(secondVars.cursor).toBe('cursor-1');
  });

  it('stops paginating when the cursor repeats', async () => {
    const makeSearchEntry = (id: string) => ({
      content: {
        itemContent: {
          tweet_results: {
            result: {
              rest_id: id,
              legacy: {
                full_text: `tweet-${id}`,
                created_at: '2024-01-01T00:00:00Z',
                reply_count: 0,
                retweet_count: 0,
                favorite_count: 0,
                conversation_id_str: id,
              },
              core: {
                user_results: {
                  result: { legacy: { screen_name: 'root', name: 'Root' } },
                },
              },
            },
          },
        },
      },
    });

    const makeResponse = (ids: string[], cursor: string) => ({
      data: {
        search_by_raw_query: {
          search_timeline: {
            timeline: {
              instructions: [
                {
                  entries: [
                    ...ids.map((id) => makeSearchEntry(id)),
                    { content: { cursorType: 'Bottom', value: cursor } },
                  ],
                },
              ],
            },
          },
        },
      },
    });

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeResponse(['1', '2'], 'same-cursor'),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeResponse(['3'], 'same-cursor'),
      });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.search('needle', 4);

    expect(result.success).toBe(true);
    expect(result.tweets?.map((tweet) => tweet.id)).toEqual(['1', '2', '3']);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('stops paginating when the next page is empty', async () => {
    const makeSearchEntry = (id: string) => ({
      content: {
        itemContent: {
          tweet_results: {
            result: {
              rest_id: id,
              legacy: {
                full_text: `tweet-${id}`,
                created_at: '2024-01-01T00:00:00Z',
                reply_count: 0,
                retweet_count: 0,
                favorite_count: 0,
                conversation_id_str: id,
              },
              core: {
                user_results: {
                  result: { legacy: { screen_name: 'root', name: 'Root' } },
                },
              },
            },
          },
        },
      },
    });

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            search_by_raw_query: {
              search_timeline: {
                timeline: {
                  instructions: [
                    {
                      entries: [makeSearchEntry('1'), { content: { cursorType: 'Bottom', value: 'cursor-1' } }],
                    },
                  ],
                },
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            search_by_raw_query: {
              search_timeline: {
                timeline: {
                  instructions: [
                    {
                      entries: [{ content: { cursorType: 'Bottom', value: 'cursor-2' } }],
                    },
                  ],
                },
              },
            },
          },
        }),
      });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.search('needle', 3);

    expect(result.success).toBe(true);
    expect(result.tweets?.map((tweet) => tweet.id)).toEqual(['1']);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('TwitterClient bookmarks', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  const makeBookmarkEntry = (id: string) => ({
    content: {
      itemContent: {
        tweet_results: {
          result: {
            rest_id: id,
            legacy: {
              full_text: 'saved',
              created_at: '2024-01-01T00:00:00Z',
              reply_count: 0,
              retweet_count: 0,
              favorite_count: 0,
              conversation_id_str: id,
            },
            core: {
              user_results: {
                result: {
                  rest_id: `u${id}`,
                  legacy: { screen_name: 'root', name: 'Root' },
                },
              },
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

  it('fetches bookmarks and parses tweet results', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          bookmark_timeline_v2: {
            timeline: {
              instructions: [
                {
                  entries: [makeBookmarkEntry('1')],
                },
              ],
            },
          },
        },
      }),
    });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getBookmarks(2);

    expect(result.success).toBe(true);
    expect(result.tweets?.[0].id).toBe('1');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe('GET');
    expect(String(url)).toContain('/Bookmarks?');
    const parsedVars = JSON.parse(new URL(url as string).searchParams.get('variables') as string);
    expect(parsedVars.count).toBe(2);
    const parsedFeatures = JSON.parse(new URL(url as string).searchParams.get('features') as string);
    expect(parsedFeatures.graphql_timeline_v2_bookmark_timeline).toBe(true);
  });

  it('includes cursor in bookmarks variables when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          bookmark_timeline_v2: {
            timeline: {
              instructions: [
                {
                  entries: [makeBookmarkEntry('1')],
                },
              ],
            },
          },
        },
      }),
    });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getBookmarks(2, 'cursor-1');

    expect(result.success).toBe(true);

    const [url] = mockFetch.mock.calls[0];
    const parsedVars = JSON.parse(new URL(url as string).searchParams.get('variables') as string);
    expect(parsedVars.cursor).toBe('cursor-1');
  });

  it('returns nextCursor from the last bottom cursor entry', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          bookmark_timeline_v2: {
            timeline: {
              instructions: [
                {
                  entries: [{ content: { cursorType: 'Bottom', value: 'cursor-1' } }, makeBookmarkEntry('1')],
                },
                {
                  entries: [{ content: { cursorType: 'Bottom', value: 'cursor-2' } }],
                },
              ],
            },
          },
        },
      }),
    });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getBookmarks(1);

    expect(result.success).toBe(true);
    expect(result.nextCursor).toBe('cursor-2');
  });

  it('returns partial errors when timeline data is present', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        errors: [{ message: 'Query: Unspecified' }],
        data: {
          bookmark_timeline_v2: {
            timeline: {
              instructions: [
                {
                  entries: [makeBookmarkEntry('1')],
                },
              ],
            },
          },
        },
      }),
    });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getBookmarks(1);

    expect(result.success).toBe(true);
    expect(result.errors).toEqual(['Query: Unspecified']);
    expect(result.tweets?.[0].id).toBe('1');
  });
});

describe('TwitterClient bookmark folders', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it('fetches bookmark folder timeline and parses tweet results', async () => {
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
                                reply_count: 0,
                                retweet_count: 0,
                                favorite_count: 0,
                                conversation_id_str: '9',
                              },
                              core: {
                                user_results: {
                                  result: {
                                    rest_id: 'u9',
                                    legacy: { screen_name: 'folder', name: 'Folder' },
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
      }),
    });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getBookmarkFolderTimeline('123', 2);

    expect(result.success).toBe(true);
    expect(result.tweets?.[0].id).toBe('9');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe('GET');
    expect(String(url)).toContain('/BookmarkFolderTimeline?');
    const parsedVars = JSON.parse(new URL(url as string).searchParams.get('variables') as string);
    expect(parsedVars.bookmark_collection_id).toBe('123');
    expect(parsedVars.count).toBe(2);
    const parsedFeatures = JSON.parse(new URL(url as string).searchParams.get('features') as string);
    expect(parsedFeatures.graphql_timeline_v2_bookmark_timeline).toBe(true);
  });

  it('retries without count when API rejects the count variable', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          errors: [{ message: 'Variable "$count" is not defined by operation' }],
        }),
      })
      .mockResolvedValueOnce({
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
                                  reply_count: 0,
                                  retweet_count: 0,
                                  favorite_count: 0,
                                  conversation_id_str: '9',
                                },
                                core: {
                                  user_results: {
                                    result: {
                                      rest_id: 'u9',
                                      legacy: { screen_name: 'folder', name: 'Folder' },
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
        }),
      });

    const client = new TwitterClient({ cookies: validCookies });
    const clientPrivate = client as TwitterClient & { getBookmarkFolderQueryIds: () => Promise<string[]> };
    clientPrivate.getBookmarkFolderQueryIds = async () => ['test'];

    const result = await client.getBookmarkFolderTimeline('123', 2);

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const firstVars = JSON.parse(new URL(mockFetch.mock.calls[0][0] as string).searchParams.get('variables') as string);
    const secondVars = JSON.parse(
      new URL(mockFetch.mock.calls[1][0] as string).searchParams.get('variables') as string,
    );

    expect(firstVars.count).toBe(2);
    expect(secondVars.count).toBeUndefined();
  });
});
