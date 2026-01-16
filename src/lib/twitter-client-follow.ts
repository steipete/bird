import type { AbstractConstructor, Mixin, TwitterClientBase } from './twitter-client-base.js';
import { TWITTER_API_BASE } from './twitter-client-constants.js';
import type { FollowMutationResult } from './twitter-client-types.js';

export interface TwitterClientFollowMethods {
  follow(userId: string): Promise<FollowMutationResult>;
  unfollow(userId: string): Promise<FollowMutationResult>;
}

export function withFollow<TBase extends AbstractConstructor<TwitterClientBase>>(
  Base: TBase,
): Mixin<TBase, TwitterClientFollowMethods> {
  abstract class TwitterClientFollow extends Base {
    // biome-ignore lint/complexity/noUselessConstructor lint/suspicious/noExplicitAny: TS mixin constructor requirement.
    constructor(...args: any[]) {
      super(...args);
    }

    /**
     * Follow a user by their user ID
     */
    async follow(userId: string): Promise<FollowMutationResult> {
      await this.ensureClientUserId();

      // Try REST API first (more reliable for follow/unfollow)
      const restResult = await this.followViaRest(userId, 'create');
      if (restResult.success) {
        return restResult;
      }

      // Fallback to GraphQL
      return this.followViaGraphQL(userId, true);
    }

    /**
     * Unfollow a user by their user ID
     */
    async unfollow(userId: string): Promise<FollowMutationResult> {
      await this.ensureClientUserId();

      // Try REST API first (more reliable for follow/unfollow)
      const restResult = await this.followViaRest(userId, 'destroy');
      if (restResult.success) {
        return restResult;
      }

      // Fallback to GraphQL
      return this.followViaGraphQL(userId, false);
    }

    private async followViaRest(
      userId: string,
      action: 'create' | 'destroy',
    ): Promise<FollowMutationResult> {
      const urls = [
        `https://x.com/i/api/1.1/friendships/${action}.json`,
        `https://api.twitter.com/1.1/friendships/${action}.json`,
      ];

      const params = new URLSearchParams({
        user_id: userId,
        skip_status: 'true',
      });

      let lastError: string | undefined;

      for (const url of urls) {
        try {
          const response = await this.fetchWithTimeout(url, {
            method: 'POST',
            headers: {
              ...this.getBaseHeaders(),
              'content-type': 'application/x-www-form-urlencoded',
            },
            body: params.toString(),
          });

          if (!response.ok) {
            const text = await response.text();
            
            // Parse error response
            try {
              const errorData = JSON.parse(text) as { errors?: Array<{ code: number; message: string }> };
              if (errorData.errors && errorData.errors.length > 0) {
                const error = errorData.errors[0];
                // Code 160: Already following / already not following
                if (error.code === 160) {
                  return { success: true };
                }
                // Code 162: Blocked from following
                if (error.code === 162) {
                  return { success: false, error: 'You have been blocked from following this account' };
                }
                // Code 108: Cannot find specified user
                if (error.code === 108) {
                  return { success: false, error: 'User not found' };
                }
                lastError = `${error.message} (code ${error.code})`;
                continue;
              }
            } catch {
              // Not JSON, continue with generic error
            }

            lastError = `HTTP ${response.status}: ${text.slice(0, 200)}`;
            continue;
          }

          const data = (await response.json()) as {
            id_str?: string;
            screen_name?: string;
            following?: boolean;
            errors?: Array<{ message: string; code?: number }>;
          };

          if (data.errors && data.errors.length > 0) {
            lastError = data.errors.map((e) => e.message).join(', ');
            continue;
          }

          // Success - user data returned
          if (data.id_str || data.screen_name) {
            return {
              success: true,
              userId: data.id_str,
              username: data.screen_name,
            };
          }

          return { success: true };
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      return { success: false, error: lastError ?? `Unknown error during ${action}` };
    }

    private async followViaGraphQL(userId: string, follow: boolean): Promise<FollowMutationResult> {
      const operationName = follow ? 'CreateFriendship' : 'DestroyFriendship';
      
      // Known query IDs for friendship operations
      const queryIds = follow
        ? ['8h9JVdV8dlSyqyRDJEPCsA', 'OPwKc1HXnBT_bWXfAlo-9g']
        : ['8h9JVdV8dlSyqyRDJEPCsA', 'ppXWuagMNXgvzx6WoXBW0Q'];

      const variables = {
        user_id: userId,
      };

      let lastError: string | undefined;

      for (const queryId of queryIds) {
        const url = `${TWITTER_API_BASE}/${queryId}/${operationName}`;

        try {
          const response = await this.fetchWithTimeout(url, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({ variables, queryId }),
          });

          if (response.status === 404) {
            lastError = `HTTP 404`;
            continue;
          }

          if (!response.ok) {
            const text = await response.text();
            lastError = `HTTP ${response.status}: ${text.slice(0, 200)}`;
            continue;
          }

          const data = (await response.json()) as {
            data?: {
              user?: {
                result?: {
                  rest_id?: string;
                  legacy?: {
                    screen_name?: string;
                  };
                };
              };
            };
            errors?: Array<{ message: string }>;
          };

          if (data.errors && data.errors.length > 0) {
            lastError = data.errors.map((e) => e.message).join(', ');
            continue;
          }

          const result = data.data?.user?.result;
          return {
            success: true,
            userId: result?.rest_id,
            username: result?.legacy?.screen_name,
          };
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      return { success: false, error: lastError ?? `Unknown error during ${operationName}` };
    }
  }

  return TwitterClientFollow;
}
