import type { GraphqlTweetResult, TweetData, TweetMedia, TwitterUser } from './twitter-client-types.js';

export function normalizeQuoteDepth(value?: number): number {
  if (value === undefined || value === null) {
    return 1;
  }
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(0, Math.floor(value));
}

export function firstText(...values: Array<string | undefined | null>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }
  return undefined;
}

export function collectTextFields(value: unknown, keys: Set<string>, output: string[]): void {
  if (!value) {
    return;
  }
  if (typeof value === 'string') {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectTextFields(item, keys, output);
    }
    return;
  }

  if (typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (keys.has(key)) {
        if (typeof nested === 'string') {
          const trimmed = nested.trim();
          if (trimmed) {
            output.push(trimmed);
          }
          continue;
        }
      }
      collectTextFields(nested, keys, output);
    }
  }
}

export function uniqueOrdered(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function extractArticleText(result: GraphqlTweetResult | undefined): string | undefined {
  const article = result?.article;
  if (!article) {
    return undefined;
  }

  const articleResult = article.article_results?.result ?? article;
  if (process.env.BIRD_DEBUG_ARTICLE === '1') {
    console.error(
      '[bird][debug][article] payload:',
      JSON.stringify(
        {
          rest_id: result?.rest_id,
          article: articleResult,
          note_tweet: result?.note_tweet?.note_tweet_results?.result ?? null,
        },
        null,
        2,
      ),
    );
  }
  const title = firstText(articleResult.title, article.title);
  let body = firstText(
    articleResult.plain_text,
    article.plain_text,
    articleResult.body?.text,
    articleResult.body?.richtext?.text,
    articleResult.body?.rich_text?.text,
    articleResult.content?.text,
    articleResult.content?.richtext?.text,
    articleResult.content?.rich_text?.text,
    articleResult.text,
    articleResult.richtext?.text,
    articleResult.rich_text?.text,
    article.body?.text,
    article.body?.richtext?.text,
    article.body?.rich_text?.text,
    article.content?.text,
    article.content?.richtext?.text,
    article.content?.rich_text?.text,
    article.text,
    article.richtext?.text,
    article.rich_text?.text,
  );

  if (body && title && body.trim() === title.trim()) {
    body = undefined;
  }

  if (!body) {
    const collected: string[] = [];
    collectTextFields(articleResult, new Set(['text', 'title']), collected);
    collectTextFields(article, new Set(['text', 'title']), collected);
    const unique = uniqueOrdered(collected);
    const filtered = title ? unique.filter((value) => value !== title) : unique;
    if (filtered.length > 0) {
      body = filtered.join('\n\n');
    }
  }

  if (title && body && !body.startsWith(title)) {
    return `${title}\n\n${body}`;
  }

  return body ?? title;
}

export function extractNoteTweetText(result: GraphqlTweetResult | undefined): string | undefined {
  const note = result?.note_tweet?.note_tweet_results?.result;
  if (!note) {
    return undefined;
  }

  return firstText(
    note.text,
    note.richtext?.text,
    note.rich_text?.text,
    note.content?.text,
    note.content?.richtext?.text,
    note.content?.rich_text?.text,
  );
}

export function extractTweetText(result: GraphqlTweetResult | undefined): string | undefined {
  return extractArticleText(result) ?? extractNoteTweetText(result) ?? firstText(result?.legacy?.full_text);
}

export function extractArticleMetadata(
  result: GraphqlTweetResult | undefined,
): { title: string; previewText?: string } | undefined {
  const article = result?.article;
  if (!article) {
    return undefined;
  }

  const articleResult = article.article_results?.result ?? article;
  const title = firstText(articleResult.title, article.title);
  if (!title) {
    return undefined;
  }

  // preview_text is available in home timeline responses
  const previewText = firstText(articleResult.preview_text, article.preview_text);

  return { title, previewText };
}

export function extractMedia(result: GraphqlTweetResult | undefined): TweetMedia[] | undefined {
  // Prefer extended_entities (has video info), fall back to entities
  const rawMedia = result?.legacy?.extended_entities?.media ?? result?.legacy?.entities?.media;
  if (!rawMedia || rawMedia.length === 0) {
    return undefined;
  }

  const media: TweetMedia[] = [];

  for (const item of rawMedia) {
    if (!item.type || !item.media_url_https) {
      continue;
    }

    const mediaItem: TweetMedia = {
      type: item.type,
      url: item.media_url_https,
    };

    // Get dimensions from largest available size
    const sizes = item.sizes;
    if (sizes?.large) {
      mediaItem.width = sizes.large.w;
      mediaItem.height = sizes.large.h;
    } else if (sizes?.medium) {
      mediaItem.width = sizes.medium.w;
      mediaItem.height = sizes.medium.h;
    }

    // For thumbnails/previews
    if (sizes?.small) {
      mediaItem.previewUrl = `${item.media_url_https}:small`;
    }

    // Extract video URL for video/animated_gif
    if ((item.type === 'video' || item.type === 'animated_gif') && item.video_info?.variants) {
      // Prefer highest bitrate MP4, fall back to first MP4 when bitrate is missing.
      const mp4Variants = item.video_info.variants.filter(
        (v): v is { bitrate?: number; content_type: string; url: string } =>
          v.content_type === 'video/mp4' && typeof v.url === 'string',
      );
      const mp4WithBitrate = mp4Variants
        .filter((v): v is { bitrate: number; content_type: string; url: string } => typeof v.bitrate === 'number')
        .sort((a, b) => b.bitrate - a.bitrate);
      const selectedVariant = mp4WithBitrate[0] ?? mp4Variants[0];

      if (selectedVariant) {
        mediaItem.videoUrl = selectedVariant.url;
      }

      if (typeof item.video_info.duration_millis === 'number') {
        mediaItem.durationMs = item.video_info.duration_millis;
      }
    }

    media.push(mediaItem);
  }

  return media.length > 0 ? media : undefined;
}

export function unwrapTweetResult(result: GraphqlTweetResult | undefined): GraphqlTweetResult | undefined {
  if (!result) {
    return undefined;
  }
  if (result.tweet) {
    return result.tweet;
  }
  return result;
}

export interface MapTweetResultOptions {
  quoteDepth: number;
  includeRaw?: boolean;
}

export function mapTweetResult(
  result: GraphqlTweetResult | undefined,
  quoteDepthOrOptions: number | MapTweetResultOptions,
): TweetData | undefined {
  const options: MapTweetResultOptions =
    typeof quoteDepthOrOptions === 'number' ? { quoteDepth: quoteDepthOrOptions } : quoteDepthOrOptions;
  const { quoteDepth, includeRaw = false } = options;

  const userResult = result?.core?.user_results?.result;
  const userLegacy = userResult?.legacy;
  const userCore = userResult?.core;
  const username = userLegacy?.screen_name ?? userCore?.screen_name;
  const name = userLegacy?.name ?? userCore?.name ?? username;
  const userId = userResult?.rest_id;
  if (!result?.rest_id || !username) {
    return undefined;
  }

  const text = extractTweetText(result);
  if (!text) {
    return undefined;
  }

  let quotedTweet: TweetData | undefined;
  if (quoteDepth > 0) {
    const quotedResult = unwrapTweetResult(result.quoted_status_result?.result);
    if (quotedResult) {
      quotedTweet = mapTweetResult(quotedResult, { quoteDepth: quoteDepth - 1, includeRaw });
    }
  }

  const media = extractMedia(result);
  const article = extractArticleMetadata(result);

  const tweetData: TweetData = {
    id: result.rest_id,
    text,
    createdAt: result.legacy?.created_at,
    replyCount: result.legacy?.reply_count,
    retweetCount: result.legacy?.retweet_count,
    likeCount: result.legacy?.favorite_count,
    conversationId: result.legacy?.conversation_id_str,
    inReplyToStatusId: result.legacy?.in_reply_to_status_id_str ?? undefined,
    author: {
      username,
      name: name || username,
    },
    authorId: userId,
    quotedTweet,
    media,
    article,
  };

  if (includeRaw) {
    (tweetData as TweetData & { _raw: GraphqlTweetResult })._raw = result;
  }

  return tweetData;
}

export function findTweetInInstructions(
  instructions:
    | Array<{
        entries?: Array<{
          content?: {
            itemContent?: {
              tweet_results?: {
                result?: GraphqlTweetResult;
              };
            };
          };
        }>;
      }>
    | undefined,
  tweetId: string,
): GraphqlTweetResult | undefined {
  if (!instructions) {
    return undefined;
  }

  for (const instruction of instructions) {
    for (const entry of instruction.entries || []) {
      const result = entry.content?.itemContent?.tweet_results?.result;
      if (result?.rest_id === tweetId) {
        return result;
      }
    }
  }

  return undefined;
}

export function collectTweetResultsFromEntry(entry: {
  content?: {
    itemContent?: {
      tweet_results?: {
        result?: GraphqlTweetResult;
      };
    };
    item?: {
      itemContent?: {
        tweet_results?: {
          result?: GraphqlTweetResult;
        };
      };
    };
    items?: Array<{
      item?: {
        itemContent?: {
          tweet_results?: {
            result?: GraphqlTweetResult;
          };
        };
      };
      itemContent?: {
        tweet_results?: {
          result?: GraphqlTweetResult;
        };
      };
      content?: {
        itemContent?: {
          tweet_results?: {
            result?: GraphqlTweetResult;
          };
        };
      };
    }>;
  };
}): GraphqlTweetResult[] {
  const results: GraphqlTweetResult[] = [];
  const pushResult = (result?: GraphqlTweetResult) => {
    if (result?.rest_id) {
      results.push(result);
    }
  };

  const content = entry.content;
  pushResult(content?.itemContent?.tweet_results?.result);
  pushResult(content?.item?.itemContent?.tweet_results?.result);

  for (const item of content?.items ?? []) {
    pushResult(item?.item?.itemContent?.tweet_results?.result);
    pushResult(item?.itemContent?.tweet_results?.result);
    pushResult(item?.content?.itemContent?.tweet_results?.result);
  }

  return results;
}

export interface ParseTweetsOptions {
  quoteDepth: number;
  includeRaw?: boolean;
}

export function parseTweetsFromInstructions(
  instructions:
    | Array<{
        entries?: Array<{
          content?: {
            itemContent?: {
              tweet_results?: {
                result?: GraphqlTweetResult;
              };
            };
            item?: {
              itemContent?: {
                tweet_results?: {
                  result?: GraphqlTweetResult;
                };
              };
            };
            items?: Array<{
              item?: {
                itemContent?: {
                  tweet_results?: {
                    result?: GraphqlTweetResult;
                  };
                };
              };
              itemContent?: {
                tweet_results?: {
                  result?: GraphqlTweetResult;
                };
              };
              content?: {
                itemContent?: {
                  tweet_results?: {
                    result?: GraphqlTweetResult;
                  };
                };
              };
            }>;
          };
        }>;
      }>
    | undefined,
  quoteDepthOrOptions: number | ParseTweetsOptions,
): TweetData[] {
  const options: ParseTweetsOptions =
    typeof quoteDepthOrOptions === 'number' ? { quoteDepth: quoteDepthOrOptions } : quoteDepthOrOptions;
  const { quoteDepth, includeRaw = false } = options;

  const tweets: TweetData[] = [];
  const seen = new Set<string>();

  for (const instruction of instructions ?? []) {
    for (const entry of instruction.entries ?? []) {
      const results = collectTweetResultsFromEntry(entry);
      for (const result of results) {
        const mapped = mapTweetResult(result, { quoteDepth, includeRaw });
        if (!mapped || seen.has(mapped.id)) {
          continue;
        }
        seen.add(mapped.id);
        tweets.push(mapped);
      }
    }
  }

  return tweets;
}

export function extractCursorFromInstructions(
  instructions:
    | Array<{
        entries?: Array<{
          content?: unknown;
        }>;
      }>
    | undefined,
  cursorType = 'Bottom',
): string | undefined {
  for (const instruction of instructions ?? []) {
    for (const entry of instruction.entries ?? []) {
      const content = entry.content as { cursorType?: unknown; value?: unknown } | undefined;
      if (content?.cursorType === cursorType && typeof content.value === 'string' && content.value.length > 0) {
        return content.value;
      }
    }
  }
  return undefined;
}

export function parseUsersFromInstructions(
  instructions: Array<{ type?: string; entries?: Array<unknown> }> | undefined,
): TwitterUser[] {
  if (!instructions) {
    return [];
  }

  const users: TwitterUser[] = [];

  for (const instruction of instructions) {
    if (!instruction.entries) {
      continue;
    }

    for (const entry of instruction.entries) {
      const content = (entry as { content?: { itemContent?: { user_results?: { result?: unknown } } } })?.content;
      const rawUserResult = content?.itemContent?.user_results?.result as
        | {
            __typename?: string;
            rest_id?: string;
            is_blue_verified?: boolean;
            user?: unknown;
            legacy?: {
              screen_name?: string;
              name?: string;
              description?: string;
              followers_count?: number;
              friends_count?: number;
              profile_image_url_https?: string;
              created_at?: string;
            };
            core?: {
              screen_name?: string;
              name?: string;
              created_at?: string;
            };
            avatar?: {
              image_url?: string;
            };
          }
        | undefined;

      const userResult =
        rawUserResult?.__typename === 'UserWithVisibilityResults' && rawUserResult.user
          ? (rawUserResult.user as typeof rawUserResult)
          : rawUserResult;

      if (!userResult || userResult.__typename !== 'User') {
        continue;
      }

      const legacy = userResult.legacy;
      const core = userResult.core;
      const username = legacy?.screen_name ?? core?.screen_name;
      if (!userResult.rest_id || !username) {
        continue;
      }

      users.push({
        id: userResult.rest_id,
        username,
        name: legacy?.name ?? core?.name ?? username,
        description: legacy?.description,
        followersCount: legacy?.followers_count,
        followingCount: legacy?.friends_count,
        isBlueVerified: userResult.is_blue_verified,
        profileImageUrl: legacy?.profile_image_url_https ?? userResult.avatar?.image_url,
        createdAt: legacy?.created_at ?? core?.created_at,
      });
    }
  }

  return users;
}
