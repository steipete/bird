import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwitterClient } from '../src/lib/twitter-client.js';
import { validCookies } from './twitter-client-fixtures.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('TwitterClient getUserAboutAccount', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it('returns account information for a valid user', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          user_result_by_screen_name: {
            result: {
              about_profile: {
                account_based_in: 'Germany',
                source: 'Twitter',
                created_country_accurate: true,
                location_accurate: true,
                learn_more_url: 'https://help.twitter.com/about-account',
              },
            },
          },
        },
      }),
    });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getUserAboutAccount('testuser');

    expect(result.success).toBe(true);
    expect(result.aboutProfile).toBeDefined();
    expect(result.aboutProfile?.accountBasedIn).toBe('Germany');
    expect(result.aboutProfile?.source).toBe('Twitter');
    expect(result.aboutProfile?.createdCountryAccurate).toBe(true);
    expect(result.aboutProfile?.locationAccurate).toBe(true);
    expect(result.aboutProfile?.learnMoreUrl).toBe('https://help.twitter.com/about-account');
  });

  it('handles username with @ prefix', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          user_result_by_screen_name: {
            result: {
              about_profile: {
                account_based_in: 'United States',
              },
            },
          },
        },
      }),
    });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getUserAboutAccount('@testuser');

    expect(result.success).toBe(true);
    expect(result.aboutProfile?.accountBasedIn).toBe('United States');
  });

  it('returns error for invalid username', async () => {
    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getUserAboutAccount('');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid username');
  });

  it('handles missing about_profile in response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          user_result_by_screen_name: {
            result: {},
          },
        },
      }),
    });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getUserAboutAccount('testuser');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing about_profile');
  });

  it('handles GraphQL errors in response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        errors: [{ message: 'User not found' }],
      }),
    });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getUserAboutAccount('testuser');

    expect(result.success).toBe(false);
    expect(result.error).toContain('User not found');
  });

  it('handles HTTP 404 error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getUserAboutAccount('testuser');

    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 404');
  });

  it('handles non-404 HTTP errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getUserAboutAccount('testuser');

    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 500');
  });

  it('handles network errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getUserAboutAccount('testuser');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Network error');
  });

  it('handles partial about_profile data', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          user_result_by_screen_name: {
            result: {
              about_profile: {
                account_based_in: 'Japan',
                // Other fields missing
              },
            },
          },
        },
      }),
    });

    const client = new TwitterClient({ cookies: validCookies });
    const result = await client.getUserAboutAccount('testuser');

    expect(result.success).toBe(true);
    expect(result.aboutProfile?.accountBasedIn).toBe('Japan');
    expect(result.aboutProfile?.source).toBeUndefined();
    expect(result.aboutProfile?.createdCountryAccurate).toBeUndefined();
    expect(result.aboutProfile?.locationAccurate).toBeUndefined();
    expect(result.aboutProfile?.learnMoreUrl).toBeUndefined();
  });

  it('makes proper GraphQL request with correct parameters', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          user_result_by_screen_name: {
            result: {
              about_profile: {
                account_based_in: 'Canada',
              },
            },
          },
        },
      }),
    });

    const client = new TwitterClient({ cookies: validCookies });
    await client.getUserAboutAccount('testuser');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];

    expect(url).toContain('/AboutAccountQuery?');
    expect(url).toContain('variables=');
    expect(url).toContain('testuser');
    expect(options.method).toBe('GET');
    expect(options.headers).toMatchObject({
      'x-csrf-token': 'test_ct0_token',
    });
  });
});
