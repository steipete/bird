import { afterEach, describe, expect, it, vi } from 'vitest';
import { runtimeQueryIds } from '../src/lib/runtime-query-ids.js';
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

type TwitterClientPrivate = TwitterClient & {
  refreshQueryIds: () => Promise<void>;
  fetchWithTimeout: (url: string, init: RequestInit) => Promise<ResponseLike>;
  ensureClientUserId: () => Promise<void>;
  getBaseHeaders: () => Record<string, string>;
  fetchUserArticlePlainText: (userId: string, tweetId: string) => Promise<{ title?: string; plainText?: string }>;
  fetchTweetDetail: (tweetId: string) => Promise<{ success: true } | { success: false; error: string }>;
  postStatusUpdate: (input: { text: string }) => Promise<{ success: boolean; error?: string }>;
};

const makeResponse = (overrides: Partial<ResponseLike> = {}): ResponseLike => ({
  ok: true,
  status: 200,
  json: async (): Promise<unknown> => ({}),
  text: async (): Promise<string> => '',
  ...overrides,
});

describe('TwitterClient core coverage', () => {
  const originalFetch = global.fetch;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.BIRD_DEBUG_ARTICLE;
    vi.restoreAllMocks();
  });

  it('refreshQueryIds calls runtime refresh outside test env', async () => {
    const client = new TwitterClient({ cookies: validCookies });
    const refreshSpy = vi.spyOn(runtimeQueryIds, 'refresh').mockResolvedValue(null);
    process.env.NODE_ENV = 'production';

    const clientPrivate = client as unknown as TwitterClientPrivate;
    await clientPrivate.refreshQueryIds();

    expect(refreshSpy).toHaveBeenCalled();
  });

  it('fetchWithTimeout uses an abort signal when timeout is set', async () => {
    const mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return makeResponse();
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const client = new TwitterClient({ cookies: validCookies, timeoutMs: 5 });
    const clientPrivate = client as unknown as TwitterClientPrivate;
    await clientPrivate.fetchWithTimeout('https://example.com', { method: 'GET' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns a not found error when tweet data is missing', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      makeResponse({
        json: async () => ({
          data: {
            threaded_conversation_with_injections_v2: {
              instructions: [
                {
                  entries: [
                    {
                      content: {
                        itemContent: {
                          tweet_results: {
                            result: {
                              rest_id: 'other',
                              legacy: { full_text: 'nope', created_at: '2024-01-01T00:00:00Z' },
                              core: { user_results: { result: { legacy: { screen_name: 'user', name: 'User' } } } },
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
        }),
      }),
    );
    global.fetch = mockFetch as unknown as typeof fetch;

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getTweet('123');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Tweet not found in response');
  });

  it('adds client user id header after ensureClientUserId', async () => {
    const client = new TwitterClient({ cookies: validCookies });
    process.env.NODE_ENV = 'production';

    vi.spyOn(client, 'getCurrentUser').mockResolvedValue({
      success: true,
      user: { id: '42', username: 'tester', name: 'Tester' },
    });

    const clientPrivate = client as unknown as TwitterClientPrivate;
    await clientPrivate.ensureClientUserId();
    const headers = clientPrivate.getBaseHeaders();

    expect(headers['x-twitter-client-user-id']).toBe('42');
  });

  describe('fetchUserArticlePlainText failures', () => {
    it('returns empty object when response is not ok', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(makeResponse({ ok: false, status: 500 }));
      global.fetch = mockFetch as unknown as typeof fetch;

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      const result = await clientPrivate.fetchUserArticlePlainText('user', 'tweet');

      expect(result).toEqual({});
    });

    it('returns empty object when fetching throws', async () => {
      const mockFetch = vi.fn().mockRejectedValueOnce(new Error('boom'));
      global.fetch = mockFetch as unknown as typeof fetch;

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      const result = await clientPrivate.fetchUserArticlePlainText('user', 'tweet');

      expect(result).toEqual({});
    });

    it('returns empty object when no matching tweet is found', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(
        makeResponse({
          json: async () => ({
            data: {
              user: { result: { timeline: { timeline: { instructions: [] } } } },
            },
          }),
        }),
      );
      global.fetch = mockFetch as unknown as typeof fetch;

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      const result = await clientPrivate.fetchUserArticlePlainText('user', 'tweet');

      expect(result).toEqual({});
    });
  });

  describe('fetchTweetDetail error handling', () => {
    it('returns API errors from response payloads', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(
        makeResponse({
          json: async () => ({ errors: [{ message: 'bad news' }] }),
        }),
      );
      global.fetch = mockFetch as unknown as typeof fetch;

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      const result = await clientPrivate.fetchTweetDetail('1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('bad news');
    });

    it('allows partial errors when tweetResult is present', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(
        makeResponse({
          json: async () => ({
            data: {
              tweetResult: {
                result: {
                  rest_id: '1',
                  legacy: {
                    full_text: 'hi',
                    created_at: '2024-01-01T00:00:00Z',
                    reply_count: 0,
                    retweet_count: 0,
                    favorite_count: 0,
                  },
                  core: { user_results: { result: { legacy: { screen_name: 'user', name: 'User' } } } },
                },
              },
            },
            errors: [{ message: 'field error' }],
          }),
        }),
      );
      global.fetch = mockFetch as unknown as typeof fetch;

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      const result = await clientPrivate.fetchTweetDetail('1');

      expect(result.success).toBe(true);
      expect(result.data?.tweetResult).toBeDefined();
    });

    it('allows partial errors when instructions are present', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(
        makeResponse({
          json: async () => ({
            data: {
              threaded_conversation_with_injections_v2: {
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
                                  full_text: 'thread tweet',
                                  created_at: '2024-01-01T00:00:00Z',
                                  reply_count: 0,
                                  retweet_count: 0,
                                  favorite_count: 0,
                                  conversation_id_str: '2',
                                },
                                core: {
                                  user_results: { result: { legacy: { screen_name: 'user', name: 'User' } } },
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
            errors: [{ message: 'is_translatable error' }],
          }),
        }),
      );
      global.fetch = mockFetch as unknown as typeof fetch;

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      const result = await clientPrivate.fetchTweetDetail('2');

      expect(result.success).toBe(true);
      expect(result.data?.threaded_conversation_with_injections_v2?.instructions?.length).toBe(1);
    });

    it('parses POST responses when GET returns 404', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(makeResponse({ ok: false, status: 404, text: async () => 'nope' }))
        .mockResolvedValueOnce(
          makeResponse({
            json: async () => ({
              data: {
                tweetResult: {
                  result: {
                    rest_id: '1',
                    legacy: {
                      full_text: 'hi',
                      created_at: '2024-01-01T00:00:00Z',
                      reply_count: 0,
                      retweet_count: 0,
                      favorite_count: 0,
                    },
                    core: { user_results: { result: { legacy: { screen_name: 'user', name: 'User' } } } },
                  },
                },
              },
            }),
          }),
        );
      global.fetch = mockFetch as unknown as typeof fetch;

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      const result = await clientPrivate.fetchTweetDetail('1');

      expect(result.success).toBe(true);
    });

    it('returns an error when fetch throws', async () => {
      const mockFetch = vi.fn().mockRejectedValueOnce(new Error('boom'));
      global.fetch = mockFetch as unknown as typeof fetch;

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      const result = await clientPrivate.fetchTweetDetail('1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('boom');
    });
  });

  describe('postStatusUpdate error handling', () => {
    it('returns an error when postStatusUpdate throws', async () => {
      const mockFetch = vi.fn().mockRejectedValueOnce(new Error('boom'));
      global.fetch = mockFetch as unknown as typeof fetch;

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      const result = await clientPrivate.postStatusUpdate({ text: 'hello' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('boom');
    });
  });
});
