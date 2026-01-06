import { describe, expect, it } from 'vitest';
import type { GraphqlTweetResult } from '../src/lib/twitter-client-types.js';
import { mapTweetResult } from '../src/lib/twitter-client-utils.js';

describe('mapTweetResult article', () => {
  const makeUserResult = () => ({
    core: {
      user_results: {
        result: {
          rest_id: 'u1',
          legacy: { screen_name: 'alice', name: 'Alice' },
        },
      },
    },
  });

  it('includes extracted article metadata on mapped tweet', () => {
    const result: GraphqlTweetResult = {
      rest_id: '1',
      legacy: {
        full_text: 'Check out my article',
      },
      article: {
        article_results: {
          result: {
            title: 'Building Context Graphs for GTM',
            preview_text: 'Foundation Capital recently argued...',
          },
        },
      },
      ...makeUserResult(),
    } as GraphqlTweetResult;

    const mapped = mapTweetResult(result, 0);
    expect(mapped).toBeDefined();
    expect(mapped?.article).toEqual({
      title: 'Building Context Graphs for GTM',
      previewText: 'Foundation Capital recently argued...',
    });
  });

  it('omits article when none present', () => {
    const result: GraphqlTweetResult = {
      rest_id: '2',
      legacy: { full_text: 'no article' },
      ...makeUserResult(),
    };

    const mapped = mapTweetResult(result, 0);
    expect(mapped?.article).toBeUndefined();
  });

  it('includes article with only title when no preview_text', () => {
    const result: GraphqlTweetResult = {
      rest_id: '3',
      legacy: { full_text: 'article link' },
      article: {
        article_results: {
          result: {
            title: 'My Article Title',
          },
        },
      },
      ...makeUserResult(),
    };

    const mapped = mapTweetResult(result, 0);
    expect(mapped?.article).toEqual({
      title: 'My Article Title',
      previewText: undefined,
    });
  });
});
