import type { AbstractConstructor, Mixin, TwitterClientBase } from './twitter-client-base.js';
import { TWITTER_API_BASE } from './twitter-client-constants.js';
import { buildExploreFeatures } from './twitter-client-features.js';
import type { SearchResult, TweetData } from './twitter-client-types.js';

const POST_COUNT_REGEX = /[\d.]+[KMB]?\s*posts?/i;
const POST_COUNT_MATCH_REGEX = /([\d.]+)([KMB]?)\s*posts?/i;

// Timeline IDs for different Explore tabs
const TIMELINE_IDS = {
  forYou: 'VGltZWxpbmU6DAC2CwABAAAAB2Zvcl95b3UAAA==',
  trending: 'VGltZWxpbmU6DAC2CwABAAAACHRyZW5kaW5nAAA=',
  news: 'VGltZWxpbmU6DAC2CwABAAAABG5ld3MAAA==',
  sports: 'VGltZWxpbmU6DAC2CwABAAAABnNwb3J0cwAA',
  entertainment: 'VGltZWxpbmU6DAC2CwABAAAADWVudGVydGFpbm1lbnQAAA==',
} as const;

export type ExploreTab = keyof typeof TIMELINE_IDS;

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
  /** Fetch from specific tabs only (default: all tabs) */
  tabs?: ExploreTab[];
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
     * Fetch news and trending topics from Twitter's Explore page tabs
     */
    async getNews(count = 10, options: NewsFetchOptions = {}): Promise<NewsResult> {
      const {
        includeRaw = false,
        withTweets = false,
        tweetsPerItem = 5,
        aiOnly = false,
        tabs = ['forYou', 'news', 'sports', 'entertainment'],
      } = options;

      const debug = process.env.BIRD_DEBUG === '1';

      if (debug) {
        console.error(`[getNews] Fetching from tabs: ${tabs.join(', ')}`);
      }

      const allItems: NewsItem[] = [];
      const seenHeadlines = new Set<string>();

      // Fetch from each tab
      for (const tab of tabs) {
        const timelineId = TIMELINE_IDS[tab];
        if (!timelineId) {
          continue;
        }

        try {
          const tabItems = await this.fetchTimelineTab(tab, timelineId, count, aiOnly, includeRaw, debug);

          // Deduplicate across tabs
          for (const item of tabItems) {
            if (!seenHeadlines.has(item.headline)) {
              seenHeadlines.add(item.headline);
              allItems.push(item);
            }
          }

          if (debug) {
            console.error(
              `[getNews] Tab ${tab}: found ${tabItems.length} items, total unique: ${allItems.length}`,
            );
          }

          // Stop early if we have enough
          if (allItems.length >= count) {
            break;
          }
        } catch (error) {
          if (debug) {
            console.error(`[getNews] Error fetching tab ${tab}:`, error);
          }
          // Continue with other tabs
        }
      }

      if (allItems.length === 0) {
        return { success: false, error: 'No news items found' };
      }

      // Limit to requested count
      const items = allItems.slice(0, count);

      if (withTweets) {
        await this.enrichWithTweets(items, tweetsPerItem, includeRaw);
      }

      return { success: true, items };
    }

    /**
     * Fetch a specific timeline tab using GenericTimelineById
     */
    private async fetchTimelineTab(
      tabName: string,
      timelineId: string,
      maxCount: number,
      aiOnly: boolean,
      includeRaw: boolean,
      debug: boolean,
    ): Promise<NewsItem[]> {
      const queryId = await this.getQueryId('GenericTimelineById');
      const features = buildExploreFeatures();

      const variables = {
        timelineId: timelineId,
        count: maxCount * 2, // Fetch more to account for filtering
        includePromotedContent: false,
      };

      const params = new URLSearchParams({
        variables: JSON.stringify(variables),
        features: JSON.stringify(features),
      });

      const url = `${TWITTER_API_BASE}/${queryId}/GenericTimelineById?${params.toString()}`;

      const response = await this.fetchWithTimeout(url, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
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
        const debugPath = process.env.BIRD_DEBUG_JSON.replace('.json', `-${tabName}.json`);
        await fs.writeFile(debugPath, JSON.stringify(data, null, 2)).catch(() => {});
      }

      if (data.errors && data.errors.length > 0) {
        throw new Error(data.errors.map((e) => e.message).join('; '));
      }

      // Parse timeline response
      return this.parseTimelineTabItems(data, tabName, maxCount, aiOnly, includeRaw);
    }

    /**
     * Parse items from a GenericTimelineById response
     */
    private parseTimelineTabItems(
      // biome-ignore lint/suspicious/noExplicitAny: API response structure is complex
      data: any,
      source: string,
      maxCount: number,
      aiOnly: boolean,
      includeRaw: boolean,
    ): NewsItem[] {
      const items: NewsItem[] = [];
      const seenHeadlines = new Set<string>();

      // Navigate to timeline instructions
      const timeline = data?.data?.timeline?.timeline;
      if (!timeline) {
        return [];
      }

      const instructions = timeline.instructions || [];

      for (const instruction of instructions) {
        if (instruction.type !== 'TimelineAddEntries') {
          continue;
        }

        const entries = instruction.entries || [];

        for (const entry of entries) {
          if (items.length >= maxCount) {
            break;
          }

          const content = entry.content;
          if (!content) {
            continue;
          }

          // Handle TimelineTimelineItem (single trend item)
          if (content.itemContent) {
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
          const itemsArray = content?.items || [];

          for (const data of itemsArray) {
            if (items.length >= maxCount) {
              break;
            }

            // Structure can be data.itemContent OR data.item.itemContent
            const itemContent = data?.itemContent || data?.item?.itemContent;
            if (!itemContent) {
              continue;
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

    // biome-ignore lint/suspicious/noExplicitAny: API response structure is complex

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
