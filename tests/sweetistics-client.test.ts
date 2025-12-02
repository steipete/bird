import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SweetisticsClient } from '../src/lib/sweetistics-client.js';

describe('SweetisticsClient', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('posts tweet with bearer token and reply id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, tweetId: '123' }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new SweetisticsClient({ baseUrl: 'https://api.example.com', apiKey: 'sweet-test' });
    const result = await client.tweet('hello world', '456');

    expect(result.success).toBe(true);
    expect(result.tweetId).toBe('123');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/api/actions/tweet');
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer sweet-test' });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ text: 'hello world', replyToTweetId: '456' });
  });

  it('returns error when API responds with failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ success: false, error: 'Unauthorized' }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new SweetisticsClient({ baseUrl: 'https://api.example.com', apiKey: 'sweet-test' });
    const result = await client.tweet('test');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unauthorized');
  });

  it('reads a tweet', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        tweet: {
          id: '1',
          text: 'hi',
          author: { username: 'u', name: 'User' },
        },
      }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new SweetisticsClient({ baseUrl: 'https://api.example.com', apiKey: 'sweet-test' });
    const result = await client.read('1');

    expect(result.success).toBe(true);
    expect(result.tweet?.id).toBe('1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/api/twitter/tweet/1');
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer sweet-test' });
  });

  it('fetches replies', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        tweets: [{ id: '2', text: 'reply', author: { username: 'r', name: 'Reply' } }],
      }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new SweetisticsClient({ baseUrl: 'https://api.example.com', apiKey: 'sweet-test' });
    const result = await client.replies('1');

    expect(result.success).toBe(true);
    expect(result.tweets?.[0].id).toBe('2');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/api/twitter/tweet/1/replies');
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer sweet-test' });
  });

  it('fetches thread', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        tweets: [{ id: '1', text: 'root', author: { username: 'u', name: 'User' } }],
      }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new SweetisticsClient({ baseUrl: 'https://api.example.com', apiKey: 'sweet-test' });
    const result = await client.thread('1');

    expect(result.success).toBe(true);
    expect(result.tweets?.length).toBe(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/api/twitter/tweet/1/thread');
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer sweet-test' });
  });

  it('searches tweets', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        tweets: [{ id: '3', text: 'needle', author: { username: 'n', name: 'Needle' } }],
      }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new SweetisticsClient({ baseUrl: 'https://api.example.com', apiKey: 'sweet-test' });
    const result = await client.search('needle', 5);

    expect(result.success).toBe(true);
    expect(result.tweets?.[0].id).toBe('3');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/api/twitter/search?q=needle&count=5');
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer sweet-test' });
  });

  it('propagates Sweetistics error message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ success: false, error: 'boom' }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new SweetisticsClient({ baseUrl: 'https://api.example.com', apiKey: 'sweet-test' });
    const result = await client.read('1');

    expect(result.success).toBe(false);
    expect(result.error).toBe('boom');
  });
});
