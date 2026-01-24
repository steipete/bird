// ABOUTME: Tests for TwitterClient list methods.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwitterClient } from '../src/lib/twitter-client.js';
import { type TwitterClientPrivate, validCookies } from './twitter-client-fixtures.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('TwitterClient lists mutations', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  describe('addListMember', () => {
    it('adds list member and parses list result', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            list: {
              id_str: '123',
              name: 'Added Members',
              member_count: 42,
              mode: 'Public',
            },
          },
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      clientPrivate.getListAddMemberQueryIds = async () => ['test'];

      const result = await client.addListMember('123', '999');

      expect(result.success).toBe(true);
      expect(result.list?.id).toBe('123');
      expect(result.list?.name).toBe('Added Members');
      expect(result.list?.memberCount).toBe(42);
      expect(result.list?.isPrivate).toBe(false);
    });

    it('returns error on HTTP failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      clientPrivate.getListAddMemberQueryIds = async () => ['test'];

      const result = await client.addListMember('123', '999');

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 500');
    });

    it('handles API errors in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          errors: [{ message: 'Cannot add member' }],
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      clientPrivate.getListAddMemberQueryIds = async () => ['test'];

      const result = await client.addListMember('123', '999');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot add member');
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
                id_str: '321',
                name: 'Retry Add',
                mode: 'Public',
              },
            },
          }),
        });

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      clientPrivate.getListAddMemberQueryIds = async () => ['test'];
      clientPrivate.refreshQueryIds = async () => {};

      const result = await client.addListMember('321', '999');

      expect(result.success).toBe(true);
      expect(result.list?.id).toBe('321');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('removeListMember', () => {
    it('removes list member and parses list result', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            list: {
              id_str: '555',
              name: 'Removed Members',
              member_count: 3,
              mode: 'Private',
            },
          },
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      clientPrivate.getListRemoveMemberQueryIds = async () => ['test'];

      const result = await client.removeListMember('555', '777');

      expect(result.success).toBe(true);
      expect(result.list?.id).toBe('555');
      expect(result.list?.name).toBe('Removed Members');
      expect(result.list?.memberCount).toBe(3);
      expect(result.list?.isPrivate).toBe(true);
    });

    it('returns error on HTTP failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      });

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      clientPrivate.getListRemoveMemberQueryIds = async () => ['test'];

      const result = await client.removeListMember('555', '777');

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 403');
    });

    it('handles API errors in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          errors: [{ message: 'Cannot remove member' }],
        }),
      });

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      clientPrivate.getListRemoveMemberQueryIds = async () => ['test'];

      const result = await client.removeListMember('555', '777');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot remove member');
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
                id_str: '999',
                name: 'Retry Remove',
                mode: 'Public',
              },
            },
          }),
        });

      const client = new TwitterClient({ cookies: validCookies });
      const clientPrivate = client as unknown as TwitterClientPrivate;
      clientPrivate.getListRemoveMemberQueryIds = async () => ['test'];
      clientPrivate.refreshQueryIds = async () => {};

      const result = await client.removeListMember('999', '777');

      expect(result.success).toBe(true);
      expect(result.list?.id).toBe('999');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
