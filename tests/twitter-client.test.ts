import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type TweetData, TwitterClient } from '../src/lib/twitter-client.js';

describe('TwitterClient', () => {
  const originalFetch = global.fetch;
  const validCookies = {
    authToken: 'test_auth_token',
    ct0: 'test_ct0_token',
    cookieHeader: 'auth_token=test_auth_token; ct0=test_ct0_token',
    source: 'test',
  };
  type TwitterClientPrivate = TwitterClient & {
    getCurrentUser: () => Promise<{
      success: boolean;
      user?: { id: string; username: string; name: string };
      error?: string;
    }>;
    getLikesQueryIds: () => Promise<string[]>;
  };

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should throw if authToken is missing', () => {
      expect(
        () =>
          new TwitterClient({
            cookies: { authToken: null, ct0: 'test', cookieHeader: null, source: null },
          }),
      ).toThrow('Both authToken and ct0 cookies are required');
    });

    it('should throw if ct0 is missing', () => {
      expect(
        () =>
          new TwitterClient({
            cookies: { authToken: 'test', ct0: null, cookieHeader: null, source: null },
          }),
      ).toThrow('Both authToken and ct0 cookies are required');
    });

    it('should create client with valid cookies', () => {
      const client = new TwitterClient({ cookies: validCookies });
      expect(client).toBeInstanceOf(TwitterClient);
    });
  });

  describe('tweet', () => {
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockFetch = vi.fn();
      global.fetch = mockFetch;
    });

    it('should post a tweet successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            create_tweet: {
              tweet_results: {
                result: {
                  rest_id: '1234567890',
                  legacy: {
                    full_text: 'Hello world!',
                  },
                },
              },
            },
          },
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.tweet('Hello world!');

      expect(result.success).toBe(true);
      expect(result.tweetId).toBe('1234567890');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('CreateTweet');
      expect(options.method).toBe('POST');

      const body = JSON.parse(options.body);
      expect(body.variables.tweet_text).toBe('Hello world!');
      expect(body.features.rweb_video_screen_enabled).toBe(true);
      expect(body.features.creator_subscriptions_tweet_preview_api_enabled).toBe(true);
    });

    it('supports attaching media IDs', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            create_tweet: {
              tweet_results: {
                result: {
                  rest_id: '1234567890',
                },
              },
            },
          },
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.tweet('Hello world!', ['111', '222']);

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.variables.media.media_entities).toEqual([
        { media_id: '111', tagged_users: [] },
        { media_id: '222', tagged_users: [] },
      ]);
    });

    it('retries CreateTweet via /i/api/graphql when operation URL 404s', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: async () => '',
        })
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
              create_tweet: {
                tweet_results: {
                  result: {
                    rest_id: '1234567890',
                  },
                },
              },
            },
          }),
        });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.tweet('Hello world!');

      expect(result.success).toBe(true);
      expect(result.tweetId).toBe('1234567890');
      expect(mockFetch).toHaveBeenCalledTimes(3);

      const [firstUrl] = mockFetch.mock.calls[0];
      const [thirdUrl] = mockFetch.mock.calls[2];
      expect(String(firstUrl)).toContain('/CreateTweet');
      expect(String(thirdUrl)).toBe('https://x.com/i/api/graphql');
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          errors: [{ message: 'Rate limit exceeded', code: 88 }],
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.tweet('Test');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Rate limit exceeded');
    });

    it('falls back to statuses/update.json when CreateTweet returns code 226', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            errors: [
              {
                message: 'Authorization: This request looks like it might be automated.',
                code: 226,
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id_str: '1234567890',
          }),
        });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.tweet('Hello world!');

      expect(result.success).toBe(true);
      expect(result.tweetId).toBe('1234567890');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(String(mockFetch.mock.calls[1][0])).toContain('statuses/update.json');
    });

    it('surfaces statuses/update.json failure when CreateTweet returns code 226', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            errors: [
              {
                message: 'Authorization: This request looks like it might be automated.',
                code: 226,
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          text: async () => 'Forbidden',
        });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.tweet('Hello world!');

      expect(result.success).toBe(false);
      expect(result.error).toContain('(226)');
      expect(result.error).toContain('fallback: HTTP 403');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(String(mockFetch.mock.calls[1][0])).toContain('statuses/update.json');
    });

    it('surfaces statuses/update.json API errors when CreateTweet returns code 226', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            errors: [
              {
                message: 'Authorization: This request looks like it might be automated.',
                code: 226,
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            errors: [{ message: 'Nope', code: 999 }],
          }),
        });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.tweet('Hello world!');

      expect(result.success).toBe(false);
      expect(result.error).toContain('(226)');
      expect(result.error).toContain('fallback: Nope (999)');
    });

    it('surfaces statuses/update.json missing id when CreateTweet returns code 226', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            errors: [
              {
                message: 'Authorization: This request looks like it might be automated.',
                code: 226,
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.tweet('Hello world!');

      expect(result.success).toBe(false);
      expect(result.error).toContain('(226)');
      expect(result.error).toContain('fallback: Tweet created but no ID returned');
    });

    it('should handle HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.tweet('Test');

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 403');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.tweet('Test');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });

    it('should surface missing tweet ID when API responds without rest_id', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            create_tweet: {
              tweet_results: {
                result: {
                  legacy: { full_text: 'No id' },
                },
              },
            },
          },
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.tweet('Hello world!');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Tweet created but no ID returned');
    });
  });

  describe('uploadMedia', () => {
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockFetch = vi.fn();
      global.fetch = mockFetch;
    });

    it('uploads an image and sets alt text', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ media_id_string: '999' }),
        })
        .mockResolvedValueOnce({
          ok: true,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        })
        .mockResolvedValueOnce({
          ok: true,
        });

      const client = new TwitterClient({ cookies: validCookies });
      const data = new Uint8Array([1, 2, 3, 4]);
      const result = await client.uploadMedia({ data, mimeType: 'image/png', alt: 'alt text' });

      expect(result.success).toBe(true);
      expect(result.mediaId).toBe('999');
      expect(mockFetch).toHaveBeenCalledTimes(4);

      const [initUrl, initOptions] = mockFetch.mock.calls[0];
      expect(String(initUrl)).toContain('upload.twitter.com');
      expect(initOptions.method).toBe('POST');
      expect(initOptions.body).toBeInstanceOf(URLSearchParams);
      expect((initOptions.body as URLSearchParams).get('command')).toBe('INIT');
      expect((initOptions.body as URLSearchParams).get('media_type')).toBe('image/png');

      const [, appendOptions] = mockFetch.mock.calls[1];
      expect(appendOptions.method).toBe('POST');
      expect(appendOptions.body).toBeInstanceOf(FormData);
      const appendBody = appendOptions.body as FormData;
      expect(appendBody.get('command')).toBe('APPEND');
      expect(appendBody.get('media_id')).toBe('999');
      expect(appendBody.get('segment_index')).toBe('0');
      expect(appendBody.get('media')).toBeInstanceOf(Blob);

      const [, finalizeOptions] = mockFetch.mock.calls[2];
      expect(finalizeOptions.body).toBeInstanceOf(URLSearchParams);
      expect((finalizeOptions.body as URLSearchParams).get('command')).toBe('FINALIZE');
      expect((finalizeOptions.body as URLSearchParams).get('media_id')).toBe('999');

      const [metaUrl, metaOptions] = mockFetch.mock.calls[3];
      expect(String(metaUrl)).toContain('/media/metadata/create.json');
      expect(metaOptions.method).toBe('POST');
      expect(JSON.parse(metaOptions.body)).toEqual({ media_id: '999', alt_text: { text: 'alt text' } });
    });

    it('uploads a video and polls processing status', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ media_id_string: '777' }),
        })
        .mockResolvedValueOnce({
          ok: true,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ processing_info: { state: 'pending', check_after_secs: 0 } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ processing_info: { state: 'succeeded' } }),
        });

      const client = new TwitterClient({ cookies: validCookies });
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const result = await client.uploadMedia({ data, mimeType: 'video/mp4', alt: 'ignored' });

      expect(result.success).toBe(true);
      expect(result.mediaId).toBe('777');
      expect(mockFetch).toHaveBeenCalledTimes(4);

      const [, finalizeOptions] = mockFetch.mock.calls[2];
      expect((finalizeOptions.body as URLSearchParams).get('command')).toBe('FINALIZE');

      const [statusUrl] = mockFetch.mock.calls[3];
      expect(String(statusUrl)).toContain('command=STATUS');
    });
  });

  describe('reply', () => {
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockFetch = vi.fn();
      global.fetch = mockFetch;
    });

    it('should post a reply with correct reply_to_tweet_id', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            create_tweet: {
              tweet_results: {
                result: {
                  rest_id: '9876543210',
                },
              },
            },
          },
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.reply('This is a reply', '1234567890');

      expect(result.success).toBe(true);
      expect(result.tweetId).toBe('9876543210');

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.variables.reply.in_reply_to_tweet_id).toBe('1234567890');
      expect(body.variables.tweet_text).toBe('This is a reply');
      expect(body.features.rweb_video_screen_enabled).toBe(true);
      expect(body.features.creator_subscriptions_tweet_preview_api_enabled).toBe(true);
    });

    it('falls back to statuses/update.json for replies when CreateTweet returns code 226', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            errors: [
              {
                message: 'Authorization: This request looks like it might be automated.',
                code: 226,
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id_str: '999',
          }),
        });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.reply('This is a reply', '1234567890', ['111', '222']);

      expect(result.success).toBe(true);
      expect(result.tweetId).toBe('999');
      expect(mockFetch).toHaveBeenCalledTimes(2);

      const [, options] = mockFetch.mock.calls[1];
      expect(String(mockFetch.mock.calls[1][0])).toContain('statuses/update.json');
      expect(options.method).toBe('POST');
      expect(options.body).toContain('status=This+is+a+reply');
      expect(options.body).toContain('in_reply_to_status_id=1234567890');
      expect(options.body).toContain('auto_populate_reply_metadata=true');
      expect(options.body).toContain('media_ids=111%2C222');
    });
  });

  describe('getTweet', () => {
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockFetch = vi.fn();
      global.fetch = mockFetch;
    });

    it('should return tweet data from root tweetResult', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            tweetResult: {
              result: {
                rest_id: '12345',
                legacy: {
                  full_text: 'Root tweet text',
                  created_at: 'Mon Jan 01 00:00:00 +0000 2024',
                  reply_count: 1,
                  retweet_count: 2,
                  favorite_count: 3,
                },
                core: {
                  user_results: {
                    result: {
                      legacy: {
                        screen_name: 'user',
                        name: 'User Name',
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getTweet('12345');

      expect(result.success).toBe(true);
      expect(result.tweet?.id).toBe('12345');
      expect(result.tweet?.text).toBe('Root tweet text');
      expect(result.tweet?.author.username).toBe('user');
    });

    it('should return tweet data found inside conversation instructions', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
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
                              rest_id: '6789',
                              legacy: {
                                full_text: 'Nested text',
                                created_at: 'Mon Jan 01 00:00:00 +0000 2024',
                                reply_count: 0,
                                retweet_count: 0,
                                favorite_count: 0,
                              },
                              core: {
                                user_results: {
                                  result: {
                                    legacy: {
                                      screen_name: 'nestuser',
                                      name: 'Nested User',
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
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getTweet('6789');

      expect(result.success).toBe(true);
      expect(result.tweet?.text).toBe('Nested text');
      expect(result.tweet?.author.username).toBe('nestuser');
    });

    it('should report HTTP errors from getTweet', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Not Found',
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getTweet('missing');

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 404');
    });

    it('should return article text when present', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            tweetResult: {
              result: {
                rest_id: 'article123',
                legacy: {
                  full_text: '',
                  created_at: 'Mon Jan 01 00:00:00 +0000 2024',
                },
                article: {
                  article_results: {
                    result: {
                      title: '2025 LLM Year in Review',
                      sections: [
                        {
                          items: [
                            { text: 'Intro paragraph of the article.' },
                            { content: { text: 'Second paragraph.' } },
                          ],
                        },
                      ],
                    },
                  },
                },
                core: {
                  user_results: {
                    result: {
                      legacy: {
                        screen_name: 'author',
                        name: 'Article Author',
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getTweet('article123');

      expect(result.success).toBe(true);
      expect(result.tweet?.text).toBe(
        '2025 LLM Year in Review\n\nIntro paragraph of the article.\n\nSecond paragraph.',
      );
    });

    it('should fall back to user article timeline for plain text', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: {
              tweetResult: {
                result: {
                  rest_id: 'article123',
                  legacy: {
                    full_text: '',
                    created_at: 'Mon Jan 01 00:00:00 +0000 2024',
                  },
                  article: {
                    article_results: {
                      result: {
                        title: '2025 LLM Year in Review',
                      },
                    },
                  },
                  core: {
                    user_results: {
                      result: {
                        rest_id: '33836629',
                        legacy: {
                          screen_name: 'author',
                          name: 'Article Author',
                        },
                      },
                    },
                  },
                },
              },
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
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
                                      rest_id: 'article123',
                                      article: {
                                        article_results: {
                                          result: {
                                            title: '2025 LLM Year in Review',
                                            plain_text: 'Full article body.',
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
      const result = await client.getTweet('article123');

      expect(result.success).toBe(true);
      expect(result.tweet?.text).toBe('2025 LLM Year in Review\n\nFull article body.');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should return note tweet text when present', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            tweetResult: {
              result: {
                rest_id: 'note123',
                legacy: {
                  full_text: '',
                  created_at: 'Mon Jan 01 00:00:00 +0000 2024',
                },
                note_tweet: {
                  note_tweet_results: {
                    result: {
                      text: 'Long form note content.',
                    },
                  },
                },
                core: {
                  user_results: {
                    result: {
                      legacy: {
                        screen_name: 'noter',
                        name: 'Note Author',
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getTweet('note123');

      expect(result.success).toBe(true);
      expect(result.tweet?.text).toBe('Long form note content.');
    });

    it('retries TweetDetail query id on 404', async () => {
      const payload = {
        data: {
          tweetResult: {
            result: {
              rest_id: '1',
              legacy: {
                full_text: 'hello',
                created_at: '2024-01-01T00:00:00Z',
                reply_count: 0,
                retweet_count: 0,
                favorite_count: 0,
              },
              core: { user_results: { result: { legacy: { screen_name: 'root', name: 'Root' } } } },
            },
          },
        },
      };

      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 404, text: async () => '' })
        .mockResolvedValueOnce({ ok: false, status: 404, text: async () => '' })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => payload });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getTweet('1');

      expect(result.success).toBe(true);
      expect(result.tweet?.id).toBe('1');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('getCurrentUser', () => {
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockFetch = vi.fn();
      global.fetch = mockFetch as unknown as typeof fetch;
    });

    it('returns mapped user details when present', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          user_id: '12345',
          screen_name: 'tester',
          name: 'Test User',
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getCurrentUser();

      expect(result.success).toBe(true);
      expect(result.user).toEqual({ id: '12345', username: 'tester', name: 'Test User' });
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('account/settings'), expect.any(Object));
    });

    it('returns error when response lacks identifiers', async () => {
      mockFetch.mockImplementation(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ language: 'en' }),
        text: async () => '{"language":"en"}',
      }));

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getCurrentUser();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Could not');
    });

    it('surfaces HTTP errors', async () => {
      mockFetch.mockImplementation(async () => ({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      }));

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getCurrentUser();

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 401');
    });

    it('uses HTML fallback when API endpoints 404', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'not found' })
        .mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'not found' })
        .mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'not found' })
        .mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'not found' })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '<html>"screen_name":"fallback","user_id":"999"</html>',
        });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getCurrentUser();

      expect(result.success).toBe(true);
      expect(result.user?.username).toBe('fallback');
      expect(result.user?.id).toBe('999');
      expect(mockFetch).toHaveBeenCalledTimes(5);
    });

    it('skips an endpoint when JSON parsing fails', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error('bad json');
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            user_id: '12345',
            screen_name: 'tester',
            name: 'Test User',
          }),
        });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getCurrentUser();

      expect(result.success).toBe(true);
      expect(result.user).toEqual({ id: '12345', username: 'tester', name: 'Test User' });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('continues on fetch errors and still succeeds via HTML fallback', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'not found' })
        .mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'not found' })
        .mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'not found' })
        .mockRejectedValueOnce(new Error('settings boom'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '<html>"screen_name":"fallback","user_id":"999"</html>',
        });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getCurrentUser();

      expect(result.success).toBe(true);
      expect(result.user?.username).toBe('fallback');
      expect(result.user?.id).toBe('999');
    });
  });

  describe('quoted tweets', () => {
    const makeTweetResult = (
      id: string,
      text: string,
      username = `user${id}`,
      name = `User ${id}`,
    ): Record<string, unknown> => ({
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
            rest_id: `u${id}`,
            legacy: { screen_name: username, name },
          },
        },
      },
    });

    it('includes one level of quoted tweet by default', () => {
      const quoted = makeTweetResult('2', 'quoted');
      const root = makeTweetResult('1', 'root');
      root.quoted_status_result = { result: quoted };

      const client = new TwitterClient({ cookies: validCookies });
      const mapped = (
        client as unknown as { mapTweetResult: (result: unknown) => TweetData | undefined }
      ).mapTweetResult(root);

      expect(mapped?.quotedTweet?.id).toBe('2');
      expect(mapped?.quotedTweet?.quotedTweet).toBeUndefined();
    });

    it('honors quoteDepth = 0', () => {
      const quoted = makeTweetResult('2', 'quoted');
      const root = makeTweetResult('1', 'root');
      root.quoted_status_result = { result: quoted };

      const client = new TwitterClient({ cookies: validCookies, quoteDepth: 0 });
      const mapped = (
        client as unknown as { mapTweetResult: (result: unknown) => TweetData | undefined }
      ).mapTweetResult(root);

      expect(mapped?.quotedTweet).toBeUndefined();
    });

    it('recurses when quoteDepth > 1', () => {
      const quoted2 = makeTweetResult('3', 'quoted2');
      const quoted1 = makeTweetResult('2', 'quoted1');
      quoted1.quoted_status_result = { result: quoted2 };
      const root = makeTweetResult('1', 'root');
      root.quoted_status_result = { result: quoted1 };

      const client = new TwitterClient({ cookies: validCookies, quoteDepth: 2 });
      const mapped = (
        client as unknown as { mapTweetResult: (result: unknown) => TweetData | undefined }
      ).mapTweetResult(root);

      expect(mapped?.quotedTweet?.id).toBe('2');
      expect(mapped?.quotedTweet?.quotedTweet?.id).toBe('3');
      expect(mapped?.quotedTweet?.quotedTweet?.quotedTweet).toBeUndefined();
    });

    it('unwraps quoted tweet visibility wrappers', () => {
      const quoted = makeTweetResult('2', 'quoted');
      const root = makeTweetResult('1', 'root');
      root.quoted_status_result = {
        result: {
          __typename: 'TweetWithVisibilityResults',
          tweet: quoted,
        },
      };

      const client = new TwitterClient({ cookies: validCookies });
      const mapped = (
        client as unknown as { mapTweetResult: (result: unknown) => TweetData | undefined }
      ).mapTweetResult(root);

      expect(mapped?.quotedTweet?.id).toBe('2');
    });
  });

  describe('search', () => {
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
  });

  describe('bookmarks', () => {
    let mockFetch: ReturnType<typeof vi.fn>;

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
  });

  describe('likes', () => {
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
  });
  describe('bookmark folders', () => {
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

      const firstVars = JSON.parse(
        new URL(mockFetch.mock.calls[0][0] as string).searchParams.get('variables') as string,
      );
      const secondVars = JSON.parse(
        new URL(mockFetch.mock.calls[1][0] as string).searchParams.get('variables') as string,
      );

      expect(firstVars.count).toBe(2);
      expect(secondVars.count).toBeUndefined();
    });
  });
  describe('conversation helpers', () => {
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockFetch = vi.fn();
      global.fetch = mockFetch as unknown as typeof fetch;
    });

    const makeConversationPayload = () => ({
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
                          rest_id: '1',
                          legacy: {
                            full_text: 'root',
                            created_at: '2024-01-01T00:00:00Z',
                            reply_count: 0,
                            retweet_count: 0,
                            favorite_count: 0,
                            conversation_id_str: '1',
                          },
                          core: { user_results: { result: { legacy: { screen_name: 'root', name: 'Root' } } } },
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
                          rest_id: '2',
                          legacy: {
                            full_text: 'child reply',
                            created_at: '2024-01-02T00:00:00Z',
                            reply_count: 0,
                            retweet_count: 0,
                            favorite_count: 0,
                            conversation_id_str: '1',
                            in_reply_to_status_id_str: '1',
                          },
                          core: { user_results: { result: { legacy: { screen_name: 'child', name: 'Child' } } } },
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
    });

    it('getReplies returns only replies to tweet', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => makeConversationPayload(),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getReplies('1');

      expect(result.success).toBe(true);
      expect(result.tweets?.length).toBe(1);
      expect(result.tweets?.[0].id).toBe('2');
    });

    it('getThread returns sorted thread by createdAt', async () => {
      const payload = makeConversationPayload();
      // swap dates to verify sorting
      const legacy =
        payload.data.threaded_conversation_with_injections_v2.instructions[0]?.entries?.[0]?.content?.itemContent
          ?.tweet_results?.result?.legacy;
      if (legacy) {
        legacy.created_at = '2024-01-03T00:00:00Z';
      }

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => payload,
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getThread('2');

      expect(result.success).toBe(true);
      expect(result.tweets?.map((t) => t.id)).toEqual(['2', '1']); // sorted by createdAt asc
    });

    it('getThread includes tweets from timeline module items', async () => {
      const payload = makeConversationPayload();
      payload.data.threaded_conversation_with_injections_v2.instructions[0]?.entries?.push({
        content: {
          items: [
            {
              item: {
                itemContent: {
                  tweet_results: {
                    result: {
                      rest_id: '3',
                      legacy: {
                        full_text: 'nested reply',
                        created_at: '2024-01-04T00:00:00Z',
                        reply_count: 0,
                        retweet_count: 0,
                        favorite_count: 0,
                        conversation_id_str: '1',
                        in_reply_to_status_id_str: '1',
                      },
                      core: {
                        user_results: { result: { legacy: { screen_name: 'nested', name: 'Nested' } } },
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => payload,
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getThread('1');

      expect(result.success).toBe(true);
      expect(result.tweets?.map((t) => t.id)).toEqual(['1', '2', '3']);
    });

    it('propagates fetchTweetDetail errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'oops',
      });

      const client = new TwitterClient({ cookies: validCookies });
      const result = await client.getThread('1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 500');
    });
  });
});
