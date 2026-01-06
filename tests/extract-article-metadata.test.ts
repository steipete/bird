import { describe, expect, it } from 'vitest';
import type { GraphqlTweetResult } from '../src/lib/twitter-client-types.js';
import { extractArticleMetadata } from '../src/lib/twitter-client-utils.js';

describe('extractArticleMetadata', () => {
  it('returns undefined when no result', () => {
    expect(extractArticleMetadata(undefined)).toBeUndefined();
  });

  it('returns undefined when no article field', () => {
    const result: GraphqlTweetResult = {
      rest_id: '123',
      legacy: { full_text: 'Hello world' },
    };
    expect(extractArticleMetadata(result)).toBeUndefined();
  });

  it('returns undefined when article has no title', () => {
    const result: GraphqlTweetResult = {
      rest_id: '123',
      article: {
        article_results: {
          result: {},
        },
      },
    };
    expect(extractArticleMetadata(result)).toBeUndefined();
  });

  it('extracts title from article_results.result', () => {
    const result: GraphqlTweetResult = {
      rest_id: '123',
      article: {
        article_results: {
          result: {
            title: 'Building Context Graphs for GTM',
          },
        },
      },
    };

    const metadata = extractArticleMetadata(result);
    expect(metadata).toEqual({
      title: 'Building Context Graphs for GTM',
      previewText: undefined,
    });
  });

  it('extracts title and preview_text from article_results.result', () => {
    const result: GraphqlTweetResult = {
      rest_id: '123',
      article: {
        article_results: {
          result: {
            title: 'Building Context Graphs for GTM',
            preview_text:
              'Foundation Capital recently argued that one of the next trillion-dollar opportunities in AI will come from context graphs.',
          },
        },
      },
    } as GraphqlTweetResult;

    const metadata = extractArticleMetadata(result);
    expect(metadata).toEqual({
      title: 'Building Context Graphs for GTM',
      previewText:
        'Foundation Capital recently argued that one of the next trillion-dollar opportunities in AI will come from context graphs.',
    });
  });

  it('falls back to article.title when article_results.result.title missing', () => {
    const result: GraphqlTweetResult = {
      rest_id: '123',
      article: {
        title: 'Fallback Title',
        article_results: {
          result: {},
        },
      },
    };

    const metadata = extractArticleMetadata(result);
    expect(metadata).toEqual({
      title: 'Fallback Title',
      previewText: undefined,
    });
  });
});
