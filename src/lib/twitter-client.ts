import type { AbstractConstructor } from './twitter-client-base.js';
import { TwitterClientBase } from './twitter-client-base.js';
import { type TwitterClientBookmarkMethods, withBookmarks } from './twitter-client-bookmarks.js';
import { type TwitterClientHomeMethods, withHome } from './twitter-client-home.js';
import { type TwitterClientListMethods, withLists } from './twitter-client-lists.js';
import { type TwitterClientMediaMethods, withMedia } from './twitter-client-media.js';
import { type TwitterClientPostingMethods, withPosting } from './twitter-client-posting.js';
import { type TwitterClientSearchMethods, withSearch } from './twitter-client-search.js';
import { type TwitterClientTimelineMethods, withTimelines } from './twitter-client-timelines.js';
import { type TwitterClientTweetDetailMethods, withTweetDetails } from './twitter-client-tweet-detail.js';
import { type TwitterClientUserMethods, withUsers } from './twitter-client-users.js';

type TwitterClientInstance = TwitterClientBase &
  TwitterClientBookmarkMethods &
  TwitterClientHomeMethods &
  TwitterClientListMethods &
  TwitterClientMediaMethods &
  TwitterClientPostingMethods &
  TwitterClientSearchMethods &
  TwitterClientTimelineMethods &
  TwitterClientTweetDetailMethods &
  TwitterClientUserMethods;

const MixedTwitterClient = withUsers(
  withLists(
    withHome(withTimelines(withSearch(withTweetDetails(withPosting(withBookmarks(withMedia(TwitterClientBase))))))),
  ),
) as AbstractConstructor<TwitterClientInstance>;

export class TwitterClient extends MixedTwitterClient {}

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
