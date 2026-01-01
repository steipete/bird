import type { AbstractConstructor } from './twitter-client-base.js';
import { TwitterClientBase } from './twitter-client-base.js';
import { type TwitterClientMediaMethods, withMedia } from './twitter-client-media.js';
import { type TwitterClientPostingMethods, withPosting } from './twitter-client-posting.js';
import { type TwitterClientSearchMethods, withSearch } from './twitter-client-search.js';
import { type TwitterClientTimelineMethods, withTimelines } from './twitter-client-timelines.js';
import { type TwitterClientTweetDetailMethods, withTweetDetails } from './twitter-client-tweet-detail.js';
import { type TwitterClientUserMethods, withUsers } from './twitter-client-users.js';

type TwitterClientInstance = TwitterClientBase &
  TwitterClientMediaMethods &
  TwitterClientPostingMethods &
  TwitterClientSearchMethods &
  TwitterClientTimelineMethods &
  TwitterClientTweetDetailMethods &
  TwitterClientUserMethods;

const MixedTwitterClient = withUsers(
  withTimelines(withSearch(withTweetDetails(withPosting(withMedia(TwitterClientBase))))),
) as AbstractConstructor<TwitterClientInstance>;

export class TwitterClient extends MixedTwitterClient {}

export type {
  BookmarksResult,
  CurrentUserResult,
  FollowingResult,
  GetTweetResult,
  LikesResult,
  SearchResult,
  TweetData,
  TweetResult,
  TwitterClientOptions,
  TwitterUser,
  UploadMediaResult,
} from './twitter-client-types.js';
