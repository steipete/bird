import type { TweetData, TweetWithMeta } from './twitter-client-types.js';

const sortByCreatedAt = (tweets: TweetData[]): TweetData[] =>
  tweets.slice().sort((a, b) => {
    const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
    return aTime - bTime;
  });

export function filterAuthorChain(tweets: TweetData[], bookmarkedTweet: TweetData): TweetData[] {
  const author = bookmarkedTweet.author.username;
  const byId = new Map(tweets.map((tweet) => [tweet.id, tweet]));
  const chainIds = new Set<string>();

  let current: TweetData | undefined = bookmarkedTweet;
  while (current && current.author.username === author) {
    chainIds.add(current.id);
    const parentId = current.inReplyToStatusId;
    if (!parentId) {
      break;
    }
    const parent = byId.get(parentId);
    if (!parent || parent.author.username !== author) {
      break;
    }
    current = parent;
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const tweet of tweets) {
      if (tweet.author.username !== author) {
        continue;
      }
      if (chainIds.has(tweet.id)) {
        continue;
      }
      if (tweet.inReplyToStatusId && chainIds.has(tweet.inReplyToStatusId)) {
        chainIds.add(tweet.id);
        changed = true;
      }
    }
  }

  return sortByCreatedAt(tweets.filter((tweet) => chainIds.has(tweet.id)));
}

export function filterAuthorOnly(tweets: TweetData[], bookmarkedTweet: TweetData): TweetData[] {
  const author = bookmarkedTweet.author.username;
  return tweets.filter((tweet) => tweet.author.username === author);
}

export function filterFullChain(
  tweets: TweetData[],
  bookmarkedTweet: TweetData,
  options: { includeAncestorBranches?: boolean } = {},
): TweetData[] {
  const byId = new Map(tweets.map((tweet) => [tweet.id, tweet]));
  const repliesByParent = new Map<string, TweetData[]>();

  for (const tweet of tweets) {
    if (!tweet.inReplyToStatusId) {
      continue;
    }
    const list = repliesByParent.get(tweet.inReplyToStatusId) ?? [];
    list.push(tweet);
    repliesByParent.set(tweet.inReplyToStatusId, list);
  }

  const chainIds = new Set<string>();
  const ancestorIds: string[] = [];

  chainIds.add(bookmarkedTweet.id);
  let current: TweetData | undefined = bookmarkedTweet;
  while (current?.inReplyToStatusId) {
    const parent = byId.get(current.inReplyToStatusId);
    if (!parent) {
      break;
    }
    if (!chainIds.has(parent.id)) {
      chainIds.add(parent.id);
      ancestorIds.push(parent.id);
    }
    current = parent;
  }

  const addDescendants = (startIds: string[]) => {
    const queue = [...startIds];
    while (queue.length > 0) {
      const currentId = queue.shift();
      if (!currentId) {
        continue;
      }
      if (!chainIds.has(currentId)) {
        chainIds.add(currentId);
      }
      const replies = repliesByParent.get(currentId) ?? [];
      for (const reply of replies) {
        if (chainIds.has(reply.id)) {
          continue;
        }
        chainIds.add(reply.id);
        queue.push(reply.id);
      }
    }
  };

  addDescendants([bookmarkedTweet.id]);

  if (options.includeAncestorBranches) {
    for (const ancestorId of ancestorIds) {
      addDescendants([ancestorId]);
    }
  }

  return sortByCreatedAt(tweets.filter((tweet) => chainIds.has(tweet.id)));
}

export function addThreadMetadata(tweet: TweetData, allConversationTweets: TweetData[]): TweetWithMeta {
  const author = tweet.author.username;
  const hasSelfReplies = allConversationTweets.some(
    (candidate) => candidate.inReplyToStatusId === tweet.id && candidate.author.username === author,
  );

  const isRoot = !tweet.inReplyToStatusId;
  let threadPosition: 'root' | 'middle' | 'end' | 'standalone';

  if (isRoot && !hasSelfReplies) {
    threadPosition = 'standalone';
  } else if (isRoot && hasSelfReplies) {
    threadPosition = 'root';
  } else if (!isRoot && hasSelfReplies) {
    threadPosition = 'middle';
  } else {
    threadPosition = 'end';
  }

  return {
    ...tweet,
    isThread: hasSelfReplies || !isRoot,
    threadPosition,
    hasSelfReplies,
    threadRootId: tweet.conversationId ?? null,
  };
}
