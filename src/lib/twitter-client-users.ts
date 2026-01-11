import type { AbstractConstructor, Mixin, TwitterClientBase } from './twitter-client-base.js';
import {
  SETTINGS_NAME_REGEX,
  SETTINGS_SCREEN_NAME_REGEX,
  SETTINGS_USER_ID_REGEX,
  TWITTER_API_BASE,
} from './twitter-client-constants.js';
import { buildFollowingFeatures } from './twitter-client-features.js';
import type { CurrentUserResult, FollowingResult } from './twitter-client-types.js';
import { extractCursorFromInstructions, parseUsersFromInstructions } from './twitter-client-utils.js';

export interface TwitterClientUserMethods {
  getCurrentUser(): Promise<CurrentUserResult>;
  getFollowing(userId: string, count?: number, cursor?: string): Promise<FollowingResult>;
  getFollowers(userId: string, count?: number, cursor?: string): Promise<FollowingResult>;
}

export function withUsers<TBase extends AbstractConstructor<TwitterClientBase>>(
  Base: TBase,
): Mixin<TBase, TwitterClientUserMethods> {
  abstract class TwitterClientUsers extends Base {
    // biome-ignore lint/complexity/noUselessConstructor lint/suspicious/noExplicitAny: TS mixin constructor requirement.
    constructor(...args: any[]) {
      super(...args);
    }

    private async getFollowingQueryIds(): Promise<string[]> {
      const primary = await this.getQueryId('Following');
      return Array.from(new Set([primary, 'BEkNpEt5pNETESoqMsTEGA']));
    }

    private async getFollowersQueryIds(): Promise<string[]> {
      const primary = await this.getQueryId('Followers');
      return Array.from(new Set([primary, 'kuFUYP9eV1FPoEy4N-pi7w']));
    }

    private async getFollowersViaRest(userId: string, count: number): Promise<FollowingResult> {
      const params = new URLSearchParams({
        user_id: userId,
        count: String(count),
        skip_status: 'true',
        include_user_entities: 'false',
      });

      const urls = [
        `https://x.com/i/api/1.1/followers/list.json?${params.toString()}`,
        `https://api.twitter.com/1.1/followers/list.json?${params.toString()}`,
      ];

      let lastError: string | undefined;

      for (const url of urls) {
        try {
          const response = await this.fetchWithTimeout(url, {
            method: 'GET',
            headers: this.getHeaders(),
          });

          if (!response.ok) {
            const text = await response.text();
            lastError = `HTTP ${response.status}: ${text.slice(0, 200)}`;
            continue;
          }

          const data = (await response.json()) as {
            users?: Array<{
              id_str?: string;
              id?: string | number;
              screen_name?: string;
              name?: string;
              description?: string;
              followers_count?: number;
              friends_count?: number;
              verified?: boolean;
              profile_image_url_https?: string;
              created_at?: string;
            }>;
          };

          const users = (data.users ?? [])
            .map((u) => {
              const id = typeof u.id_str === 'string' ? u.id_str : typeof u.id === 'number' ? String(u.id) : null;
              const username = typeof u.screen_name === 'string' ? u.screen_name : null;
              if (!id || !username) {
                return null;
              }
              return {
                id,
                username,
                name: typeof u.name === 'string' && u.name.length > 0 ? u.name : username,
                description: typeof u.description === 'string' ? u.description : undefined,
                followersCount: typeof u.followers_count === 'number' ? u.followers_count : undefined,
                followingCount: typeof u.friends_count === 'number' ? u.friends_count : undefined,
                isBlueVerified: typeof u.verified === 'boolean' ? u.verified : undefined,
                profileImageUrl: typeof u.profile_image_url_https === 'string' ? u.profile_image_url_https : undefined,
                createdAt: typeof u.created_at === 'string' ? u.created_at : undefined,
              };
            })
            .filter((u) => u !== null);

          return { success: true, users };
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      return { success: false, error: lastError ?? 'Unknown error fetching followers' };
    }

    private async getFollowingViaRest(userId: string, count: number): Promise<FollowingResult> {
      const params = new URLSearchParams({
        user_id: userId,
        count: String(count),
        skip_status: 'true',
        include_user_entities: 'false',
      });

      const urls = [
        `https://x.com/i/api/1.1/friends/list.json?${params.toString()}`,
        `https://api.twitter.com/1.1/friends/list.json?${params.toString()}`,
      ];

      let lastError: string | undefined;

      for (const url of urls) {
        try {
          const response = await this.fetchWithTimeout(url, {
            method: 'GET',
            headers: this.getHeaders(),
          });

          if (!response.ok) {
            const text = await response.text();
            lastError = `HTTP ${response.status}: ${text.slice(0, 200)}`;
            continue;
          }

          const data = (await response.json()) as {
            users?: Array<{
              id_str?: string;
              id?: string | number;
              screen_name?: string;
              name?: string;
              description?: string;
              followers_count?: number;
              friends_count?: number;
              verified?: boolean;
              profile_image_url_https?: string;
              created_at?: string;
            }>;
          };

          const users = (data.users ?? [])
            .map((u) => {
              const id = typeof u.id_str === 'string' ? u.id_str : typeof u.id === 'number' ? String(u.id) : null;
              const username = typeof u.screen_name === 'string' ? u.screen_name : null;
              if (!id || !username) {
                return null;
              }
              return {
                id,
                username,
                name: typeof u.name === 'string' && u.name.length > 0 ? u.name : username,
                description: typeof u.description === 'string' ? u.description : undefined,
                followersCount: typeof u.followers_count === 'number' ? u.followers_count : undefined,
                followingCount: typeof u.friends_count === 'number' ? u.friends_count : undefined,
                isBlueVerified: typeof u.verified === 'boolean' ? u.verified : undefined,
                profileImageUrl: typeof u.profile_image_url_https === 'string' ? u.profile_image_url_https : undefined,
                createdAt: typeof u.created_at === 'string' ? u.created_at : undefined,
              };
            })
            .filter((u) => u !== null);

          return { success: true, users };
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      return { success: false, error: lastError ?? 'Unknown error fetching following' };
    }

    /**
     * Fetch the account associated with the current cookies
     */
    async getCurrentUser(): Promise<CurrentUserResult> {
      const candidateUrls = [
        'https://x.com/i/api/account/settings.json',
        'https://api.twitter.com/1.1/account/settings.json',
        'https://x.com/i/api/account/verify_credentials.json?skip_status=true&include_entities=false',
        'https://api.twitter.com/1.1/account/verify_credentials.json?skip_status=true&include_entities=false',
      ];

      let lastError: string | undefined;

      for (const url of candidateUrls) {
        try {
          const response = await this.fetchWithTimeout(url, {
            method: 'GET',
            headers: this.getHeaders(),
          });

          if (!response.ok) {
            const text = await response.text();
            lastError = `HTTP ${response.status}: ${text.slice(0, 200)}`;
            continue;
          }

          // biome-ignore lint/suspicious/noExplicitAny: Twitter API response is dynamic here
          let data: any;
          try {
            data = await response.json();
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
            continue;
          }

          const username =
            typeof data?.screen_name === 'string'
              ? data.screen_name
              : typeof data?.user?.screen_name === 'string'
                ? data.user.screen_name
                : null;

          const name =
            typeof data?.name === 'string'
              ? data.name
              : typeof data?.user?.name === 'string'
                ? data.user.name
                : (username ?? '');

          const userId =
            typeof data?.user_id === 'string'
              ? data.user_id
              : typeof data?.user_id_str === 'string'
                ? data.user_id_str
                : typeof data?.user?.id_str === 'string'
                  ? data.user.id_str
                  : typeof data?.user?.id === 'string'
                    ? data.user.id
                    : null;

          if (username && userId) {
            this.clientUserId = userId;
            return {
              success: true,
              user: {
                id: userId,
                username,
                name: name || username,
              },
            };
          }

          lastError = 'Could not determine current user from response';
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      // Fallback: scrape the authenticated settings page (HTML) for screen_name/user_id
      const profilePages = ['https://x.com/settings/account', 'https://twitter.com/settings/account'];
      for (const page of profilePages) {
        try {
          const response = await this.fetchWithTimeout(page, {
            headers: {
              cookie: this.cookieHeader,
              'user-agent': this.userAgent,
            },
          });

          if (!response.ok) {
            lastError = `HTTP ${response.status} (settings page)`;
            continue;
          }

          const html = await response.text();
          const usernameMatch = SETTINGS_SCREEN_NAME_REGEX.exec(html);
          const idMatch = SETTINGS_USER_ID_REGEX.exec(html);
          const nameMatch = SETTINGS_NAME_REGEX.exec(html);

          const username = usernameMatch?.[1];
          const userId = idMatch?.[1];
          const name = nameMatch?.[1]?.replace(/\\"/g, '"');

          if (username && userId) {
            return {
              success: true,
              user: {
                id: userId,
                username,
                name: name || username,
              },
            };
          }

          lastError = 'Could not parse settings page for user info';
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      return {
        success: false,
        error: lastError ?? 'Unknown error fetching current user',
      };
    }

    /**
     * Get users that a user is following
     */
    async getFollowing(userId: string, count = 20, cursor?: string): Promise<FollowingResult> {
      const variables: Record<string, unknown> = {
        userId,
        count,
        includePromotedContent: false,
      };

      if (cursor) {
        variables.cursor = cursor;
      }

      const features = buildFollowingFeatures();

      const params = new URLSearchParams({
        variables: JSON.stringify(variables),
        features: JSON.stringify(features),
      });

      const tryOnce = async () => {
        let lastError: string | undefined;
        let had404 = false;
        const queryIds = await this.getFollowingQueryIds();

        for (const queryId of queryIds) {
          const url = `${TWITTER_API_BASE}/${queryId}/Following?${params.toString()}`;

          try {
            const response = await this.fetchWithTimeout(url, {
              method: 'GET',
              headers: this.getHeaders(),
            });

            if (response.status === 404) {
              had404 = true;
              lastError = `HTTP ${response.status}`;
              continue;
            }

            if (!response.ok) {
              const text = await response.text();
              return { success: false as const, error: `HTTP ${response.status}: ${text.slice(0, 200)}`, had404 };
            }

            const data = (await response.json()) as {
              data?: {
                user?: {
                  result?: {
                    timeline?: {
                      timeline?: {
                        instructions?: Array<{ type?: string; entries?: Array<unknown> }>;
                      };
                    };
                  };
                };
              };
              errors?: Array<{ message: string }>;
            };

            if (data.errors && data.errors.length > 0) {
              return { success: false as const, error: data.errors.map((e) => e.message).join(', '), had404 };
            }

            const instructions = data.data?.user?.result?.timeline?.timeline?.instructions;
            const users = parseUsersFromInstructions(instructions);
            const nextCursor = extractCursorFromInstructions(
              instructions as Array<{ entries?: Array<{ content?: unknown }> }> | undefined,
            );

            return { success: true as const, users, nextCursor, had404 };
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }
        }

        return { success: false as const, error: lastError ?? 'Unknown error fetching following', had404 };
      };

      const firstAttempt = await tryOnce();
      if (firstAttempt.success) {
        return { success: true, users: firstAttempt.users, nextCursor: firstAttempt.nextCursor };
      }

      if (firstAttempt.had404) {
        await this.refreshQueryIds();
        const secondAttempt = await tryOnce();
        if (secondAttempt.success) {
          return { success: true, users: secondAttempt.users, nextCursor: secondAttempt.nextCursor };
        }

        // GraphQL Following can also return 404 (queryId churn / endpoint flakiness).
        // Fallback to the internal v1.1 REST endpoint used by the web client (cookie-auth; no dev API key).
        // Note: REST fallback does not support cursor pagination.
        const restAttempt = await this.getFollowingViaRest(userId, count);
        if (restAttempt.success) {
          return restAttempt;
        }

        return { success: false, error: secondAttempt.error };
      }

      return { success: false, error: firstAttempt.error };
    }

    /**
     * Get users that follow a user
     */
    async getFollowers(userId: string, count = 20, cursor?: string): Promise<FollowingResult> {
      const variables: Record<string, unknown> = {
        userId,
        count,
        includePromotedContent: false,
      };

      if (cursor) {
        variables.cursor = cursor;
      }

      const features = buildFollowingFeatures();

      const params = new URLSearchParams({
        variables: JSON.stringify(variables),
        features: JSON.stringify(features),
      });

      const tryOnce = async () => {
        let lastError: string | undefined;
        let had404 = false;
        const queryIds = await this.getFollowersQueryIds();

        for (const queryId of queryIds) {
          const url = `${TWITTER_API_BASE}/${queryId}/Followers?${params.toString()}`;

          try {
            const response = await this.fetchWithTimeout(url, {
              method: 'GET',
              headers: this.getHeaders(),
            });

            if (response.status === 404) {
              had404 = true;
              lastError = `HTTP ${response.status}`;
              continue;
            }

            if (!response.ok) {
              const text = await response.text();
              return { success: false as const, error: `HTTP ${response.status}: ${text.slice(0, 200)}`, had404 };
            }

            const data = (await response.json()) as {
              data?: {
                user?: {
                  result?: {
                    timeline?: {
                      timeline?: {
                        instructions?: Array<{ type?: string; entries?: Array<unknown> }>;
                      };
                    };
                  };
                };
              };
              errors?: Array<{ message: string }>;
            };

            if (data.errors && data.errors.length > 0) {
              return { success: false as const, error: data.errors.map((e) => e.message).join(', '), had404 };
            }

            const instructions = data.data?.user?.result?.timeline?.timeline?.instructions;
            const users = parseUsersFromInstructions(instructions);
            const nextCursor = extractCursorFromInstructions(
              instructions as Array<{ entries?: Array<{ content?: unknown }> }> | undefined,
            );

            return { success: true as const, users, nextCursor, had404 };
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }
        }

        return { success: false as const, error: lastError ?? 'Unknown error fetching followers', had404 };
      };

      const firstAttempt = await tryOnce();
      if (firstAttempt.success) {
        return { success: true, users: firstAttempt.users, nextCursor: firstAttempt.nextCursor };
      }

      if (firstAttempt.had404) {
        await this.refreshQueryIds();
        const secondAttempt = await tryOnce();
        if (secondAttempt.success) {
          return { success: true, users: secondAttempt.users, nextCursor: secondAttempt.nextCursor };
        }

        // GraphQL Followers regularly returns 404 (queryId churn / endpoint flakiness).
        // Fallback to the internal v1.1 REST endpoint used by the web client (cookie-auth; no dev API key).
        // Note: REST fallback does not support cursor pagination.
        const restAttempt = await this.getFollowersViaRest(userId, count);
        if (restAttempt.success) {
          return restAttempt;
        }

        return { success: false, error: secondAttempt.error };
      }

      return { success: false, error: firstAttempt.error };
    }
  }

  return TwitterClientUsers;
}
