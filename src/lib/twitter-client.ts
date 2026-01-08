import type { AbstractConstructor } from './twitter-client-base.js';
import { TwitterClientBase } from './twitter-client-base.js';
import { type TwitterClientBookmarkMethods, withBookmarks } from './twitter-client-bookmarks.js';
import { type TwitterClientHomeMethods, withHome } from './twitter-client-home.js';
import { type TwitterClientListMethods, withLists } from './twitter-client-lists.js';
import { type TwitterClientMediaMethods, withMedia } from './twitter-client-media.js';
import { type TwitterClientNewsMethods, withNews } from './twitter-client-news.js';
import { type TwitterClientPostingMethods, withPosting } from './twitter-client-posting.js';
import { type TwitterClientSearchMethods, withSearch } from './twitter-client-search.js';
import { type TwitterClientTimelineMethods, withTimelines } from './twitter-client-timelines.js';
import { type TwitterClientTweetDetailMethods, withTweetDetails } from './twitter-client-tweet-detail.js';
import { type TwitterClientUserLookupMethods, withUserLookup } from './twitter-client-user-lookup.js';
import { type TwitterClientUserTweetsMethods, withUserTweets } from './twitter-client-user-tweets.js';
import { type TwitterClientUserMethods, withUsers } from './twitter-client-users.js';

type TwitterClientInstance = TwitterClientBase &
  TwitterClientBookmarkMethods &
  TwitterClientHomeMethods &
  TwitterClientListMethods &
  TwitterClientMediaMethods &
  TwitterClientNewsMethods &
  TwitterClientPostingMethods &
  TwitterClientSearchMethods &
  TwitterClientTimelineMethods &
  TwitterClientTweetDetailMethods &
  TwitterClientUserMethods &
  TwitterClientUserLookupMethods &
  TwitterClientUserTweetsMethods;

// News mixin wraps search because it depends on the search() method
const MixedTwitterClient = withNews(
  withUserTweets(
    withUserLookup(
      withUsers(
        withLists(
          withHome(
            withTimelines(withSearch(withTweetDetails(withPosting(withBookmarks(withMedia(TwitterClientBase)))))),
          ),
        ),
      ),
    ),
  ),
) as AbstractConstructor<TwitterClientInstance>;

export class TwitterClient extends MixedTwitterClient {}

export type { NewsFetchOptions, NewsItem, NewsResult } from './twitter-client-news.js';
export type {
  BookmarkMutationResult,
  CurrentUserResult,
  FollowingResult,
  GetTweetResult,
  ListsResult,
  SearchResult,
  TweetData,
  TweetResult,
  TwitterClientOptions,
  TwitterList,
  TwitterUser,
  UploadMediaResult,
} from './twitter-client-types.js';
