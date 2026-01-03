# Changelog

## Unreleased

### Added
- Bookmark exports now support pagination (`--all`, `--max-pages`) with retries (#15) — thanks @Nano1337.
- `lists` + `list-timeline` commands for Twitter Lists (#21) — thanks @harperreed
## 0.5.1 — 2026-01-01

### Changed
- `bird --help` now includes explicit “Shortcuts” and “JSON Output” sections (documents `bird <tweet-id-or-url>` shorthand + `--json`).
- Release docs now include explicit npm publish verification steps.

### Fixed
- `pnpm bird --help` now works (dev script runs the CLI entrypoint, not the library entrypoint).
- `following`/`followers` now fall back to internal v1.1 REST endpoints when GraphQL returns `404`.

### Tests
- Add root help output regression test.
- Add opt-in live CLI test suite (real GraphQL calls; skipped by default; gated via `BIRD_LIVE=1`).

## 0.5.0 — 2026-01-01

### Added
- `likes` command to list your liked tweets (thanks @swairshah).
- Quoted tweet data in JSON output + `--quote-depth` (thanks @alexknowshtml).
- `following`/`followers` commands to list users (thanks @lockmeister).

### Changed
- Query ID updater now tracks the Likes GraphQL operation.
- Query ID updater now tracks Following/Followers GraphQL operations.
- Query ID updater now tracks BookmarkFolderTimeline and keeps bookmark query IDs seeded.
- `following`/`followers` JSON user fields are now camelCase (`followersCount`, `followingCount`, `isBlueVerified`, `profileImageUrl`, `createdAt`).
- Cookie extraction timeout is now configurable (default 30s on macOS) via `--cookie-timeout` / `BIRD_COOKIE_TIMEOUT_MS` (thanks @tylerseymour).
- Search now paginates beyond 20 results when using `-n` (thanks @ryanh-ai).
- Library exports are now separated from the CLI entrypoint for easier embedding.

## 0.4.1 — 2025-12-31

### Added
- `bookmarks` command to list your bookmarked tweets.
- `bookmarks --folder-id` to fetch bookmark folders (thanks @tylerseymour).

### Changed
- Cookie extraction now uses `@steipete/sweet-cookie` (drops `sqlite3` CLI + custom browser readers in `bird`).
- Query ID updater now tracks the Bookmarks GraphQL operation.
- Lint rules stricter (block statements, no-negation-else, useConst/useTemplate, top-level regex, import extension enforcement).
- `pnpm lint` now runs both Biome and oxlint (type-aware).

### Tests
- Coverage thresholds raised to 90% statements/lines/functions (80% branches).
- Added targeted Twitter client coverage suites.

## 0.4.0 — 2025-12-26

### Added
- Cookie source selection: `--cookie-source safari|chrome|firefox` (repeatable) + `cookieSource` config (string or array).

### Fixed
- `tweet`/`reply`: fallback to `statuses/update.json` when GraphQL `CreateTweet` returns error 226 (“automated request”).

### Breaking
- Remove `allowSafari`/`allowChrome`/`allowFirefox` config toggles in favor of `cookieSource` ordering.

## 0.3.0 — 2025-12-26

### Added
- Safari cookie extraction (`Cookies.binarycookies`) + `allowSafari` config toggle.

### Changed
- Removed the Sweetistics engine + fallback. `bird` is GraphQL-only.
- Browser cookie fallback order: Safari → Chrome → Firefox.

### Tests
- Enforce coverage thresholds (>= 70% statements/branches/functions/lines) + expand unit coverage for version/output/Twitter client branches.

## 0.2.0 — 2025-12-26

### Added
- Output controls: `--plain`, `--no-emoji`, `--no-color` (respects `NO_COLOR`).
- `help` command: `bird help <command>`.
- Runtime GraphQL query ID refresh: `bird query-ids --fresh` (cached on disk; auto-retry on 404; override cache via `BIRD_QUERY_IDS_CACHE`).
- GraphQL media uploads via `--media` (up to 4 images/GIFs, or 1 video).

### Fixed
- CLI `--version`: read version from `package.json`/`VERSION` (no hardcoded string) + append git sha when available.

### Changed
- `mentions`: no hardcoded user; defaults to authenticated user or accepts `--user @handle`.
- GraphQL query ID updater: correctly pairs `operationName` ↔ `queryId` (CreateTweet/CreateRetweet/etc).
- `build:dist`: copies `src/lib/query-ids.json` into `dist/lib/query-ids.json` (keeps `dist/` in sync).
- `--engine graphql`: strict GraphQL-only (disables Sweetistics fallback).

## 0.1.1 — 2025-12-26

### Changed
- Engine default now `auto` (GraphQL primary; Sweetistics only on fallback when configured).

### Tests
- Add engine resolution tests for auto/default behavior.

### Fixed
- GraphQL read: rotate TweetDetail query IDs with fallback to avoid 404s.

## 0.1.0 — 2025-12-20

### Added
- CLI commands: `tweet`, `reply`, `read`, `replies`, `thread`, `search`, `mentions`, `whoami`, `check`.
- URL/ID shorthand for `read`, plus `--json` output where supported.
- GraphQL engine with cookie auth from Firefox/Chrome/env/flags (macOS browsers).
- Sweetistics engine (API key) with automatic fallback when configured.
- Media uploads via Sweetistics with per-item alt text (images or single video).
- Long-form Notes and Articles extraction for full text output.
- Thread + reply fetching with full conversation parsing.
- Search + mentions via GraphQL (latest timeline).
- JSON5 config files (`~/.config/bird/config.json5`, `./.birdrc.json5`) with engine defaults, profiles, allowChrome/allowFirefox, and timeoutMs.
- Request timeouts (`--timeout`, `timeoutMs`) for GraphQL and Sweetistics calls.
- Bun-compiled standalone binary via `pnpm run build`.
- Query ID refresh helper: `pnpm run graphql:update`.
