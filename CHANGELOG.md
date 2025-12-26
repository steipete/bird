# Changelog

## 0.3.0 — Unreleased

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
