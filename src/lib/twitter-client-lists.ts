// ABOUTME: Mixin for Twitter Lists GraphQL operations.
// ABOUTME: Provides methods to fetch user's owned lists, memberships, and list timelines.

import type { AbstractConstructor, Mixin, TwitterClientBase } from './twitter-client-base.js';
import { TWITTER_API_BASE } from './twitter-client-constants.js';
import { buildListsFeatures } from './twitter-client-features.js';
import type { TimelineFetchOptions } from './twitter-client-timelines.js';
import type { GraphqlTweetResult, ListsResult, SearchResult, TwitterList } from './twitter-client-types.js';
import { parseTweetsFromInstructions } from './twitter-client-utils.js';

export interface TwitterClientListMethods {
  getOwnedLists(count?: number): Promise<ListsResult>;
  getListMemberships(count?: number): Promise<ListsResult>;
  getListTimeline(listId: string, count?: number, options?: TimelineFetchOptions): Promise<SearchResult>;
}

interface GraphqlListResult {
  id_str?: string;
  name?: string;
  description?: string;
  member_count?: number;
  subscriber_count?: number;
  mode?: string;
  created_at?: string;
  user_results?: {
    result?: {
      rest_id?: string;
      legacy?: {
        screen_name?: string;
        name?: string;
      };
    };
  };
}

function parseList(listResult: GraphqlListResult): TwitterList | null {
  if (!listResult.id_str || !listResult.name) {
    return null;
  }

  const owner = listResult.user_results?.result;
  return {
    id: listResult.id_str,
    name: listResult.name,
    description: listResult.description,
    memberCount: listResult.member_count,
    subscriberCount: listResult.subscriber_count,
    isPrivate: listResult.mode === 'Private',
    createdAt: listResult.created_at,
    owner: owner
      ? {
          id: owner.rest_id ?? '',
          username: owner.legacy?.screen_name ?? '',
          name: owner.legacy?.name ?? '',
        }
      : undefined,
  };
}

function parseListsFromInstructions(
  instructions:
    | Array<{
        entries?: Array<{
          content?: {
            itemContent?: {
              list?: GraphqlListResult;
            };
          };
        }>;
      }>
    | undefined,
): TwitterList[] {
  const lists: TwitterList[] = [];
  if (!instructions) {
    return lists;
  }

  for (const instruction of instructions) {
    if (!instruction.entries) {
      continue;
    }
    for (const entry of instruction.entries) {
      const listResult = entry.content?.itemContent?.list;
      if (listResult) {
        const parsed = parseList(listResult);
        if (parsed) {
          lists.push(parsed);
        }
      }
    }
  }

  return lists;
}

export function withLists<TBase extends AbstractConstructor<TwitterClientBase>>(
  Base: TBase,
): Mixin<TBase, TwitterClientListMethods> {
  abstract class TwitterClientLists extends Base {
    // biome-ignore lint/complexity/noUselessConstructor lint/suspicious/noExplicitAny: TS mixin constructor requirement.
    constructor(...args: any[]) {
      super(...args);
    }

    private async getListOwnershipsQueryIds(): Promise<string[]> {
      const primary = await this.getQueryId('ListOwnerships');
      return Array.from(new Set([primary, 'wQcOSjSQ8NtgxIwvYl1lMg']));
    }

    private async getListMembershipsQueryIds(): Promise<string[]> {
      const primary = await this.getQueryId('ListMemberships');
      return Array.from(new Set([primary, 'BlEXXdARdSeL_0KyKHHvvg']));
    }

    private async getListTimelineQueryIds(): Promise<string[]> {
      const primary = await this.getQueryId('ListLatestTweetsTimeline');
      return Array.from(new Set([primary, '2TemLyqrMpTeAmysdbnVqw']));
    }

    /**
     * Get lists owned by the authenticated user
     */
    async getOwnedLists(count = 100): Promise<ListsResult> {
      const userResult = await this.getCurrentUser();
      if (!userResult.success || !userResult.user) {
        return { success: false, error: userResult.error ?? 'Could not determine current user' };
      }

      const variables = {
        userId: userResult.user.id,
        count,
        isListMembershipShown: true,
        isListMemberTargetUserId: userResult.user.id,
      };

      const features = buildListsFeatures();

      const params = new URLSearchParams({
        variables: JSON.stringify(variables),
        features: JSON.stringify(features),
      });

      const tryOnce = async () => {
        let lastError: string | undefined;
        let had404 = false;
        const queryIds = await this.getListOwnershipsQueryIds();

        for (const queryId of queryIds) {
          const url = `${TWITTER_API_BASE}/${queryId}/ListOwnerships?${params.toString()}`;

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
                        instructions?: Array<{
                          entries?: Array<{
                            content?: {
                              itemContent?: {
                                list?: GraphqlListResult;
                              };
                            };
                          }>;
                        }>;
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
            const lists = parseListsFromInstructions(instructions);

            return { success: true as const, lists, had404 };
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }
        }

        return { success: false as const, error: lastError ?? 'Unknown error fetching owned lists', had404 };
      };

      const firstAttempt = await tryOnce();
      if (firstAttempt.success) {
        return { success: true, lists: firstAttempt.lists };
      }

      if (firstAttempt.had404) {
        await this.refreshQueryIds();
        const secondAttempt = await tryOnce();
        if (secondAttempt.success) {
          return { success: true, lists: secondAttempt.lists };
        }
        return { success: false, error: secondAttempt.error };
      }

      return { success: false, error: firstAttempt.error };
    }

    /**
     * Get lists the authenticated user is a member of
     */
    async getListMemberships(count = 100): Promise<ListsResult> {
      const userResult = await this.getCurrentUser();
      if (!userResult.success || !userResult.user) {
        return { success: false, error: userResult.error ?? 'Could not determine current user' };
      }

      const variables = {
        userId: userResult.user.id,
        count,
        isListMembershipShown: true,
        isListMemberTargetUserId: userResult.user.id,
      };

      const features = buildListsFeatures();

      const params = new URLSearchParams({
        variables: JSON.stringify(variables),
        features: JSON.stringify(features),
      });

      const tryOnce = async () => {
        let lastError: string | undefined;
        let had404 = false;
        const queryIds = await this.getListMembershipsQueryIds();

        for (const queryId of queryIds) {
          const url = `${TWITTER_API_BASE}/${queryId}/ListMemberships?${params.toString()}`;

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
                        instructions?: Array<{
                          entries?: Array<{
                            content?: {
                              itemContent?: {
                                list?: GraphqlListResult;
                              };
                            };
                          }>;
                        }>;
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
            const lists = parseListsFromInstructions(instructions);

            return { success: true as const, lists, had404 };
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }
        }

        return { success: false as const, error: lastError ?? 'Unknown error fetching list memberships', had404 };
      };

      const firstAttempt = await tryOnce();
      if (firstAttempt.success) {
        return { success: true, lists: firstAttempt.lists };
      }

      if (firstAttempt.had404) {
        await this.refreshQueryIds();
        const secondAttempt = await tryOnce();
        if (secondAttempt.success) {
          return { success: true, lists: secondAttempt.lists };
        }
        return { success: false, error: secondAttempt.error };
      }

      return { success: false, error: firstAttempt.error };
    }

    /**
     * Get tweets from a list timeline
     */
    async getListTimeline(listId: string, count = 20, options: TimelineFetchOptions = {}): Promise<SearchResult> {
      const { includeRaw = false } = options;

      const variables = {
        listId,
        count,
      };

      const features = buildListsFeatures();

      const params = new URLSearchParams({
        variables: JSON.stringify(variables),
        features: JSON.stringify(features),
      });

      const tryOnce = async () => {
        let lastError: string | undefined;
        let had404 = false;
        const queryIds = await this.getListTimelineQueryIds();

        for (const queryId of queryIds) {
          const url = `${TWITTER_API_BASE}/${queryId}/ListLatestTweetsTimeline?${params.toString()}`;

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
                list?: {
                  tweets_timeline?: {
                    timeline?: {
                      instructions?: Array<{
                        entries?: Array<{
                          content?: {
                            itemContent?: {
                              tweet_results?: {
                                result?: GraphqlTweetResult;
                              };
                            };
                          };
                        }>;
                      }>;
                    };
                  };
                };
              };
              errors?: Array<{ message: string }>;
            };

            if (data.errors && data.errors.length > 0) {
              return { success: false as const, error: data.errors.map((e) => e.message).join(', '), had404 };
            }

            const instructions = data.data?.list?.tweets_timeline?.timeline?.instructions;
            const tweets = parseTweetsFromInstructions(instructions, { quoteDepth: this.quoteDepth, includeRaw });

            return { success: true as const, tweets, had404 };
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }
        }

        return { success: false as const, error: lastError ?? 'Unknown error fetching list timeline', had404 };
      };

      const firstAttempt = await tryOnce();
      if (firstAttempt.success) {
        return { success: true, tweets: firstAttempt.tweets };
      }

      if (firstAttempt.had404) {
        await this.refreshQueryIds();
        const secondAttempt = await tryOnce();
        if (secondAttempt.success) {
          return { success: true, tweets: secondAttempt.tweets };
        }
        return { success: false, error: secondAttempt.error };
      }

      return { success: false, error: firstAttempt.error };
    }
  }

  return TwitterClientLists;
}
