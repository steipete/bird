import type { AbstractConstructor, Mixin, TwitterClientBase } from './twitter-client-base.js';
import { TWITTER_API_BASE } from './twitter-client-constants.js';
import { buildExploreFeatures } from './twitter-client-features.js';
import type { SearchResult, TweetData } from './twitter-client-types.js';

const POST_COUNT_REGEX = /[\d.]+[KMB]?\s*posts?/i;
const POST_COUNT_MATCH_REGEX = /([\d.]+)([KMB]?)\s*posts?/i;

/** Options for news fetch methods */
export interface NewsFetchOptions {
  /** Include raw GraphQL response in `_raw` field */
  includeRaw?: boolean;
  /** Also fetch related tweets for each news item */
  withTweets?: boolean;
  /** Number of tweets to fetch per news item (default: 5) */
  tweetsPerItem?: number;
  /** Filter to show only AI-curated news items */
  aiOnly?: boolean;
}

export interface NewsItem {
  id: string;
  headline: string;
  category?: string;
  timeAgo?: string;
  postCount?: number;
  description?: string;
  url?: string;
  tweets?: TweetData[];
  // biome-ignore lint/suspicious/noExplicitAny: Raw API response can have any structure
  _raw?: any;
}

export type NewsResult =
  | {
      success: true;
      items: NewsItem[];
    }
  | {
      success: false;
      error: string;
    };

export interface TwitterClientNewsMethods {
  getNews(count?: number, options?: NewsFetchOptions): Promise<NewsResult>;
}

export function withNews<TBase extends AbstractConstructor<TwitterClientBase>>(
  Base: TBase,
): Mixin<TBase, TwitterClientNewsMethods> {
  abstract class TwitterClientNews extends Base {
    // biome-ignore lint/complexity/noUselessConstructor lint/suspicious/noExplicitAny: TS mixin constructor requirement.
    constructor(...args: any[]) {
      super(...args);
    }

    /**
     * Fetch news and trending topics from Twitter's Explore page
     */
    async getNews(count = 10, options: NewsFetchOptions = {}): Promise<NewsResult> {
      const { includeRaw = false, withTweets = false, tweetsPerItem = 5, aiOnly = false } = options;

      const debug = process.env.BIRD_DEBUG === '1';

      // Try ExplorePage first - this has AI headlines in initialTimeline
      if (debug) {
        console.error('[getNews] Fetching from ExplorePage (has AI headlines)...');
      }
      const queryId = await this.getQueryId('ExplorePage');
      const features = buildExploreFeatures();

      const variables = {
        includePromotedContent: true,
        withBirdwatchNotes: false,
        withCommunity: true,
        withSuperFollowsUserFields: true,
        withDownvotePerspective: false,
        withReactionsMetadata: false,
        withReactionsPerspective: false,
        withSuperFollowsTweetFields: true,
      };

      const params = new URLSearchParams({
        variables: JSON.stringify(variables),
        features: JSON.stringify(features),
      });

      const url = `${TWITTER_API_BASE}/${queryId}/ExplorePage?${params.toString()}`;

      try {
        const response = await this.fetchWithTimeout(url, {
          method: 'GET',
          headers: this.getHeaders(),
        });

        if (!response.ok) {
          const text = await response.text();
          return { success: false, error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
        }

        const data = (await response.json()) as {
          // biome-ignore lint/suspicious/noExplicitAny: API response structure is complex
          data?: any;
          // biome-ignore lint/suspicious/noExplicitAny: API errors can have any structure
          errors?: Array<{ message: string; code?: number; [key: string]: any }>;
        };

        // Debug: save response if BIRD_DEBUG_JSON is set
        if (process.env.BIRD_DEBUG_JSON) {
          const fs = await import('node:fs/promises');
          const debugPath = process.env.BIRD_DEBUG_JSON.replace('.json', '-explorepage.json');
          await fs.writeFile(debugPath, JSON.stringify(data, null, 2)).catch(() => {});
          if (debug) {
            console.error(`[ExplorePage] Saved response to ${debugPath}`);
          }
        }

        if (data.errors && data.errors.length > 0) {
          return { success: false, error: data.errors.map((e) => e.message).join('; ') };
        }

        const items = this.parseNewsItems(data, count, aiOnly, includeRaw);

        if (items.length === 0) {
          return { success: false, error: 'No news items found' };
        }

        if (withTweets) {
          await this.enrichWithTweets(items, tweetsPerItem, includeRaw);
        }

        return { success: true, items };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, error: `Failed to fetch news: ${errorMessage}` };
      }
    }

    // biome-ignore lint/suspicious/noExplicitAny: API response structure is complex
    private parseNewsItems(data: any, maxCount: number, aiOnly: boolean, includeRaw: boolean): NewsItem[] {
      const allItems: NewsItem[] = [];
      const seenHeadlines = new Set<string>();
      const debug = process.env.BIRD_DEBUG === '1';

      if (debug) {
        console.error('[ExplorePage] Processing explore_page data...');
      }

      if (!data.data?.explore_page) {
        return [];
      }

      const explorePage = data.data.explore_page;

      if (debug) {
        console.error('[ExplorePage] Available sections:', Object.keys(explorePage.body || {}));
      }

      const body = explorePage.body || {};

      // Check the timelines array first (For You, News tabs, etc.)
      // biome-ignore lint/suspicious/noExplicitAny: exploring API structure
      const timelines = (body as any).timelines || [];
      if (debug) {
        console.error(`[ExplorePage] Found ${timelines.length} timelines`);
      }

      for (const timelineObj of timelines) {
        if (debug) {
          console.error(`[ExplorePage] Timeline ID: ${timelineObj.id}, Label: ${timelineObj.labelText}`);
          console.error(`[ExplorePage] Timeline keys:`, Object.keys(timelineObj));
        }

        const timeline = timelineObj.timeline;
        if (timeline) {
          const instructions = timeline.timeline?.instructions ?? timeline.instructions ?? [];

          if (debug) {
            console.error(`[ExplorePage] Timeline ${timelineObj.labelText} has ${instructions.length} instructions`);
          }

          const itemsFromTimeline = this.extractNewsItemsFromInstructions(
            instructions,
            timelineObj.__typename || 'timeline',
            seenHeadlines,
            maxCount,
            aiOnly,
            includeRaw,
          );

          if (debug) {
            console.error(`[ExplorePage] Timeline found ${itemsFromTimeline.length} AI news items`);
          }

          allItems.push(...itemsFromTimeline);

          if (allItems.length >= maxCount) {
            break;
          }
        }
      }

      // Also check initialTimeline as fallback
      if (allItems.length < maxCount && body.initialTimeline) {
        const timeline = body.initialTimeline.timeline;
        if (timeline) {
          const instructions = timeline.timeline?.instructions ?? [];

          const itemsFromInitial = this.extractNewsItemsFromInstructions(
            instructions,
            'initialTimeline',
            seenHeadlines,
            maxCount - allItems.length,
            aiOnly,
            includeRaw,
          );

          allItems.push(...itemsFromInitial);
        }
      }

      return allItems;
    }

    private extractNewsItemsFromInstructions(
      // biome-ignore lint/suspicious/noExplicitAny: API response structure is complex
      instructions: any[],
      source: string,
      seenHeadlines: Set<string>,
      maxCount: number,
      aiOnly: boolean,
      includeRaw: boolean,
    ): NewsItem[] {
      const items: NewsItem[] = [];
      const debug = process.env.BIRD_DEBUG === '1';

      for (const instruction of instructions) {
        if (instruction.type !== 'TimelineAddEntries') {
          continue;
        }

        const entries = instruction.entries ?? [];

        if (debug) {
          console.error(`[${source}] Processing ${entries.length} entries`);
        }

        for (const entry of entries) {
          if (items.length >= maxCount) {
            break;
          }

          if (debug) {
            console.error(
              `[${source}] Entry ID: ${entry.entryId}, content type: ${entry.content?.__typename || entry.content?.entryType || 'unknown'}`,
            );

            // Check if this is a "Today's News" or news section header
            if (entry.content?.header || entry.content?.displayType === 'VerticalConversation') {
              console.error(`[${source}] Found potential news section:`, entry.content?.header);
            }
          }

          const content = entry.content;
          if (!content) {
            continue;
          }

          // Handle TimelineTimelineItem (single trend item)
          if (content.itemContent && items.length < maxCount) {
            if (debug && content.itemContent.is_ai_trend) {
              console.error(
                `[ExplorePage] Found AI trend in ${entry.entryId}:`,
                JSON.stringify(content.itemContent, null, 2).substring(0, 500),
              );
            }

            const newsItem = this.parseNewsItemFromContent(
              content.itemContent,
              entry.entryId,
              source,
              seenHeadlines,
              aiOnly,
              includeRaw,
            );

            if (newsItem) {
              items.push(newsItem);
            }
          }

          // Handle TimelineTimelineModule (multiple items)
          const itemsArray = content?.items ?? [];

          if (debug && itemsArray.length > 0) {
            console.error(`[${source}] Module has ${itemsArray.length} items`);
          }

          for (const data of itemsArray) {
            if (items.length >= maxCount) {
              break;
            }

            // Structure can be data.itemContent OR data.item.itemContent
            const itemContent = data?.itemContent || data?.item?.itemContent;
            if (!itemContent) {
              continue;
            }

            if (debug) {
              console.error(
                `[${source}] Module item type: ${itemContent.__typename}, name: ${itemContent.name}, is_ai: ${itemContent.is_ai_trend}`,
              );
            }

            if (debug && itemContent.is_ai_trend) {
              console.error(
                `[ExplorePage] Found AI trend in module ${entry.entryId}:`,
                JSON.stringify(itemContent, null, 2).substring(0, 500),
              );
            }

            const newsItem = this.parseNewsItemFromContent(
              itemContent,
              entry.entryId,
              source,
              seenHeadlines,
              aiOnly,
              includeRaw,
            );

            if (newsItem) {
              items.push(newsItem);
            }
          }
        }
      }

      return items;
    }

    private parseNewsItemFromContent(
      // biome-ignore lint/suspicious/noExplicitAny: API response structure is complex
      itemContent: any,
      entryId: string,
      source: string,
      seenHeadlines: Set<string>,
      aiOnly: boolean,
      includeRaw: boolean,
    ): NewsItem | null {
      const headline = itemContent.name || itemContent.title;

      if (!headline) {
        return null;
      }

      // Detect AI news by characteristics:
      // 1. Full sentence headlines (contains spaces and is longer)
      // 2. Has social_context with "News" category
      // 3. Or explicitly marked as is_ai_trend
      const socialContext = itemContent?.social_context?.text || '';
      const hasNewsCategory = socialContext.includes('News') || socialContext.includes('hours ago');
      const isFullSentence = headline.split(' ').length >= 5; // AI news are full sentences
      const isExplicitlyAiTrend = itemContent.is_ai_trend === true;

      const isAiNews = isExplicitlyAiTrend || (isFullSentence && hasNewsCategory);

      // Filter AI trends if aiOnly is enabled
      if (aiOnly && !isAiNews) {
        return null;
      }

      if (seenHeadlines.has(headline)) {
        return null;
      }

      seenHeadlines.add(headline);

      let postCount: number | undefined;
      let timeAgo: string | undefined;
      let category = 'Trending';

      // Parse social context for metadata
      const socialCtx = itemContent?.social_context;
      if (socialCtx?.text) {
        const socialContextText = socialCtx.text;
        const parts = socialContextText.split('·').map((s: string) => s.trim());

        for (const part of parts) {
          if (part.includes('ago')) {
            timeAgo = part;
          } else if (part.match(POST_COUNT_REGEX)) {
            const match = part.match(POST_COUNT_MATCH_REGEX);
            if (match) {
              let num = Number.parseFloat(match[1]);
              const suffix = match[2]?.toUpperCase();

              if (suffix === 'K') {
                num *= 1000;
              } else if (suffix === 'M') {
                num *= 1_000_000;
              } else if (suffix === 'B') {
                num *= 1_000_000_000;
              }

              postCount = Math.round(num);
            }
          } else {
            category = part;
          }
        }
      }

      // Parse trend metadata
      const trendMetadata = itemContent?.trend_metadata;
      if (trendMetadata?.meta_description) {
        const metaDesc = trendMetadata.meta_description;
        const postMatch = metaDesc.match(POST_COUNT_MATCH_REGEX);
        if (postMatch) {
          let num = Number.parseFloat(postMatch[1]);
          const suffix = postMatch[2]?.toUpperCase();

          if (suffix === 'K') {
            num *= 1000;
          } else if (suffix === 'M') {
            num *= 1_000_000;
          } else if (suffix === 'B') {
            num *= 1_000_000_000;
          }

          postCount = Math.round(num);
        }
      }

      if (trendMetadata?.domain_context && (category === 'Trending' || category === 'News')) {
        category = trendMetadata.domain_context;
      }

      const item: NewsItem = {
        id: entryId || `${source}-${headline}`,
        headline,
        category: isAiNews ? `AI · ${category}` : category,
        timeAgo,
        postCount,
        description: itemContent.description,
        url: itemContent.trend_url?.url || trendMetadata?.url?.url,
      };

      if (includeRaw) {
        item._raw = itemContent;
      }

      return item;
    }

    private async enrichWithTweets(items: NewsItem[], tweetsPerItem: number, includeRaw: boolean): Promise<void> {
      const debug = process.env.BIRD_DEBUG === '1';

      for (const item of items) {
        try {
          const searchQuery = item.headline;
          if (!searchQuery) {
            continue;
          }

          // Use the search method if available (requires search mixin)
          if ('search' in this && typeof (this as { search?: unknown }).search === 'function') {
            const result = (await (
              this as { search: (q: string, c: number, o: { includeRaw: boolean }) => Promise<SearchResult> }
            ).search(searchQuery, tweetsPerItem, { includeRaw })) as SearchResult;

            if (result.success && result.tweets) {
              item.tweets = result.tweets;
            }
          }
        } catch {
          if (debug) {
            console.error('[getNews] Failed to enrich item with tweets:', item.headline);
          }
        }
      }
    }
  }

  return TwitterClientNews;
}
