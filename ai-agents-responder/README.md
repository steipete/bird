# AI Agents Twitter Auto-Responder

A fully automated system that monitors X/Twitter for AI-related posts from influential accounts (50K+ followers) and replies with high-value, professionally formatted PDF summaries to drive visibility for Zaigo Labs' AI services business.

## Overview

This standalone application implements a 5-stage pipeline:

1. **Poll**: Search Twitter for AI agents content using Bird
2. **Filter**: Validate candidates (followers, recency, deduplication, rate limits)
3. **Generate**: Create PDF summary via Manus API
4. **Convert**: Transform PDF to PNG (Twitter doesn't render PDFs inline)
5. **Reply**: Post reply with PNG attachment

**Critical constraint**: Complete pipeline in < 5 minutes to achieve top reply visibility.

## Prerequisites

- **Bun** >= 1.0 (runtime and package manager)
- **Twitter/X credentials** (one of the following):
  - Browser cookie source (macOS Safari or Chrome)
  - Manual AUTH_TOKEN + CT0 tokens
- **Manus API key** for PDF generation

## Setup

### 1. Clone and install dependencies

```bash
cd ai-agents-responder
bun install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```bash
# Twitter Authentication (choose one method)
# Option 1: Browser cookies (recommended for macOS)
BIRD_COOKIE_SOURCE=safari

# Option 2: Manual tokens (get from browser dev tools)
# AUTH_TOKEN=your_auth_token_here
# CT0=your_ct0_csrf_token_here

# Manus API (required)
MANUS_API_KEY=your_manus_api_key_here
```

### 3. Seed the database

Pre-populate the author cache with known AI influencers:

```bash
bun run seed-db
```

This seeds 12 high-follower AI accounts for faster filtering (avoids API lookups).

### 4. Run type check and lint

```bash
bun run check-types
bun run lint
```

## Usage

### Dry-run mode (recommended for testing)

Test the full pipeline without actually posting to Twitter:

```bash
DRY_RUN=true bun run start
```

In dry-run mode:
- All pipeline stages execute normally
- Manus API is called, PDFs are generated
- Replies are logged but NOT posted
- Database records are marked with `DRY_RUN:` prefix

### Production mode

```bash
bun run start
```

Or with development mode (auto-restart on file changes):

```bash
bun run dev
```

### Running tests

```bash
# Run all tests (unit + integration + E2E)
bun run test

# Run only vitest tests (config, filter, templates)
bun run test:vitest

# Run only bun tests (database, integration, E2E)
bun run test:bun
```

## Configuration

All configuration is via environment variables. See `.env.example` for full documentation.

| Variable | Default | Description |
|----------|---------|-------------|
| `BIRD_COOKIE_SOURCE` | - | Browser to extract cookies from (`safari` or `chrome`) |
| `AUTH_TOKEN` / `CT0` | - | Manual Twitter tokens (alternative to cookie source) |
| `MANUS_API_KEY` | - | **Required**: Manus API key for PDF generation |
| `MANUS_TIMEOUT_MS` | 120000 | Manus task timeout (60000-300000) |
| `DATABASE_PATH` | `./data/responder.db` | SQLite database location |
| `MAX_DAILY_REPLIES` | 15 | Maximum replies per day |
| `MIN_GAP_MINUTES` | 10 | Minimum gap between replies |
| `MAX_PER_AUTHOR_PER_DAY` | 1 | Max replies to same author per day |
| `MIN_FOLLOWER_COUNT` | 50000 | Minimum followers for target authors |
| `MAX_TWEET_AGE_MINUTES` | 30 | Maximum tweet age to consider |
| `MIN_TWEET_LENGTH` | 100 | Minimum tweet content length |
| `POLL_INTERVAL_MS` | 60000 | Poll interval (60 seconds) |
| `DRY_RUN` | false | Enable dry-run mode |
| `LOG_LEVEL` | info | Logging level (info/warn/error) |

## Architecture

```
ai-agents-responder/
├── src/
│   ├── index.ts           # Main orchestrator with poll loop
│   ├── poller.ts          # Bird search wrapper
│   ├── filter.ts          # Multi-stage filter pipeline
│   ├── generator.ts       # Manus API + PDF→PNG conversion
│   ├── responder.ts       # Bird reply with media upload
│   ├── manus-client.ts    # Manus API client
│   ├── pdf-converter.ts   # PDF to PNG conversion
│   ├── reply-templates.ts # Randomized reply text
│   ├── database.ts        # SQLite operations (bun:sqlite)
│   ├── config.ts          # Environment validation
│   ├── logger.ts          # Structured JSON logging
│   ├── types.ts           # TypeScript interfaces
│   └── utils/
│       ├── retry.ts       # Exponential backoff
│       ├── circuit-breaker.ts  # Manus failure protection
│       └── errors.ts      # Error classification
├── scripts/
│   ├── seed-db.ts         # Seed known influencers
│   └── e2e-test.sh        # E2E validation script
├── data/
│   ├── responder.db       # SQLite database (gitignored)
│   └── seed-authors.json  # Initial influencer list
└── __tests__/             # Test suites
```

For detailed architecture documentation, see [specs/ai-agents/design.md](../specs/ai-agents/design.md).

## Troubleshooting

### Authentication errors (401)

**Problem**: `HTTP 401 Unauthorized` from Twitter API

**Solutions**:
1. If using `BIRD_COOKIE_SOURCE=safari`:
   - Ensure you're logged into Twitter in Safari
   - Try `BIRD_COOKIE_SOURCE=chrome` if Safari doesn't work
2. If using manual tokens:
   - Tokens expire frequently; refresh from browser dev tools
   - Get AUTH_TOKEN from `auth_token` cookie
   - Get CT0 from `ct0` cookie

### Manus API timeout

**Problem**: PDF generation exceeds timeout

**Solutions**:
1. Increase timeout: `MANUS_TIMEOUT_MS=180000` (3 minutes)
2. Check Manus API status at https://open.manus.ai
3. Circuit breaker may be open (30-minute cooldown after 3 failures)

### No eligible tweets found

**Problem**: Filter rejects all candidates

**Causes and solutions**:
1. **Low followers**: Reduce `MIN_FOLLOWER_COUNT=10000` for testing
2. **Tweet too old**: Increase `MAX_TWEET_AGE_MINUTES=60`
3. **Short content**: Reduce `MIN_TWEET_LENGTH=50`
4. **Rate limited**: Check `daily_count` in database
5. **Already replied**: Check `replied_tweets` table

### Database errors

**Problem**: SQLite errors or corruption

**Solutions**:
1. Delete and recreate: `rm data/responder.db && bun run seed-db`
2. Check disk space
3. Ensure `data/` directory exists with write permissions

### PNG too large (>5MB)

**Problem**: Converted PNG exceeds Twitter's 5MB limit

**Solution**: The converter automatically compresses to 80% quality. If still too large, the tweet is skipped with an error log.

## Rate Limiting Strategy

Conservative defaults prevent spam detection:

- **10-15 replies/day**: Well under Twitter's limits
- **10-minute gaps**: Natural engagement pattern
- **1 reply per author per day**: Avoid appearing stalker-ish
- **Circuit breaker**: 30-minute cooldown after 3 Manus failures

## Logs

Logs are structured JSON written to stdout:

```json
{"timestamp":"2026-01-19T12:00:00.000Z","level":"info","component":"orchestrator","event":"cycle_complete","metadata":{"duration":125000,"status":"processed"}}
```

Key events to monitor:
- `cycle_complete` - Successful poll cycle
- `reply_posted` - Reply successfully posted
- `circuit_breaker_transition` - Manus protection state change
- `auth_error` - Authentication failure (requires re-auth)

## Specs Directory

Detailed specification documents are available in the specs directory:

- [specs/ai-agents/requirements.md](../specs/ai-agents/requirements.md) - Functional requirements
- [specs/ai-agents/design.md](../specs/ai-agents/design.md) - Technical design
- [specs/ai-agents/tasks.md](../specs/ai-agents/tasks.md) - Implementation tasks
- [specs/ai-agents/.progress.md](../specs/ai-agents/.progress.md) - Development progress

## License

Internal Zaigo Labs project. All rights reserved.
