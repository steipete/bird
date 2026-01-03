import type { TwitterClient } from '../src/lib/twitter-client.js';

export const validCookies = {
  authToken: 'test_auth_token',
  ct0: 'test_ct0_token',
  cookieHeader: 'auth_token=test_auth_token; ct0=test_ct0_token',
  source: 'test',
};

export type TwitterClientPrivate = TwitterClient & {
  getCurrentUser: () => Promise<{
    success: boolean;
    user?: { id: string; username: string; name: string };
    error?: string;
  }>;
  getLikesQueryIds: () => Promise<string[]>;
  getListTimelineQueryIds: () => Promise<string[]>;
  getListOwnershipsQueryIds: () => Promise<string[]>;
  getListMembershipsQueryIds: () => Promise<string[]>;
  refreshQueryIds: () => Promise<void>;
};
