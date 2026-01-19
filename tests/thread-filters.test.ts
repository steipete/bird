import { describe, expect, it } from 'vitest';
import { filterFullChain } from '../src/lib/thread-filters.js';
import type { TweetData } from '../src/lib/twitter-client-types.js';

const makeTweet = (id: string, createdAt: string, inReplyToStatusId?: string, conversationId = '1'): TweetData => ({
  id,
  text: id,
  author: { username: 'alice', name: 'Alice' },
  createdAt,
  inReplyToStatusId,
  conversationId,
});

describe('filterFullChain', () => {
  it('returns ancestors + descendants from the bookmark only', () => {
    const root = makeTweet('1', '2020-01-01T00:00:00Z');
    const replyA = makeTweet('2', '2020-01-02T00:00:00Z', '1');
    const bookmark = makeTweet('3', '2020-01-03T00:00:00Z', '2');
    const childA = makeTweet('4', '2020-01-04T00:00:00Z', '3');
    const childB = makeTweet('7', '2020-01-05T00:00:00Z', '4');
    const siblingOfAncestor = makeTweet('5', '2020-01-06T00:00:00Z', '2');
    const siblingOfRoot = makeTweet('6', '2020-01-07T00:00:00Z', '1');

    const tweets = [siblingOfAncestor, childB, root, siblingOfRoot, bookmark, childA, replyA];

    const result = filterFullChain(tweets, bookmark);
    expect(result.map((tweet) => tweet.id)).toEqual(['1', '2', '3', '4', '7']);
  });

  it('includes ancestor branches when requested', () => {
    const root = makeTweet('1', '2020-01-01T00:00:00Z');
    const replyA = makeTweet('2', '2020-01-02T00:00:00Z', '1');
    const bookmark = makeTweet('3', '2020-01-03T00:00:00Z', '2');
    const childA = makeTweet('4', '2020-01-04T00:00:00Z', '3');
    const childB = makeTweet('7', '2020-01-05T00:00:00Z', '4');
    const siblingOfAncestor = makeTweet('5', '2020-01-06T00:00:00Z', '2');
    const siblingOfRoot = makeTweet('6', '2020-01-07T00:00:00Z', '1');

    const tweets = [siblingOfRoot, childA, replyA, childB, bookmark, root, siblingOfAncestor];

    const result = filterFullChain(tweets, bookmark, { includeAncestorBranches: true });
    expect(result.map((tweet) => tweet.id)).toEqual(['1', '2', '3', '4', '7', '5', '6']);
  });
});
