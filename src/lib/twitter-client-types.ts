import type { TwitterCookies } from './cookies.js';

// Raw media entity from Twitter API
export interface GraphqlMediaEntity {
  id_str?: string;
  media_url_https?: string;
  type?: 'photo' | 'video' | 'animated_gif';
  url?: string;
  expanded_url?: string;
  sizes?: {
    thumb?: { w: number; h: number; resize: string };
    small?: { w: number; h: number; resize: string };
    medium?: { w: number; h: number; resize: string };
    large?: { w: number; h: number; resize: string };
  };
  video_info?: {
    duration_millis?: number;
    variants?: Array<{
      bitrate?: number;
      content_type?: string;
      url?: string;
    }>;
  };
}

export type GraphqlTweetResult = {
  __typename?: string;
  rest_id?: string;
  legacy?: {
    full_text?: string;
    created_at?: string;
    reply_count?: number;
    retweet_count?: number;
    favorite_count?: number;
    conversation_id_str?: string;
    in_reply_to_status_id_str?: string | null;
    entities?: {
      media?: GraphqlMediaEntity[];
    };
    extended_entities?: {
      media?: GraphqlMediaEntity[];
    };
  };
  core?: {
    user_results?: {
      result?: {
        rest_id?: string;
        id?: string;
        legacy?: {
          screen_name?: string;
          name?: string;
        };
        core?: {
          screen_name?: string;
          name?: string;
        };
      };
    };
  };
  note_tweet?: {
    note_tweet_results?: {
      result?: {
        text?: string;
        richtext?: {
          text?: string;
        };
        rich_text?: {
          text?: string;
        };
        content?: {
          text?: string;
          richtext?: {
            text?: string;
          };
          rich_text?: {
            text?: string;
          };
        };
      };
    };
  };
  article?: {
    article_results?: {
      result?: {
        title?: string;
        plain_text?: string;
        text?: string;
        richtext?: {
          text?: string;
        };
        rich_text?: {
          text?: string;
        };
        body?: {
          text?: string;
          richtext?: {
            text?: string;
          };
          rich_text?: {
            text?: string;
          };
        };
        content?: {
          text?: string;
          richtext?: {
            text?: string;
          };
          rich_text?: {
            text?: string;
          };
          items?: Array<{
            text?: string;
            content?: {
              text?: string;
              richtext?: { text?: string };
              rich_text?: { text?: string };
            };
          }>;
        };
        sections?: Array<{
          items?: Array<{
            text?: string;
            content?: {
              text?: string;
              richtext?: { text?: string };
              rich_text?: { text?: string };
            };
          }>;
        }>;
      };
    };
    title?: string;
    plain_text?: string;
    text?: string;
    richtext?: {
      text?: string;
    };
    rich_text?: {
      text?: string;
    };
    body?: {
      text?: string;
      richtext?: {
        text?: string;
      };
      rich_text?: {
        text?: string;
      };
    };
    content?: {
      text?: string;
      richtext?: {
        text?: string;
      };
      rich_text?: {
        text?: string;
      };
      items?: Array<{
        text?: string;
        content?: {
          text?: string;
          richtext?: { text?: string };
          rich_text?: { text?: string };
        };
      }>;
    };
    sections?: Array<{
      items?: Array<{
        text?: string;
        content?: {
          text?: string;
          richtext?: { text?: string };
          rich_text?: { text?: string };
        };
      }>;
    }>;
  };
  tweet?: GraphqlTweetResult;
  quoted_status_result?: {
    result?: GraphqlTweetResult;
  };
};

export type TweetResult =
  | {
      success: true;
      tweetId: string;
    }
  | {
      success: false;
      error: string;
    };

export type BookmarkMutationResult =
  | {
      success: true;
    }
  | {
      success: false;
      error: string;
    };

export interface UploadMediaResult {
  success: boolean;
  mediaId?: string;
  error?: string;
}

// Parsed media item for output
export interface TweetMedia {
  type: 'photo' | 'video' | 'animated_gif';
  url: string;
  previewUrl?: string;
  width?: number;
  height?: number;
  // For video/animated_gif: best quality video URL
  videoUrl?: string;
  durationMs?: number;
}

export interface TweetData {
  id: string;
  text: string;
  author: {
    username: string;
    name: string;
  };
  authorId?: string;
  createdAt?: string;
  replyCount?: number;
  retweetCount?: number;
  likeCount?: number;
  conversationId?: string;
  inReplyToStatusId?: string;
  // Optional quoted tweet; depth controlled by quoteDepth (default: 1).
  quotedTweet?: TweetData;
  // Media attachments (photos, videos, GIFs)
  media?: TweetMedia[];
  // Raw GraphQL tweet result (only when includeRaw is enabled)
  _raw?: GraphqlTweetResult;
}

export interface GetTweetResult {
  success: boolean;
  tweet?: TweetData;
  error?: string;
}

export interface SearchResult {
  success: boolean;
  tweets?: TweetData[];
  error?: string;
  /** Cursor for fetching the next page of results */
  nextCursor?: string;
}

export interface CurrentUserResult {
  success: boolean;
  user?: {
    id: string;
    username: string;
    name: string;
  };
  error?: string;
}

export interface TwitterUser {
  id: string;
  username: string;
  name: string;
  description?: string;
  followersCount?: number;
  followingCount?: number;
  isBlueVerified?: boolean;
  profileImageUrl?: string;
  createdAt?: string;
}

export interface FollowingResult {
  success: boolean;
  users?: TwitterUser[];
  error?: string;
  /** Cursor for fetching the next page of results */
  nextCursor?: string;
}

export interface TwitterClientOptions {
  cookies: TwitterCookies;
  userAgent?: string;
  timeoutMs?: number;
  // Max depth for quoted tweets (0 disables). Defaults to 1.
  quoteDepth?: number;
}

export interface TwitterList {
  id: string;
  name: string;
  description?: string;
  memberCount?: number;
  subscriberCount?: number;
  isPrivate?: boolean;
  createdAt?: string;
  owner?: {
    id: string;
    username: string;
    name: string;
  };
}

export interface ListsResult {
  success: boolean;
  lists?: TwitterList[];
  error?: string;
}

export interface CreateTweetResponse {
  data?: {
    create_tweet?: {
      tweet_results?: {
        result?: {
          rest_id?: string;
          legacy?: {
            full_text?: string;
          };
        };
      };
    };
  };
  errors?: Array<{ message: string; code?: number }>;
}
