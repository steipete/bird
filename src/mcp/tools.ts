/**
 * MCP Tool definitions and handlers for xBird
 */

import type { TwitterClient } from '../lib/index.js';

/**
 * Tool definition type
 */
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; default?: unknown }>;
    required?: string[];
  };
}

/**
 * Tool handler function type
 */
type ToolHandler = (client: TwitterClient, args: Record<string, unknown>) => Promise<unknown>;

/**
 * All available MCP tools
 */
export const tools: ToolDefinition[] = [
  // ============ READ OPERATIONS ============
  {
    name: 'get_tweet',
    description: 'Get a single tweet by its ID. Returns tweet content, author, metrics, and media.',
    inputSchema: {
      type: 'object',
      properties: {
        tweet_id: {
          type: 'string',
          description: 'The ID of the tweet to fetch',
        },
      },
      required: ['tweet_id'],
    },
  },
  {
    name: 'get_thread',
    description:
      'Get the full conversation thread for a tweet. Returns all tweets in the thread sorted chronologically.',
    inputSchema: {
      type: 'object',
      properties: {
        tweet_id: {
          type: 'string',
          description: 'The ID of any tweet in the thread',
        },
        max_pages: {
          type: 'number',
          description: 'Maximum pages to fetch (default: 3)',
          default: 3,
        },
      },
      required: ['tweet_id'],
    },
  },
  {
    name: 'get_replies',
    description: 'Get replies to a specific tweet.',
    inputSchema: {
      type: 'object',
      properties: {
        tweet_id: {
          type: 'string',
          description: 'The ID of the tweet to get replies for',
        },
        max_pages: {
          type: 'number',
          description: 'Maximum pages to fetch (default: 3)',
          default: 3,
        },
      },
      required: ['tweet_id'],
    },
  },

  // ============ SEARCH ============
  {
    name: 'search_tweets',
    description:
      'Search for tweets matching a query. Supports Twitter search operators like "from:user", "to:user", "since:date", "until:date", "#hashtag", etc.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (supports Twitter search operators)',
        },
        count: {
          type: 'number',
          description: 'Maximum number of tweets to return (default: 20)',
          default: 20,
        },
      },
      required: ['query'],
    },
  },

  // ============ TIMELINES ============
  {
    name: 'get_home_timeline',
    description: 'Get the authenticated user\'s "For You" home timeline.',
    inputSchema: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          description: 'Number of tweets to fetch (default: 20)',
          default: 20,
        },
      },
    },
  },
  {
    name: 'get_following_timeline',
    description: 'Get the authenticated user\'s "Following" timeline (chronological).',
    inputSchema: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          description: 'Number of tweets to fetch (default: 20)',
          default: 20,
        },
      },
    },
  },
  {
    name: 'get_user_tweets',
    description: "Get tweets from a specific user's profile.",
    inputSchema: {
      type: 'object',
      properties: {
        username: {
          type: 'string',
          description: 'Twitter username (without @)',
        },
        count: {
          type: 'number',
          description: 'Number of tweets to fetch (default: 20)',
          default: 20,
        },
      },
      required: ['username'],
    },
  },
  {
    name: 'get_mentions',
    description: 'Get tweets mentioning a specific user.',
    inputSchema: {
      type: 'object',
      properties: {
        username: {
          type: 'string',
          description: 'Twitter username to find mentions of (without @)',
        },
        count: {
          type: 'number',
          description: 'Number of tweets to fetch (default: 20)',
          default: 20,
        },
      },
      required: ['username'],
    },
  },

  // ============ BOOKMARKS ============
  {
    name: 'get_bookmarks',
    description: "Get the authenticated user's bookmarked tweets.",
    inputSchema: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          description: 'Number of bookmarks to fetch (default: 20)',
          default: 20,
        },
      },
    },
  },
  {
    name: 'get_likes',
    description: "Get the authenticated user's liked tweets.",
    inputSchema: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          description: 'Number of liked tweets to fetch (default: 20)',
          default: 20,
        },
      },
    },
  },

  // ============ TRENDING & NEWS ============
  {
    name: 'get_trending',
    description: 'Get trending topics and hashtags from the Explore page.',
    inputSchema: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          description: 'Number of trends to fetch (default: 10)',
          default: 10,
        },
      },
    },
  },
  {
    name: 'get_news',
    description: 'Get AI-curated news from X/Twitter Explore page.',
    inputSchema: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          description: 'Number of news items to fetch (default: 10)',
          default: 10,
        },
      },
    },
  },

  // ============ USER OPERATIONS ============
  {
    name: 'get_user_info',
    description: 'Get information about a Twitter user by username.',
    inputSchema: {
      type: 'object',
      properties: {
        username: {
          type: 'string',
          description: 'Twitter username (without @)',
        },
      },
      required: ['username'],
    },
  },
  {
    name: 'get_followers',
    description: 'Get followers of a user.',
    inputSchema: {
      type: 'object',
      properties: {
        username: {
          type: 'string',
          description: 'Twitter username (without @)',
        },
        count: {
          type: 'number',
          description: 'Number of followers to fetch (default: 20)',
          default: 20,
        },
      },
      required: ['username'],
    },
  },
  {
    name: 'get_following',
    description: 'Get users that a user is following.',
    inputSchema: {
      type: 'object',
      properties: {
        username: {
          type: 'string',
          description: 'Twitter username (without @)',
        },
        count: {
          type: 'number',
          description: 'Number of users to fetch (default: 20)',
          default: 20,
        },
      },
      required: ['username'],
    },
  },
  {
    name: 'whoami',
    description: 'Get information about the currently authenticated user.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // ============ LISTS ============
  {
    name: 'get_owned_lists',
    description: "Get the authenticated user's owned Twitter lists.",
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_list_memberships',
    description: 'Get Twitter lists the authenticated user is a member of.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_list_timeline',
    description: 'Get tweets from a specific Twitter list.',
    inputSchema: {
      type: 'object',
      properties: {
        list_id: {
          type: 'string',
          description: 'The ID of the list',
        },
        count: {
          type: 'number',
          description: 'Number of tweets to fetch (default: 20)',
          default: 20,
        },
      },
      required: ['list_id'],
    },
  },

  // ============ WRITE OPERATIONS ============
  {
    name: 'post_tweet',
    description:
      'Post a new tweet. WARNING: Use sparingly as frequent tweeting may trigger bot detection.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The text content of the tweet (max 280 characters)',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'reply_to_tweet',
    description:
      'Reply to an existing tweet. WARNING: Use sparingly as frequent replies may trigger bot detection.',
    inputSchema: {
      type: 'object',
      properties: {
        tweet_id: {
          type: 'string',
          description: 'The ID of the tweet to reply to',
        },
        text: {
          type: 'string',
          description: 'The text content of the reply (max 280 characters)',
        },
      },
      required: ['tweet_id', 'text'],
    },
  },

  // ============ ENGAGEMENT ============
  {
    name: 'like_tweet',
    description: 'Like a tweet.',
    inputSchema: {
      type: 'object',
      properties: {
        tweet_id: {
          type: 'string',
          description: 'The ID of the tweet to like',
        },
      },
      required: ['tweet_id'],
    },
  },
  {
    name: 'unlike_tweet',
    description: 'Remove a like from a tweet.',
    inputSchema: {
      type: 'object',
      properties: {
        tweet_id: {
          type: 'string',
          description: 'The ID of the tweet to unlike',
        },
      },
      required: ['tweet_id'],
    },
  },
  {
    name: 'bookmark_tweet',
    description: 'Bookmark a tweet.',
    inputSchema: {
      type: 'object',
      properties: {
        tweet_id: {
          type: 'string',
          description: 'The ID of the tweet to bookmark',
        },
      },
      required: ['tweet_id'],
    },
  },
  {
    name: 'unbookmark_tweet',
    description: 'Remove a bookmark from a tweet.',
    inputSchema: {
      type: 'object',
      properties: {
        tweet_id: {
          type: 'string',
          description: 'The ID of the tweet to unbookmark',
        },
      },
      required: ['tweet_id'],
    },
  },
  {
    name: 'retweet',
    description: 'Retweet a tweet.',
    inputSchema: {
      type: 'object',
      properties: {
        tweet_id: {
          type: 'string',
          description: 'The ID of the tweet to retweet',
        },
      },
      required: ['tweet_id'],
    },
  },
  {
    name: 'unretweet',
    description: 'Remove a retweet.',
    inputSchema: {
      type: 'object',
      properties: {
        tweet_id: {
          type: 'string',
          description: 'The ID of the tweet to unretweet',
        },
      },
      required: ['tweet_id'],
    },
  },

  // ============ FOLLOW OPERATIONS ============
  {
    name: 'follow_user',
    description: 'Follow a Twitter user.',
    inputSchema: {
      type: 'object',
      properties: {
        username: {
          type: 'string',
          description: 'Twitter username to follow (without @)',
        },
      },
      required: ['username'],
    },
  },
  {
    name: 'unfollow_user',
    description: 'Unfollow a Twitter user.',
    inputSchema: {
      type: 'object',
      properties: {
        username: {
          type: 'string',
          description: 'Twitter username to unfollow (without @)',
        },
      },
      required: ['username'],
    },
  },
];

/**
 * Tool handler implementations
 */
export const toolHandlers: Record<string, ToolHandler> = {
  // ============ READ OPERATIONS ============
  async get_tweet(client, args) {
    const tweetId = args.tweet_id as string;
    return client.getTweet(tweetId);
  },

  async get_thread(client, args) {
    const tweetId = args.tweet_id as string;
    const maxPages = (args.max_pages as number) || 3;
    return client.getThreadPaged(tweetId, { maxPages });
  },

  async get_replies(client, args) {
    const tweetId = args.tweet_id as string;
    const maxPages = (args.max_pages as number) || 3;
    return client.getRepliesPaged(tweetId, { maxPages });
  },

  // ============ SEARCH ============
  async search_tweets(client, args) {
    const query = args.query as string;
    const count = (args.count as number) || 20;
    return client.search(query, count);
  },

  // ============ TIMELINES ============
  async get_home_timeline(client, args) {
    const count = (args.count as number) || 20;
    return client.getHomeTimeline(count);
  },

  async get_following_timeline(client, args) {
    const count = (args.count as number) || 20;
    return client.getHomeLatestTimeline(count);
  },

  async get_user_tweets(client, args) {
    const username = args.username as string;
    const count = (args.count as number) || 20;

    // First lookup the user ID from username
    const userLookup = await client.getUserIdByUsername(username);
    if (!userLookup.success || !userLookup.userId) {
      return { success: false, error: userLookup.error || `User @${username} not found` };
    }

    return client.getUserTweets(userLookup.userId, count);
  },

  async get_mentions(client, args) {
    const username = args.username as string;
    const count = (args.count as number) || 20;
    const query = `@${username}`;
    return client.search(query, count);
  },

  // ============ BOOKMARKS ============
  async get_bookmarks(client, args) {
    const count = (args.count as number) || 20;
    return client.getBookmarks(count);
  },

  async get_likes(client, args) {
    const count = (args.count as number) || 20;
    return client.getLikes(count);
  },

  // ============ TRENDING & NEWS ============
  async get_trending(client, args) {
    const count = (args.count as number) || 10;
    return client.getNews(count, { tabs: ['trending'] });
  },

  async get_news(client, args) {
    const count = (args.count as number) || 10;
    return client.getNews(count, { aiOnly: true, tabs: ['forYou', 'news'] });
  },

  // ============ USER OPERATIONS ============
  async get_user_info(client, args) {
    const username = args.username as string;
    const result = await client.getUserIdByUsername(username);
    if (!result.success) {
      return result;
    }
    // Return all available info from the lookup
    return {
      success: true,
      user: {
        id: result.userId,
        username: result.username,
        name: result.name,
      },
    };
  },

  async get_followers(client, args) {
    const username = args.username as string;
    const count = (args.count as number) || 20;

    const userLookup = await client.getUserIdByUsername(username);
    if (!userLookup.success || !userLookup.userId) {
      return { success: false, error: userLookup.error || `User @${username} not found` };
    }

    return client.getFollowers(userLookup.userId, count);
  },

  async get_following(client, args) {
    const username = args.username as string;
    const count = (args.count as number) || 20;

    const userLookup = await client.getUserIdByUsername(username);
    if (!userLookup.success || !userLookup.userId) {
      return { success: false, error: userLookup.error || `User @${username} not found` };
    }

    return client.getFollowing(userLookup.userId, count);
  },

  async whoami(client) {
    return client.getCurrentUser();
  },

  // ============ LISTS ============
  async get_owned_lists(client) {
    return client.getOwnedLists();
  },

  async get_list_memberships(client) {
    return client.getListMemberships();
  },

  async get_list_timeline(client, args) {
    const listId = args.list_id as string;
    const count = (args.count as number) || 20;
    return client.getListTimeline(listId, count);
  },

  // ============ WRITE OPERATIONS ============
  async post_tweet(client, args) {
    const text = args.text as string;
    return client.tweet(text);
  },

  async reply_to_tweet(client, args) {
    const tweetId = args.tweet_id as string;
    const text = args.text as string;
    // Note: reply signature is (text, replyToTweetId, mediaIds?)
    return client.reply(text, tweetId);
  },

  // ============ ENGAGEMENT ============
  async like_tweet(client, args) {
    const tweetId = args.tweet_id as string;
    return client.like(tweetId);
  },

  async unlike_tweet(client, args) {
    const tweetId = args.tweet_id as string;
    return client.unlike(tweetId);
  },

  async bookmark_tweet(client, args) {
    const tweetId = args.tweet_id as string;
    return client.bookmark(tweetId);
  },

  async unbookmark_tweet(client, args) {
    const tweetId = args.tweet_id as string;
    return client.unbookmark(tweetId);
  },

  async retweet(client, args) {
    const tweetId = args.tweet_id as string;
    return client.retweet(tweetId);
  },

  async unretweet(client, args) {
    const tweetId = args.tweet_id as string;
    return client.unretweet(tweetId);
  },

  // ============ FOLLOW OPERATIONS ============
  async follow_user(client, args) {
    const username = args.username as string;

    // First lookup the user ID from username
    const userLookup = await client.getUserIdByUsername(username);
    if (!userLookup.success || !userLookup.userId) {
      return { success: false, error: userLookup.error || `User @${username} not found` };
    }

    return client.follow(userLookup.userId);
  },

  async unfollow_user(client, args) {
    const username = args.username as string;

    // First lookup the user ID from username
    const userLookup = await client.getUserIdByUsername(username);
    if (!userLookup.success || !userLookup.userId) {
      return { success: false, error: userLookup.error || `User @${username} not found` };
    }

    return client.unfollow(userLookup.userId);
  },
};
