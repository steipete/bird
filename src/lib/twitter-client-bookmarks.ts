import type { AbstractConstructor, Mixin, TwitterClientBase } from './twitter-client-base.js';
import { TWITTER_API_BASE, TWITTER_GRAPHQL_POST_URL } from './twitter-client-constants.js';
import type { BookmarkMutationResult } from './twitter-client-types.js';

export interface TwitterClientBookmarkMethods {
  unbookmark(tweetId: string): Promise<BookmarkMutationResult>;
}

export function withBookmarks<TBase extends AbstractConstructor<TwitterClientBase>>(
  Base: TBase,
): Mixin<TBase, TwitterClientBookmarkMethods> {
  abstract class TwitterClientBookmarks extends Base {
    // biome-ignore lint/complexity/noUselessConstructor lint/suspicious/noExplicitAny: TS mixin constructor requirement.
    constructor(...args: any[]) {
      super(...args);
    }

    async unbookmark(tweetId: string): Promise<BookmarkMutationResult> {
      const variables = { tweet_id: tweetId };
      let queryId = await this.getQueryId('DeleteBookmark');
      let urlWithOperation = `${TWITTER_API_BASE}/${queryId}/DeleteBookmark`;

      const buildBody = () => JSON.stringify({ variables, queryId });
      let body = buildBody();

      const headers = { ...this.getHeaders(), referer: `https://x.com/i/status/${tweetId}` };

      const parseResponse = async (response: Response): Promise<BookmarkMutationResult> => {
        if (!response.ok) {
          const text = await response.text();
          return { success: false, error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
        }

        const data = (await response.json()) as { errors?: Array<{ message: string }> };
        if (data.errors && data.errors.length > 0) {
          return { success: false, error: data.errors.map((e) => e.message).join(', ') };
        }

        return { success: true };
      };

      try {
        let response = await this.fetchWithTimeout(urlWithOperation, {
          method: 'POST',
          headers,
          body,
        });

        if (response.status === 404) {
          await this.refreshQueryIds();
          queryId = await this.getQueryId('DeleteBookmark');
          urlWithOperation = `${TWITTER_API_BASE}/${queryId}/DeleteBookmark`;
          body = buildBody();

          response = await this.fetchWithTimeout(urlWithOperation, {
            method: 'POST',
            headers,
            body,
          });

          if (response.status === 404) {
            const retry = await this.fetchWithTimeout(TWITTER_GRAPHQL_POST_URL, {
              method: 'POST',
              headers,
              body,
            });

            return parseResponse(retry);
          }
        }

        return parseResponse(response);
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  }

  return TwitterClientBookmarks;
}
