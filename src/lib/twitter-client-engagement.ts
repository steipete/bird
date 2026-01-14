import type { AbstractConstructor, Mixin, TwitterClientBase } from './twitter-client-base.js';
import { type OperationName, TWITTER_API_BASE, TWITTER_GRAPHQL_POST_URL } from './twitter-client-constants.js';
import type { BookmarkMutationResult } from './twitter-client-types.js';

export interface TwitterClientEngagementMethods {
  /** Like a tweet. */
  like(tweetId: string): Promise<BookmarkMutationResult>;
  /** Remove a like from a tweet. */
  unlike(tweetId: string): Promise<BookmarkMutationResult>;
  /** Retweet a tweet. */
  retweet(tweetId: string): Promise<BookmarkMutationResult>;
  /** Remove a retweet. */
  unretweet(tweetId: string): Promise<BookmarkMutationResult>;
  /** Bookmark a tweet. */
  bookmark(tweetId: string): Promise<BookmarkMutationResult>;
}

export function withEngagement<TBase extends AbstractConstructor<TwitterClientBase>>(
  Base: TBase,
): Mixin<TBase, TwitterClientEngagementMethods> {
  abstract class TwitterClientEngagement extends Base {
    // biome-ignore lint/complexity/noUselessConstructor lint/suspicious/noExplicitAny: TS mixin constructor requirement.
    constructor(...args: any[]) {
      super(...args);
    }

    private async performEngagementMutation(
      operationName: OperationName,
      tweetId: string,
    ): Promise<BookmarkMutationResult> {
      const variables = { tweet_id: tweetId };
      let queryId = await this.getQueryId(operationName);
      let urlWithOperation = `${TWITTER_API_BASE}/${queryId}/${operationName}`;

      const buildBody = () => JSON.stringify({ variables, queryId });
      const buildHeaders = () => ({ ...this.getHeaders(), referer: `https://x.com/i/status/${tweetId}` });
      let body = buildBody();

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
          headers: buildHeaders(),
          body,
        });

        if (response.status === 404) {
          await this.refreshQueryIds();
          queryId = await this.getQueryId(operationName);
          urlWithOperation = `${TWITTER_API_BASE}/${queryId}/${operationName}`;
          body = buildBody();

          response = await this.fetchWithTimeout(urlWithOperation, {
            method: 'POST',
            headers: buildHeaders(),
            body,
          });

          if (response.status === 404) {
            const retry = await this.fetchWithTimeout(TWITTER_GRAPHQL_POST_URL, {
              method: 'POST',
              headers: buildHeaders(),
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

    /** Like a tweet. */
    async like(tweetId: string): Promise<BookmarkMutationResult> {
      return this.performEngagementMutation('FavoriteTweet', tweetId);
    }

    /** Remove a like from a tweet. */
    async unlike(tweetId: string): Promise<BookmarkMutationResult> {
      return this.performEngagementMutation('UnfavoriteTweet', tweetId);
    }

    /** Retweet a tweet. */
    async retweet(tweetId: string): Promise<BookmarkMutationResult> {
      return this.performEngagementMutation('CreateRetweet', tweetId);
    }

    /** Remove a retweet. */
    async unretweet(tweetId: string): Promise<BookmarkMutationResult> {
      return this.performEngagementMutation('DeleteRetweet', tweetId);
    }

    /** Bookmark a tweet. */
    async bookmark(tweetId: string): Promise<BookmarkMutationResult> {
      return this.performEngagementMutation('CreateBookmark', tweetId);
    }
  }

  return TwitterClientEngagement;
}
