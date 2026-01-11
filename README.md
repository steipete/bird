# bird 🐦 — fast X CLI for tweeting, replying, and reading

`bird` is a fast X CLI for tweeting, replying, and reading via X/Twitter GraphQL (cookie auth).

## Disclaimer

This project uses X/Twitter’s **undocumented** web GraphQL API (and cookie auth). X can change endpoints, query IDs,
and anti-bot behavior at any time — **expect this to break without notice**.

## Install

```bash
npm install -g @steipete/bird
# or
pnpm add -g @steipete/bird
# or
bun add -g @steipete/bird

# one-shot (no install)
bunx @steipete/bird whoami
```

Homebrew (macOS, prebuilt Bun binary):

```bash
brew install steipete/tap/bird
```

## Quickstart

```bash
# Show the logged-in account
bird whoami

# Discover command help
bird help whoami

# Read a tweet (URL or ID)
bird read https://x.com/user/status/1234567890123456789
bird 1234567890123456789 --json

# Thread + replies
bird thread https://x.com/user/status/1234567890123456789
bird replies 1234567890123456789

# Search + mentions
bird search "from:steipete" -n 5
bird mentions -n 5
bird mentions --user @steipete -n 5

# Bookmarks
bird bookmarks -n 5
bird bookmarks --folder-id 123456789123456789 -n 5 # https://x.com/i/bookmarks/<folder-id>
bird bookmarks --all --json
bird bookmarks --all --max-pages 2 --json
bird unbookmark 1234567890123456789
bird unbookmark https://x.com/user/status/1234567890123456789

# Likes
bird likes -n 5

# News and trending topics (AI-curated from Explore tabs)
bird news --ai-only -n 10
bird news --sports -n 5

# Following (who you follow)
bird following -n 20
bird following --user 12345678 -n 10  # by user ID

# Followers (who follows you)
bird followers -n 20
bird followers --user 12345678 -n 10  # by user ID

# Refresh GraphQL query IDs cache (no rebuild)
bird query-ids --fresh
```

## News & Trending

Fetch AI-curated news and trending topics from X's Explore page tabs:

```bash
# Fetch 10 news items from all tabs (default: For You, News, Sports, Entertainment)
bird news -n 10

# Fetch only AI-curated news (filters out regular trends)
bird news --ai-only -n 20

# Fetch from specific tabs
bird news --news-only --ai-only -n 10
bird news --sports -n 15
bird news --entertainment --ai-only -n 5

# Include related tweets for each news item
bird news --with-tweets --tweets-per-item 3 -n 10

# Combine multiple tab filters
bird news --sports --entertainment -n 20

# JSON output
bird news --json -n 5
bird news --json-full --ai-only -n 10  # includes raw API response
```

Tab options (can be combined):
- `--for-you` — Fetch from For You tab only
- `--news-only` — Fetch from News tab only
- `--sports` — Fetch from Sports tab only
- `--entertainment` — Fetch from Entertainment tab only
- `--trending-only` — Fetch from Trending tab only

By default, the command fetches from For You, News, Sports, and Entertainment tabs (Trending excluded to reduce noise). Headlines are automatically deduplicated across tabs.

## Library

`bird` can be used as a library (same GraphQL client as the CLI):

```ts
import { TwitterClient, resolveCredentials } from '@steipete/bird';

const { cookies } = await resolveCredentials({ cookieSource: 'safari' });
const client = new TwitterClient({ cookies });

// Search for tweets
const searchResult = await client.search('from:steipete', 50);

// Fetch news and trending topics from all tabs (default: For You, News, Sports, Entertainment)
const newsResult = await client.getNews(10, { aiOnly: true });

// Fetch from specific tabs with related tweets
const sportsNews = await client.getNews(10, {
  aiOnly: true,
  withTweets: true,
  tabs: ['sports', 'entertainment']
});
```

## Commands

- `bird tweet "<text>"` — post a new tweet.
- `bird reply <tweet-id-or-url> "<text>"` — reply to a tweet using its ID or URL.
- `bird help [command]` — show help (or help for a subcommand).
- `bird query-ids [--fresh] [--json]` — inspect or refresh cached GraphQL query IDs.
- `bird read <tweet-id-or-url> [--json]` — fetch tweet content as text or JSON.
- `bird <tweet-id-or-url> [--json]` — shorthand for `read` when only a URL or ID is provided.
- `bird replies <tweet-id-or-url> [--json]` — list replies to a tweet.
- `bird thread <tweet-id-or-url> [--json]` — show the full conversation thread.
- `bird search "<query>" [-n count] [--json]` — search for tweets matching a query.
- `bird mentions [-n count] [--user @handle] [--json]` — find tweets mentioning a user (defaults to the authenticated user).
- `bird bookmarks [-n count] [--folder-id id] [--all] [--max-pages n] [--json]` — list your bookmarked tweets (or a specific bookmark folder); `--max-pages` requires `--all`.
- `bird unbookmark <tweet-id-or-url...>` — remove one or more bookmarks by tweet ID or URL.
 - `bird likes [-n count] [--json]` — list your liked tweets.
 - `bird news [-n count] [--ai-only] [--with-tweets] [--tweets-per-item n] [--for-you] [--news-only] [--sports] [--entertainment] [--trending-only] [--json]` — fetch news and trending topics from X's Explore tabs (fetches from For You, News, Sports, and Entertainment tabs by default).
 - `bird trending` — alias for `news` command.
 - `bird following [--user <userId>] [-n count] [--json]` — list users that you (or another user) follow.
 - `bird followers [--user <userId>] [-n count] [--json]` — list users that follow you (or another user).
 - `bird whoami` — print which Twitter account your cookies belong to.
 - `bird check` — show which credentials are available and where they were sourced from.

Global options:
- `--auth-token <token>`: set the `auth_token` cookie manually.
- `--ct0 <token>`: set the `ct0` cookie manually.
- `--cookie-source <safari|chrome|firefox>`: choose browser cookie source (repeatable; order matters).
- `--chrome-profile <name>`: Chrome profile for cookie extraction.
- `--firefox-profile <name>`: Firefox profile for cookie extraction.
- `--cookie-timeout <ms>`: cookie extraction timeout for keychain/OS helpers (milliseconds).
- `--timeout <ms>`: abort requests after the given timeout (milliseconds).
- `--quote-depth <n>`: max quoted tweet depth in JSON output (default: 1; 0 disables).
- `--plain`: stable output (no emoji, no color).
- `--no-emoji`: disable emoji output.
- `--no-color`: disable ANSI colors (or set `NO_COLOR=1`).
- `--media <path>`: attach media file (repeatable, up to 4 images or 1 video).
- `--alt <text>`: alt text for the corresponding `--media` (repeatable).

## Authentication (GraphQL)

GraphQL mode uses your existing X/Twitter web session (no password prompt). It sends requests to internal
X endpoints and authenticates via cookies (`auth_token`, `ct0`).

Write operations:
- `tweet`/`reply` primarily use GraphQL (`CreateTweet`).
- If GraphQL returns error `226` (“automated request”), `bird` falls back to the legacy `statuses/update.json` endpoint.

`bird` resolves credentials in this order:

1. CLI flags: `--auth-token`, `--ct0`
2. Environment variables: `AUTH_TOKEN`, `CT0` (fallback: `TWITTER_AUTH_TOKEN`, `TWITTER_CT0`)
3. Browser cookies via `@steipete/sweet-cookie` (override via `--cookie-source` order)

Browser cookie sources:
- Safari: `~/Library/Cookies/Cookies.binarycookies` (fallback: `~/Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies`)
- Chrome: `~/Library/Application Support/Google/Chrome/<Profile>/Cookies`
- Firefox: `~/Library/Application Support/Firefox/Profiles/<profile>/cookies.sqlite`

## Config (JSON5)

Config precedence: CLI flags > env vars > project config > global config.

- Global: `~/.config/bird/config.json5`
- Project: `./.birdrc.json5`

Example `~/.config/bird/config.json5`:

```json5
{
  // Cookie source order for browser extraction (string or array)
  cookieSource: ["firefox", "safari"],
  firefoxProfile: "default-release",
  cookieTimeoutMs: 30000,
  timeoutMs: 20000,
  quoteDepth: 1
}
```

Environment shortcuts:
- `BIRD_TIMEOUT_MS`
- `BIRD_COOKIE_TIMEOUT_MS`
- `BIRD_QUOTE_DEPTH`

## Output

- `--json` prints raw tweet objects for read/replies/thread/search/mentions/bookmarks/likes.
- `read` returns full text for Notes and Articles when present.
- Use `--plain` for stable, script-friendly output (no emoji, no color).

### JSON Schema

When using `--json`, tweet objects include:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Tweet ID |
| `text` | string | Full tweet text (includes Note/Article content when present) |
| `author` | object | `{ username, name }` |
| `authorId` | string? | Author's user ID |
| `createdAt` | string | Timestamp |
| `replyCount` | number | Number of replies |
| `retweetCount` | number | Number of retweets |
| `likeCount` | number | Number of likes |
| `conversationId` | string | Thread conversation ID |
| `inReplyToStatusId` | string? | Parent tweet ID (present if this is a reply) |
| `quotedTweet` | object? | Embedded quote tweet (same schema; depth controlled by `--quote-depth`) |

When using `--json` with `following`/`followers`, user objects include:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | User ID |
| `username` | string | Username/handle |
| `name` | string | Display name |
| `description` | string? | User bio |
| `followersCount` | number? | Followers count |
| `followingCount` | number? | Following count |
| `isBlueVerified` | boolean? | Blue verified flag |
 | `profileImageUrl` | string? | Profile image URL |
 | `createdAt` | string? | Account creation timestamp |

When using `--json` with `news`/`trending`, news objects include:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier for the news item |
| `headline` | string | News headline or trend title |
| `category` | string? | Category (e.g., "AI · Technology", "Trending", "News") |
| `timeAgo` | string? | Relative time (e.g., "2h ago") |
| `postCount` | number? | Number of posts |
| `description` | string? | Item description |
| `url` | string? | URL to the trend or news article |
| `tweets` | array? | Related tweets (only when `--with-tweets` is used) |
| `_raw` | object? | Raw API response (only when `--json-full` is used) |


## Query IDs (GraphQL)

X rotates GraphQL “query IDs” frequently. Each GraphQL operation is addressed as:

- `operationName` (e.g. `TweetDetail`, `CreateTweet`)
- `queryId` (rotating ID baked into X’s web client bundles)

`bird` ships with a baseline mapping in `src/lib/query-ids.json` (copied into `dist/` on build). At runtime,
it can refresh that mapping by scraping X’s public web client bundles and caching the result on disk.

Runtime cache:
- Default path: `~/.config/bird/query-ids-cache.json`
- Override path: `BIRD_QUERY_IDS_CACHE=/path/to/file.json`
- TTL: 24h (stale cache is still used, but marked “not fresh”)

Auto-recovery:
- On GraphQL `404` (query ID invalid), `bird` forces a refresh once and retries.
- For `TweetDetail`/`SearchTimeline`, `bird` also rotates through a small set of known fallback IDs to reduce
  breakage while refreshing.

Refresh on demand:

```bash
bird query-ids --fresh
```

Exit codes:
- `0`: success
- `1`: runtime error (network/auth/etc)
- `2`: invalid usage/validation (e.g. bad `--user` handle)

## Version

`bird --version` prints `package.json` version plus current git sha when available, e.g. `0.3.0 (3df7969b)`.

## Media uploads

- Attach media with `--media` (repeatable) and optional `--alt` per item.
- Up to 4 images/GIFs, or 1 video (no mixing). Supported: jpg, jpeg, png, webp, gif, mp4, mov.
- Images/GIFs + 1 video supported (uploads via Twitter legacy upload endpoint + cookies; video may take longer to process).

Example:

```bash
bird tweet "hi" --media img.png --alt "desc"
```

## Development

```bash
cd ~/Projects/bird
pnpm install
pnpm run build       # dist/ + bun binary
pnpm run build:dist  # dist/ only
pnpm run build:binary

pnpm run dev tweet "Test"
pnpm run dev -- --plain check
pnpm test
pnpm run lint
```

## Notes

- GraphQL uses internal X endpoints and can be rate limited (429).
- Query IDs rotate; refresh at runtime with `bird query-ids --fresh` (or update the baked baseline via `pnpm run graphql:update`).
