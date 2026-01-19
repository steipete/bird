---
spec: ai-agents
phase: tasks
total_tasks: 47
created: 2026-01-19
---

# Tasks: AI Agents Twitter Auto-Responder

## Execution Context

**Testing Depth**: Comprehensive - full test suite including E2E scenarios
**Deployment**: Local development first (validate locally, deploy to cloud later)

## Phase 1: Make It Work (POC)

Focus: Validate core pipeline end-to-end. Skip tests, accept hardcoded values, prioritize working demonstration.

### Task 1.1: Project setup - dependencies and TypeScript config [x]

**Do**:
1. Create `ai-agents-responder/package.json`:
   - name: "@zaigo/ai-agents-responder"
   - type: "module"
   - dependencies: @steipete/bird, pdf-to-png-converter, dotenv
   - devDependencies: @types/node, typescript, vitest
   - scripts: start, dev, test, lint, format
2. Create `ai-agents-responder/tsconfig.json`:
   - target: ES2022
   - module: NodeNext
   - moduleResolution: NodeNext
   - strict: true
   - outDir: dist
3. Create `ai-agents-responder/.gitignore`:
   - .env
   - data/*.db
   - node_modules
   - dist
4. Create `ai-agents-responder/.env.example` template with all env vars

**Files**:
- `ai-agents-responder/package.json` - Create - Package manifest
- `ai-agents-responder/tsconfig.json` - Create - TypeScript config
- `ai-agents-responder/.gitignore` - Create - Git ignore rules
- `ai-agents-responder/.env.example` - Create - Env template

**Done when**:
- package.json has all dependencies listed
- tsconfig.json compiles with strict mode
- .env.example documents all required vars
- .gitignore prevents credential leaks

**Verify**:
```bash
cd ai-agents-responder && cat package.json | grep '"type": "module"' && cat tsconfig.json | grep '"moduleResolution": "NodeNext"'
```

**Commit**:
```
feat(ai-agents): initialize project structure with TypeScript and Bun
```

_Requirements: FR-24 (configurable via .env)_
_Design: File Structure, Technical Decisions_

---

### Task 1.2: TypeScript types - core interfaces [x]

**Do**:
1. Create `src/types.ts` with interfaces:
   - TweetCandidate (id, text, authorId, authorUsername, createdAt, language, isRetweet)
   - PollerResult (success, tweets, error)
   - FilterResult (eligible, stats)
   - FilterStats (total, rejection counts by reason)
   - GeneratorResult (success, png, manusTaskId, manusDuration, pngSize, error)
   - ResponderResult (success, replyTweetId, templateUsed, error)
   - Config (bird, manus, rateLimits, filters, polling, database, logging, features)
   - RateLimitState, CircuitBreakerState, AuthorCacheEntry, ReplyLogEntry
   - **ManusTaskResponse** (taskId, taskUrl, shareUrl) - API response from createTask
   - **ManusTaskResult** (status, pdfUrl) - API response from pollTask
   - **PollOptions** (pollIntervalMs, timeoutMs) - polling configuration

**Files**:
- `ai-agents-responder/src/types.ts` - Create - TypeScript interfaces

**Done when**:
- All interfaces match design.md specifications
- Manus API interfaces included (ManusTaskResponse, ManusTaskResult, PollOptions)
- Types compile without errors

**Verify**:
```bash
cd ai-agents-responder && bun run tsc --noEmit
```

**Commit**:
```
feat(ai-agents): define core TypeScript interfaces
```

_Requirements: All FRs_
_Design: Components section (all interface definitions), ManusClient interface_

---

### Task 1.3: Config loader - environment validation [x]

**Do**:
1. Create `src/config.ts`:
   - loadConfig() reads .env via dotenv
   - validateConfig() enforces:
     - XOR: cookieSource OR (authToken + ct0)
     - MANUS_API_KEY required
     - Numeric ranges (e.g., MANUS_TIMEOUT_MS 60000-300000)
     - Rate limit sanity check: maxDailyReplies * minGapMinutes < 1440 (24h)
   - maskSecrets() for logging (mask authToken, ct0, manusApiKey)
   - Exit process if validation fails
2. Set defaults from design.md
3. Log masked config on startup

**Files**:
- `ai-agents-responder/src/config.ts` - Create - Config loading and validation

**Done when**:
- Invalid config exits with clear error messages
- Valid config loads and masks secrets
- All defaults match design.md values

**Verify**:
```bash
cd ai-agents-responder && MANUS_API_KEY=test bun run --eval 'import { loadConfig } from "./src/config.js"; console.log(loadConfig())'
```

**Commit**:
```
feat(ai-agents): implement config loading with validation
```

_Requirements: FR-24, Configuration Schema_
_Design: Config Manager, Configuration Design_

---

### Task 1.4: [VERIFY] Quality checkpoint

**Do**: Run quality commands discovered from research.md

**Verify**:
```bash
cd ai-agents-responder && bun run tsc --noEmit
```

**Done when**: No type errors

**Commit**: `chore(ai-agents): pass quality checkpoint` (if fixes needed)

---

### Task 1.5: Logger - structured JSON output [x]

**Do**:
1. Create `src/logger.ts`:
   - info(component, event, metadata) writes JSON to stdout
   - warn(component, event, metadata) writes JSON to stdout
   - error(component, event, error, metadata) includes stack trace
   - Format: `{ timestamp: ISO8601, level, component, event, metadata?, stack? }`
   - Respect LOG_LEVEL env var (default: info)
2. Export singleton logger instance

**Files**:
- `ai-agents-responder/src/logger.ts` - Create - Structured logging

**Done when**:
- Logs output as parseable JSON
- Error logs include stack traces
- LOG_LEVEL filtering works (info/warn/error)

**Verify**:
```bash
cd ai-agents-responder && bun run --eval 'import { logger } from "./src/logger.js"; logger.info("test", "startup", { version: "1.0" })' | jq .component
```

**Commit**:
```
feat(ai-agents): add structured JSON logger
```

_Requirements: FR-16, AC-10.1 through AC-10.5_
_Design: Logger component_

---

### Task 1.6: Database schema - SQLite initialization [x]

**Do**:
1. Create `src/database.ts`:
   - initDatabase() creates tables if not exist:
     - **replied_tweets** (complete schema from requirements.md Database Schema section)
     - **rate_limits** (singleton with id=1 constraint, includes circuit breaker fields)
     - **author_cache** (complete schema from requirements.md Database Schema section)
   - Create all indexes from requirements.md Database Schema section
   - Initialize rate_limits singleton row with circuit breaker defaults:
     - circuit_state = 'closed'
     - circuit_failure_count = 0
     - circuit_last_failure_at = NULL
     - circuit_opened_at = NULL
   - Export db connection (bun:sqlite)
2. Implement basic CRUD:
   - hasRepliedToTweet(tweetId)
   - getRepliesForAuthorToday(authorId)
   - getRateLimitState()
   - getAuthorCache(authorId)
   - recordReply(log)

**Files**:
- `ai-agents-responder/src/database.ts` - Create - SQLite operations

**Done when**:
- Database file created at DATABASE_PATH
- All 3 tables exist with complete schemas from requirements.md
- All indexes created per requirements.md Database Schema
- rate_limits singleton initialized with circuit breaker fields
- Basic queries return expected types

**Verify**:
```bash
cd ai-agents-responder && DATABASE_PATH=./test.db MANUS_API_KEY=test bun run --eval 'import { initDatabase } from "./src/database.js"; await initDatabase(); console.log("DB OK")' && rm test.db
```

**Commit**:
```
feat(ai-agents): implement SQLite schema and basic queries
```

_Requirements: FR-17, Database Schema (requirements.md), FR-7, FR-8_
_Design: Database Schema, Database component, Circuit Breaker state storage_

---

### Task 1.7: [VERIFY] Quality checkpoint

**Do**: Run type check and basic validation

**Verify**:
```bash
cd ai-agents-responder && bun run tsc --noEmit
```

**Done when**: No type errors, code compiles

**Commit**: `chore(ai-agents): pass quality checkpoint` (if fixes needed)

---

### Task 1.8: Poller - Bird search wrapper [x]

**Do**:
1. Create `src/poller.ts`:
   - search(query, count) calls `birdClient.search(query, count)`
   - Map bird results to TweetCandidate[]
   - Extract: id, text, authorId, authorUsername, createdAt, language, isRetweet
   - Handle errors gracefully, return { success: false, error }
   - Log search results: query, count, duration
2. Initialize BirdClient with auth in constructor
3. For POC: Hardcode query = `"AI agents" -is:retweet lang:en`, count = 50

**Files**:
- `ai-agents-responder/src/poller.ts` - Create - Bird search wrapper

**Done when**:
- search() returns TweetCandidate[] on success
- Errors are caught and returned (not thrown)
- Logs include result count and duration

**Verify**:
```bash
cd ai-agents-responder && BIRD_COOKIE_SOURCE=safari MANUS_API_KEY=test bun run --eval 'import { Poller } from "./src/poller.js"; const p = new Poller(); const r = await p.search("test", 1); console.log(r.success ? "OK" : r.error)'
```

**Commit**:
```
feat(ai-agents): implement Twitter search poller with Bird
```

_Requirements: FR-1, AC-1.1 through AC-1.5_
_Design: Poller component_

---

### Task 1.9: Filter pipeline - content and deduplication [x]

**Do**:
1. Create `src/filter.ts`:
   - filter(candidates) runs stages sequentially:
     - Stage 1: Content filters (length >100, language=en, not retweet, age <30min)
     - Stage 2: Deduplication (hasRepliedToTweet, getRepliesForAuthorToday)
   - Return first eligible tweet or null
   - Track FilterStats (rejection reasons)
   - Log filter stats after each cycle
2. For POC: Skip follower count check (Stage 3) and rate limit check (Stage 4)

**Files**:
- `ai-agents-responder/src/filter.ts` - Create - Filter pipeline

**Done when**:
- Content filters work (length, language, age)
- Deduplication queries DB correctly
- FilterStats logged with rejection counts
- Returns first eligible or null

**Verify**:
```bash
cd ai-agents-responder && DATABASE_PATH=./test.db MANUS_API_KEY=test bun run --eval 'import { FilterPipeline } from "./src/filter.js"; const f = new FilterPipeline(); console.log("Filter OK")' && rm test.db
```

**Commit**:
```
feat(ai-agents): implement filter pipeline for content and deduplication
```

_Requirements: FR-2 through FR-5, FR-7, FR-8_
_Design: Filter Pipeline component_

---

### Task 1.10: [VERIFY] Quality checkpoint

**Do**: Type check and validate implementations so far

**Verify**:
```bash
cd ai-agents-responder && bun run tsc --noEmit
```

**Done when**: No type errors

**Commit**: `chore(ai-agents): pass quality checkpoint` (if fixes needed)

---

### Task 1.11: Manus client - task creation and polling [x]

**Do**:
1. Create `src/manus-client.ts` implementing the **ManusClient interface from design.md**:
   - **createTask(prompt): Promise<ManusTaskResponse>** - POSTs to Manus API with apiKey header
     - Returns ManusTaskResponse: { taskId, taskUrl, shareUrl }
     - Throws on API errors (4xx/5xx)
   - **pollTask(taskId, options: PollOptions): Promise<ManusTaskResult | null>** - polls GET /tasks/{taskId} every 5s
     - Returns ManusTaskResult: { status, pdfUrl } when status = 'completed'
     - Returns null on timeout (default 120s from options.timeoutMs)
   - **downloadPdf(url): Promise<Uint8Array>** - fetches PDF as Uint8Array
     - Validates content-type is application/pdf
     - Throws on fetch errors
2. Use fetch with timeout wrapper for all HTTP calls
3. Log Manus task_id, duration on completion, errors on failure

**Files**:
- `ai-agents-responder/src/manus-client.ts` - Create - Manus API client

**Done when**:
- All methods match ManusClient interface from design.md
- createTask returns ManusTaskResponse type
- pollTask returns ManusTaskResult | null with proper timeout handling
- downloadPdf validates PDF content-type before returning
- All errors logged with component='manus-client'

**Verify**:
```bash
cd ai-agents-responder && MANUS_API_KEY=test bun run --eval 'import { ManusClient } from "./src/manus-client.js"; const m = new ManusClient(); console.log("Manus client created")'
```

**Commit**:
```
feat(ai-agents): implement Manus API client with polling
```

_Requirements: FR-11, AC-6.1 through AC-6.5, NFR-3_
_Design: Generator component, ManusClient interface (design.md)_

---

### Task 1.12: PDF converter - PDF to PNG with compression [x]

**Do**:
1. Create `src/pdf-converter.ts`:
   - convertToPng(pdf, options) uses pdf-to-png-converter
   - Options: width=1200px, dpi=150, quality=90
   - compress(png, quality) reduces quality to 80% if >5MB
   - Validate output size <5MB, throw if still too large
   - Log conversion duration and PNG size

**Files**:
- `ai-agents-responder/src/pdf-converter.ts` - Create - PDF to PNG conversion

**Done when**:
- convertToPng returns PNG Uint8Array
- compress reduces quality when needed
- Size validation works (5MB limit)
- Errors logged and thrown for upstream handling

**Verify**:
```bash
cd ai-agents-responder && bun run --eval 'import { PdfConverter } from "./src/pdf-converter.js"; const p = new PdfConverter(); console.log("PDF converter OK")'
```

**Commit**:
```
feat(ai-agents): implement PDF to PNG conversion with compression
```

_Requirements: FR-12, AC-7.1 through AC-7.5, NFR-4_
_Design: Generator component, PdfConverter interface_

---

### Task 1.13: [VERIFY] Quality checkpoint

**Do**: Type check all new modules

**Verify**:
```bash
cd ai-agents-responder && bun run tsc --noEmit
```

**Done when**: No type errors

**Commit**: `chore(ai-agents): pass quality checkpoint` (if fixes needed)

---

### Task 1.14: Generator - orchestrate Manus + PDF conversion [x]

**Do**:
1. Create `src/generator.ts`:
   - **Implement buildManusPrompt(tweet: TweetCandidate): string**
     - Use the complete prompt template from design.md (~40 lines)
     - Template includes: CRITICAL REQUIREMENTS for single-page PDF, Zaigo Labs branding, professional layout
     - Replaces {username}, {userId}, {tweetContent} placeholders
   - generate(tweet) orchestrates:
     - **Call buildManusPrompt(tweet)** to create prompt
     - createTask(prompt) via ManusClient
     - pollTask(taskId, { pollIntervalMs: 5000, timeoutMs: 120000 })
     - downloadPdf(pdfUrl) when complete
     - convertToPng(pdfBuffer, options)
     - compress(pngBuffer, quality) if >5MB
   - Return GeneratorResult with PNG, taskId, duration, size
   - Handle timeouts and errors gracefully (return { success: false, error })
   - Log each stage: prompt_built, task_created, polling_started, pdf_downloaded, png_converted

**Files**:
- `ai-agents-responder/src/generator.ts` - Create - PDF generation orchestrator

**Done when**:
- buildManusPrompt() implemented with full template from design.md
- Full pipeline works: buildPrompt → Manus → PDF → PNG
- Timeout handling works (120s from PollOptions)
- PNG compression applied when needed
- All stages logged with metadata

**Verify**:
```bash
cd ai-agents-responder && MANUS_API_KEY=test bun run --eval 'import { Generator } from "./src/generator.js"; const g = new Generator(); console.log("Generator OK")'
```

**Commit**:
```
feat(ai-agents): implement PDF generation orchestrator
```

_Requirements: FR-11, FR-12, AC-6.1 through AC-7.5_
_Design: Generator component, buildManusPrompt template (design.md)_

---

### Task 1.15: Reply templates - randomized text generation [x]

**Do**:
1. Create `src/reply-templates.ts`:
   - **REPLY_TEMPLATES array with 7 variations** from **requirements.md Reply Text Templates section**:
     1. "Great insights on AI agents, @{username}! Here's a quick summary:"
     2. "@{username} – I've distilled your thoughts on AI agents into a visual summary:"
     3. "Excellent points on agentic AI! Summary attached @{username}:"
     4. "Thanks for sharing your insights on AI agents, @{username}. Here's a visual breakdown:"
     5. "Interesting perspective on AI agents! Quick summary here @{username}:"
     6. "@{username} – Great take on agentic AI. I've summarized your key points:"
     7. "Solid insights on AI agents. Visual summary attached, @{username}:"
   - **Implement ReplyTemplateManager class** following design.md pattern:
     - selectTemplate() uses crypto.randomInt(0, REPLY_TEMPLATES.length)
     - buildReplyText(template, username) replaces {username}
     - 50% attribution: crypto.randomInt(0, 2) === 1
     - ATTRIBUTION_SUFFIX = '\n\n📊 AI analysis by Zaigo Labs'
     - Validate total length <280 chars
     - Throw if length exceeded

**Files**:
- `ai-agents-responder/src/reply-templates.ts` - Create - Reply text templates

**Done when**:
- All 7 template strings from requirements.md included
- ReplyTemplateManager class matches design.md implementation
- selectTemplate returns random template using crypto.randomInt
- buildReplyText handles {username} replacement
- Attribution added 50% of time
- Length validation works (280 char limit)

**Verify**:
```bash
cd ai-agents-responder && bun run --eval 'import { ReplyTemplateManager } from "./src/reply-templates.js"; const r = new ReplyTemplateManager(); console.log(r.buildReplyText(r.selectTemplate(), "testuser"))'
```

**Commit**:
```
feat(ai-agents): implement randomized reply templates
```

_Requirements: FR-15, Reply Text Templates (requirements.md)_
_Design: Responder component, ReplyTemplateManager implementation (design.md)_

---

### Task 1.16: [VERIFY] Quality checkpoint

**Do**: Type check and validate template logic

**Verify**:
```bash
cd ai-agents-responder && bun run tsc --noEmit
```

**Done when**: No type errors

**Commit**: `chore(ai-agents): pass quality checkpoint` (if fixes needed)

---

### Task 1.17: Responder - Bird reply with media upload [x]

**Do**:
1. Create `src/responder.ts`:
   - reply(tweet, png) orchestrates:
     - uploadMedia(png, 'image/png') via Bird
     - selectTemplate() and buildReplyText()
     - reply(text, tweetId, [mediaId]) via Bird
   - Handle dry-run mode: skip Bird calls, log payload, return fake ID
   - Return ResponderResult with replyTweetId, templateUsed
   - Log media upload size and reply success

**Files**:
- `ai-agents-responder/src/responder.ts` - Create - Bird reply wrapper

**Done when**:
- uploadMedia returns mediaId
- reply posts with media attachment
- Dry-run mode skips posting, logs payload
- All results logged with metadata

**Verify**:
```bash
cd ai-agents-responder && DRY_RUN=true BIRD_COOKIE_SOURCE=safari MANUS_API_KEY=test bun run --eval 'import { Responder } from "./src/responder.js"; const r = new Responder(); console.log("Responder OK")'
```

**Commit**:
```
feat(ai-agents): implement Twitter responder with media upload
```

_Requirements: FR-13, FR-14, FR-23, AC-8.1 through AC-8.5, AC-11.1 through AC-11.5_
_Design: Responder component_

---

### Task 1.18: Main orchestrator - poll loop skeleton [x]

**Do**:
1. Create `src/index.ts`:
   - Initialize config, logger, db, birdClient on startup
   - runCycle() skeleton:
     - Log cycle start
     - Call poller.search()
     - Call filter.filter()
     - If no eligible, log and return
     - TODO: Generate and reply (next task)
     - Log cycle complete with duration
   - start() runs 60s poll loop
   - Graceful shutdown on SIGTERM/SIGINT
2. For POC: Skip rate limit checks, circuit breaker, retry logic

**Files**:
- `ai-agents-responder/src/index.ts` - Create - Main orchestrator

**Done when**:
- Poll loop runs every 60s
- Calls poller and filter
- Logs cycle summary
- Graceful shutdown works

**Verify**:
```bash
cd ai-agents-responder && timeout 5 bun src/index.ts || echo "Timeout OK"
```

**Commit**:
```
feat(ai-agents): implement main poll loop skeleton
```

_Requirements: FR-1, AC-1.1, US-1_
_Design: Main Orchestrator component_

---

### Task 1.19: [VERIFY] Quality checkpoint

**Do**: Type check main orchestrator

**Verify**:
```bash
cd ai-agents-responder && bun run tsc --noEmit
```

**Done when**: No type errors

**Commit**: `chore(ai-agents): pass quality checkpoint` (if fixes needed)

---

### Task 1.20: Main orchestrator - complete pipeline integration [x]

**Do**:
1. Update `src/index.ts` runCycle():
   - After filter returns eligible tweet:
     - Call generator.generate(tweet)
     - Handle generation failure: log error, skip tweet
     - Call responder.reply(tweet, png)
     - Handle reply failure: log error, skip tweet
     - Call db.recordReply(log entry)
     - Call db.incrementDailyCount()
     - Call db.updateLastReplyTime(now)
   - Wrap all in try/catch, log unhandled errors
   - Exit on critical errors (auth failure, DB corruption)

**Files**:
- `ai-agents-responder/src/index.ts` - Modify - Add generation and reply

**Done when**:
- Full pipeline executes: search → filter → generate → reply → record
- Errors logged without crashing
- DB updated after successful reply
- Critical errors exit process

**Verify**:
```bash
cd ai-agents-responder && DRY_RUN=true timeout 65 bun src/index.ts 2>&1 | grep "cycle_complete" || echo "Need tweets to test"
```

**Commit**:
```
feat(ai-agents): complete full pipeline integration
```

_Requirements: All FRs, US-1 through US-11_
_Design: Data Flow, Error Recovery Flow_

---

### Task 1.21: Seed authors data - known influencer list [x]

**Do**:
1. Create `data/seed-authors.json` with 12 AI influencers:
   - Each entry: { authorId, username, name, followerCount }
   - Include: sama, karpathy, ylecun, etc. (from overview.md seed list)
2. Create `scripts/seed-db.ts`:
   - Read seed-authors.json
   - Upsert into author_cache table
   - Log seed count
3. Add npm script: `seed-db`

**Files**:
- `ai-agents-responder/data/seed-authors.json` - Create - Known influencer list
- `ai-agents-responder/scripts/seed-db.ts` - Create - DB seeding script

**Done when**:
- seed-authors.json has 12+ entries
- seed-db script populates author_cache
- Script can be run multiple times safely

**Verify**:
```bash
cd ai-agents-responder && DATABASE_PATH=./test.db MANUS_API_KEY=test bun scripts/seed-db.ts && rm test.db
```

**Commit**:
```
feat(ai-agents): add author cache seeding with known influencers
```

_Requirements: FR-21, AC-3.5_
_Design: File Structure, Author cache seeding_

---

### Task 1.22: [VERIFY] Quality checkpoint

**Do**: Type check all scripts and validate data

**Verify**:
```bash
cd ai-agents-responder && bun run tsc --noEmit && cat data/seed-authors.json | jq length
```

**Done when**: No type errors, seed data valid JSON

**Commit**: `chore(ai-agents): pass quality checkpoint` (if fixes needed)

---

### Task 1.23: POC E2E validation - end-to-end pipeline test [x]

**Do**:
1. Create manual E2E validation script `scripts/e2e-test.sh`:
   - Set DRY_RUN=true
   - Set LOG_LEVEL=info
   - Run main process for 2 minutes
   - Parse logs to verify:
     - Poll cycle executed
     - Search returned results
     - Filter processed candidates
     - If eligible tweet found: Generator and Responder called
   - Check DB: replied_tweets table has dry-run entries
2. Document expected logs in script comments
3. **Real-world validation**: Using browser automation or curl:
   - If Manus API accessible: POST test task, verify PDF generation
   - If Bird accessible: Search for real "AI agents" tweets, verify results parse
   - Document results in script output

**Files**:
- `ai-agents-responder/scripts/e2e-test.sh` - Create - E2E validation script

**Done when**:
- Script runs full pipeline in dry-run mode
- Logs show all components executed
- DB contains dry-run reply records
- **E2E verification**: Real Manus API call succeeds OR documented why skipped
- **E2E verification**: Real Bird search succeeds OR documented why skipped

**Verify**:
```bash
cd ai-agents-responder && bash scripts/e2e-test.sh
```

**Commit**:
```
feat(ai-agents): add E2E validation script for POC pipeline
```

_Requirements: AC-11.1 through AC-11.5, NFR-1_
_Design: Test Strategy, Dry-Run Mode Design_

---

### Task 1.24: [VERIFY] POC checkpoint - full pipeline validation

**Do**:
1. Run E2E test script
2. Verify all pipeline stages executed
3. Check logs for errors
4. Validate DB state after run

**Verify**:
```bash
cd ai-agents-responder && bash scripts/e2e-test.sh && cat data/responder.db | sqlite3 "SELECT COUNT(*) FROM replied_tweets"
```

**Done when**:
- E2E test passes
- All components integrated
- POC demonstrates working pipeline

**Commit**: `feat(ai-agents): complete POC with validated pipeline`

---

## Phase 2: Refactoring

After POC validated, clean up code structure and add robustness.

### Task 2.1: Filter pipeline - add follower count stage [x]

**Do**:
1. Update `src/filter.ts`:
   - Add Stage 3: Follower count check
   - getAuthorCache(authorId) from DB
   - If cache miss or stale (>24h):
     - Call bird.getUserByScreenNameGraphQL()
     - Retry 3 times with exponential backoff
     - upsertAuthorCache() with new data
   - Skip if followerCount < MIN_FOLLOWER_COUNT
   - Log cache hit/miss rate per cycle

**Files**:
- `ai-agents-responder/src/filter.ts` - Modify - Add follower check

**Done when**:
- Follower count check works
- Cache hit/miss logged
- Retry logic handles transient failures

**Verify**:
```bash
cd ai-agents-responder && bun run tsc --noEmit
```

**Commit**:
```
refactor(ai-agents): add follower count filtering with cache
```

_Requirements: FR-6, AC-3.1 through AC-3.6_
_Design: Filter Pipeline Stage 3_

---

### Task 2.2: Filter pipeline - add rate limit stage [x]

**Do**:
1. Update `src/filter.ts`:
   - Add Stage 4: Rate limit check before returning eligible
   - getRateLimitState() from DB
   - Check daily count < MAX_DAILY_REPLIES
   - Check gap since last reply >= MIN_GAP_MINUTES
   - Check replies to author today < MAX_PER_AUTHOR_PER_DAY
   - Skip if any rate limit exceeded
   - Log rate limit status at start of each cycle

**Files**:
- `ai-agents-responder/src/filter.ts` - Modify - Add rate limit check

**Done when**:
- Rate limits enforced before processing
- Daily count checked
- Gap enforcement works
- Per-author limit works

**Verify**:
```bash
cd ai-agents-responder && bun run tsc --noEmit
```

**Commit**:
```
refactor(ai-agents): add rate limit enforcement to filter
```

_Requirements: FR-9, FR-10, AC-5.1 through AC-5.5_
_Design: Filter Pipeline Stage 4_

---

### Task 2.3: [VERIFY] Quality checkpoint

**Do**: Type check and validate filter refactoring

**Verify**:
```bash
cd ai-agents-responder && bun run tsc --noEmit
```

**Done when**: No type errors

**Commit**: `chore(ai-agents): pass quality checkpoint` (if fixes needed)

---

### Task 2.4: Retry utility - exponential backoff [x]

**Do**:
1. Create `src/utils/retry.ts`:
   - retry(operation, options) wrapper
   - Options: maxAttempts, backoff (exponential/linear/fixed), baseDelayMs, maxDelayMs
   - Implements exponential backoff: delay = min(baseDelay * 2^attempt, maxDelay)
   - Logs retry attempts with delay and error
   - Throws after max attempts exceeded
2. Export RETRY_CONFIGS from design.md:
   - birdSearch, birdUserLookup, manusPoll, pngUpload

**Files**:
- `ai-agents-responder/src/utils/retry.ts` - Create - Retry utility

**Done when**:
- Retry logic works for all backoff types
- Max attempts enforced
- Delays calculated correctly
- All errors logged

**Verify**:
```bash
cd ai-agents-responder && bun run tsc --noEmit
```

**Commit**:
```
refactor(ai-agents): add retry utility with exponential backoff
```

_Requirements: FR-20, AC-9.4_
_Design: Retry Configuration_

---

### Task 2.5: Circuit breaker - Manus failure protection [x]

**Do**:
1. Create `src/utils/circuit-breaker.ts`:
   - executeWithCircuitBreaker(operation, db)
   - **State machine** (matches design.md Mermaid diagram):
     - **closed** → **open** (3 consecutive failures)
     - **open** → **half-open** (30 minutes elapsed)
     - **half-open** → **closed** (1 successful request)
     - **half-open** → **open** (any failure)
   - Load state from rate_limits table fields (already added in Task 1.6):
     - circuit_state ('closed' | 'open' | 'half-open')
     - circuit_failure_count (integer)
     - circuit_last_failure_at (DATETIME)
     - circuit_opened_at (DATETIME)
   - Update state after success/failure
   - Log all state transitions with event='circuit_breaker_transition'
   - Return null when circuit open (skip request)
2. Update `src/database.ts`:
   - Add **getCircuitBreakerState()** - reads circuit_* fields from rate_limits singleton
   - Add **updateCircuitBreakerState(state)** - updates circuit_* fields
   - Add **recordManusFailure()** - increments circuit_failure_count, updates circuit_last_failure_at
   - Add **recordManusSuccess()** - resets circuit_failure_count = 0, circuit_state = 'closed'

**Files**:
- `ai-agents-responder/src/utils/circuit-breaker.ts` - Create - Circuit breaker
- `ai-agents-responder/src/database.ts` - Modify - Add circuit breaker queries

**Done when**:
- State machine matches design.md circuit breaker diagram exactly
- Circuit opens after 3 consecutive failures
- Circuit half-opens after 30min cooldown
- State persisted in rate_limits table circuit_* fields
- All transitions logged with old_state → new_state
- getCircuitBreakerState() and update methods work

**Verify**:
```bash
cd ai-agents-responder && bun run tsc --noEmit
```

**Commit**:
```
refactor(ai-agents): implement circuit breaker for Manus API
```

_Requirements: FR-22, AC-9.3_
_Design: Circuit Breaker Design (design.md), Circuit breaker state machine diagram_

---

### Task 2.6: [VERIFY] Quality checkpoint [x]

**Do**: Type check utilities

**Verify**:
```bash
cd ai-agents-responder && bun run tsc --noEmit
```

**Done when**: No type errors

**Commit**: `chore(ai-agents): pass quality checkpoint` (if fixes needed)

---

### Task 2.7: Main orchestrator - integrate retry and circuit breaker [x]

**Do**:
1. Update `src/index.ts`:
   - Wrap poller.search() with retry (birdSearch config)
   - Wrap filter follower lookup with retry (birdUserLookup config)
   - Wrap generator.generate() with circuit breaker
   - Handle circuit breaker open: log, skip cycle
   - Update DB after successful generation (recordManusSuccess)
   - Update DB after failed generation (recordManusFailure)

**Files**:
- `ai-agents-responder/src/index.ts` - Modify - Add retry and circuit breaker

**Done when**:
- Search retries on failure
- Generator protected by circuit breaker
- Circuit state tracked in DB
- All retries and circuit events logged

**Verify**:
```bash
cd ai-agents-responder && bun run tsc --noEmit
```

**Commit**:
```
refactor(ai-agents): integrate retry and circuit breaker
```

_Requirements: FR-20, FR-22, AC-9.3, AC-9.4_
_Design: Error Recovery Flow_

---

### Task 2.8: Error handling - comprehensive try/catch [x]

**Do**:
1. Update all components to use result pattern:
   - Return `{ success: boolean; error?: string; data?: T }`
   - Never throw except critical errors
2. Update `src/index.ts` runCycle():
   - Catch all exceptions
   - Identify auth errors (401 from Bird)
   - Identify DB errors (corruption, connection failures)
   - Exit process on critical errors
   - Log all errors with component name and event
3. Add error detection utilities:
   - isAuthError(error)
   - isDatabaseError(error)

**Files**:
- `ai-agents-responder/src/index.ts` - Modify - Add comprehensive error handling
- `ai-agents-responder/src/utils/errors.ts` - Create - Error detection utilities

**Done when**:
- All components return results, not exceptions
- Critical errors exit process
- Non-critical errors logged and skipped
- Error types identified correctly

**Verify**:
```bash
cd ai-agents-responder && bun run tsc --noEmit
```

**Commit**:
```
refactor(ai-agents): add comprehensive error handling
```

_Requirements: FR-25, AC-9.1, AC-9.2, AC-9.5_
_Design: Error Handling Strategy_

---

### Task 2.9: [VERIFY] Quality checkpoint [x]

**Do**: Type check error handling

**Verify**:
```bash
cd ai-agents-responder && bun run tsc --noEmit
```

**Done when**: No type errors

**Commit**: `chore(ai-agents): pass quality checkpoint` (if fixes needed)

---

### Task 2.10: Graceful shutdown - signal handling [x]

**Do**:
1. Update `src/index.ts` following **design.md Graceful Shutdown section**:
   - Register SIGTERM and SIGINT handlers at startup
   - **Implement shutdown(signal: string) method** exactly as shown in design.md:
     - Log shutdown_initiated with signal
     - Set this.running = false to stop new cycles
     - **Wait for this.currentCyclePromise** if in-flight
     - Use Promise.race() with **5 minute timeout**: `Promise.race([this.currentCyclePromise, sleep(5 * 60 * 1000)])`
     - Close DB connections via this.db.close()
     - Log shutdown_complete
     - Exit with process.exit(0)
   - Track **this.currentCyclePromise** in runCycle() for graceful wait
   - Update start() to save each cycle promise to this.currentCyclePromise

**Files**:
- `ai-agents-responder/src/index.ts` - Modify - Add graceful shutdown

**Done when**:
- shutdown() method matches design.md implementation
- SIGTERM/SIGINT triggers shutdown with signal name
- Current cycle completes before exit (or 5min timeout)
- Promise.race prevents infinite wait
- DB connections closed via db.close()
- Process exits with code 0
- Logs show shutdown_initiated and shutdown_complete events

**Verify**:
```bash
cd ai-agents-responder && timeout 5 bun src/index.ts & sleep 2 && kill -SIGTERM $! && wait $!
```

**Commit**:
```
refactor(ai-agents): implement graceful shutdown
```

_Requirements: NFR-2_
_Design: Graceful Shutdown Design (design.md), shutdown() implementation_

---

### Task 2.11: Daily reset - rate limit counter [x]

**Do**:
1. Update `src/database.ts`:
   - Add resetDailyCountIfNeeded()
   - Check if daily_reset_at < now
   - If past midnight UTC:
     - Reset daily_count = 0
     - Set daily_reset_at = next midnight UTC
   - Call this before getRateLimitState()

**Files**:
- `ai-agents-responder/src/database.ts` - Modify - Add daily reset logic

**Done when**:
- Counter resets at midnight UTC
- Reset tracked in daily_reset_at
- Resets only when needed (not every call)

**Verify**:
```bash
cd ai-agents-responder && bun run tsc --noEmit
```

**Commit**:
```
refactor(ai-agents): add automatic daily rate limit reset
```

_Requirements: FR-9, AC-5.1_
_Design: Database Operations_

---

### Task 2.12: [VERIFY] Quality checkpoint [x]

**Do**: Type check refactored code

**Verify**:
```bash
cd ai-agents-responder && bun run tsc --noEmit
```

**Done when**: No type errors

**Commit**: `chore(ai-agents): pass quality checkpoint` (if fixes needed)

---

## Phase 3: Testing

Add comprehensive test coverage (unit, integration, E2E per user request).

### Task 3.1: Unit tests - config validation [x]

**Do**:
1. Create `src/__tests__/config.test.ts`:
   - Test valid config loads
   - Test missing MANUS_API_KEY fails
   - Test XOR auth validation (cookieSource vs manual tokens)
   - Test numeric range validation (MANUS_TIMEOUT_MS)
   - Test rate limit sanity check (maxReplies * minGap < 1440)
   - Test maskSecrets() hides credentials
   - Target: 100% coverage of validation logic

**Files**:
- `ai-agents-responder/src/__tests__/config.test.ts` - Create - Config unit tests

**Done when**:
- All validation rules tested
- Error messages verified
- Masking works correctly
- Tests pass

**Verify**:
```bash
cd ai-agents-responder && bun test src/__tests__/config.test.ts
```

**Commit**:
```
test(ai-agents): add config validation unit tests
```

_Requirements: Configuration Schema_
_Design: Config Manager_

---

### Task 3.2: Unit tests - filter pipeline [x]

**Do**:
1. Create `src/__tests__/filter.test.ts`:
   - Test content length filter (>100 chars)
   - Test recency filter (<30 min)
   - Test language filter (lang=en)
   - Test retweet filter (isRetweet=false)
   - Test deduplication (hasRepliedToTweet)
   - Test per-author limit (getRepliesForAuthorToday)
   - Test follower count filter (cache hit/miss)
   - Test rate limit checks (daily, gap, per-author)
   - Use mocked DB and Bird client
   - Target: 90% coverage

**Files**:
- `ai-agents-responder/src/__tests__/filter.test.ts` - Create - Filter unit tests

**Done when**:
- All filter stages tested
- Rejection reasons verified
- Cache hit/miss logic tested
- Tests pass

**Verify**:
```bash
cd ai-agents-responder && bun test src/__tests__/filter.test.ts
```

**Commit**:
```
test(ai-agents): add filter pipeline unit tests
```

_Requirements: FR-2 through FR-10_
_Design: Filter Pipeline_

---

### Task 3.3: [VERIFY] Quality checkpoint [x]

**Do**: Run all tests and type check

**Verify**:
```bash
cd ai-agents-responder && bun test && bun run tsc --noEmit
```

**Done when**: All tests pass, no type errors

**Commit**: `chore(ai-agents): pass quality checkpoint` (if fixes needed)

---

### Task 3.4: Unit tests - reply templates [x]

**Do**:
1. Create `src/__tests__/reply-templates.test.ts`:
   - Test selectTemplate returns valid template
   - Test buildReplyText replaces {username}
   - Test attribution added ~50% (run 100 times, verify 40-60%)
   - Test length validation (<280 chars)
   - Test length validation throws on overflow
   - Target: 100% coverage

**Files**:
- `ai-agents-responder/src/__tests__/reply-templates.test.ts` - Create - Template unit tests

**Done when**:
- Template selection tested
- Username replacement tested
- Attribution probability verified
- Length checks tested
- Tests pass

**Verify**:
```bash
cd ai-agents-responder && bun test src/__tests__/reply-templates.test.ts
```

**Commit**:
```
test(ai-agents): add reply template unit tests
```

_Requirements: FR-15, Reply Text Templates_
_Design: ReplyTemplateManager_

---

### Task 3.5: Unit tests - database operations [x]

**Do**:
1. Create `src/__tests__/database.test.ts`:
   - Use in-memory SQLite (`:memory:`)
   - Test initDatabase creates all tables
   - Test hasRepliedToTweet query
   - Test getRepliesForAuthorToday counts
   - Test getRateLimitState returns correct structure
   - Test recordReply inserts log entry
   - Test author cache upsert
   - Test circuit breaker state updates
   - Target: 80% coverage

**Files**:
- `ai-agents-responder/src/__tests__/database.test.ts` - Create - Database unit tests

**Done when**:
- All core queries tested
- Schema creation verified
- In-memory DB works for tests
- Tests pass

**Verify**:
```bash
cd ai-agents-responder && bun test src/__tests__/database.test.ts
```

**Commit**:
```
test(ai-agents): add database operations unit tests
```

_Requirements: FR-17, Database Schema_
_Design: Database component_

---

### Task 3.6: [VERIFY] Quality checkpoint [x]

**Do**: Run all unit tests

**Verify**:
```bash
cd ai-agents-responder && bun test
```

**Done when**: All unit tests pass

**Commit**: `chore(ai-agents): pass quality checkpoint` (if fixes needed)

---

### Task 3.7: Integration tests - database + filter [x]

**Do**:
1. Create `src/__tests__/integration/filter-db.test.ts`:
   - Use real in-memory SQLite
   - Test full filter pipeline with DB:
     - Insert replied tweet, verify deduplication
     - Insert author cache, verify follower filter
     - Set rate limits, verify enforcement
   - Test cache TTL (24h expiration)
   - Test daily reset logic

**Files**:
- `ai-agents-responder/src/__tests__/integration/filter-db.test.ts` - Create - Filter+DB integration test

**Done when**:
- Filter works with real DB queries
- All filter stages integrated
- Cache and rate limits verified
- Tests pass

**Verify**:
```bash
cd ai-agents-responder && bun test src/__tests__/integration/filter-db.test.ts
```

**Commit**:
```
test(ai-agents): add filter+DB integration tests
```

_Requirements: FR-7, FR-8, FR-9, FR-10_
_Design: Filter Pipeline + Database_

---

### Task 3.8: Integration tests - Manus client (if API key available) [x]

**Do**:
1. Create `src/__tests__/integration/manus.test.ts`:
   - **If MANUS_API_KEY available**:
     - Test createTask with simple prompt
     - Test pollTask waits for completion
     - Test downloadPdf returns PDF bytes
     - Test timeout handling (mock slow response)
   - **If no API key**: Skip test with message
   - Use real Manus API (not mocked)

**Files**:
- `ai-agents-responder/src/__tests__/integration/manus.test.ts` - Create - Manus integration test

**Done when**:
- Real Manus API calls work (if key available)
- Timeout logic tested
- Test skips gracefully if no key
- Tests pass

**Verify**:
```bash
cd ai-agents-responder && bun test src/__tests__/integration/manus.test.ts
```

**Commit**:
```
test(ai-agents): add Manus API integration tests
```

_Requirements: FR-11, AC-6.1 through AC-6.5_
_Design: ManusClient_

---

### Task 3.9: [VERIFY] Quality checkpoint [x]

**Do**: Run all integration tests

**Verify**:
```bash
cd ai-agents-responder && bun test src/__tests__/integration/
```

**Done when**: All integration tests pass

**Commit**: `chore(ai-agents): pass quality checkpoint` (if fixes needed)

---

### Task 3.10: E2E test - full pipeline with mocks [x]

**Do**:
1. Create `src/__tests__/e2e/full-pipeline.test.ts`:
   - Mock Bird search to return sample tweets
   - Mock Bird getUserByScreenName for follower counts
   - Mock Manus API (createTask, pollTask, downloadPdf)
   - Provide sample PDF bytes
   - Mock PDF converter to return PNG bytes
   - Mock Bird uploadMedia and reply
   - Run full cycle:
     - Search → Filter → Generate → Reply → Record
   - Verify DB entries created
   - Verify all components called
   - Test in dry-run mode

**Files**:
- `ai-agents-responder/src/__tests__/e2e/full-pipeline.test.ts` - Create - E2E test with mocks

**Done when**:
- Full pipeline executes with mocks
- All stages verified
- DB state correct after cycle
- Tests pass

**Verify**:
```bash
cd ai-agents-responder && bun test src/__tests__/e2e/full-pipeline.test.ts
```

**Commit**:
```
test(ai-agents): add E2E pipeline test with mocks
```

_Requirements: All FRs, US-1 through US-11_
_Design: Data Flow_

---

### Task 3.11: E2E test - real Twitter search (if Bird credentials available) [x]

**Do**:
1. Create `src/__tests__/e2e/real-twitter.test.ts`:
   - **If BIRD_COOKIE_SOURCE or AUTH_TOKEN available**:
     - Initialize real Bird client
     - Search for "AI agents -is:retweet lang:en"
     - Verify results parse correctly
     - Verify TweetCandidate mapping works
     - Do NOT post replies (read-only test)
   - **If no credentials**: Skip test with message

**Files**:
- `ai-agents-responder/src/__tests__/e2e/real-twitter.test.ts` - Create - Real Twitter E2E test

**Done when**:
- Real Bird search works (if credentials available)
- Results mapped to TweetCandidate
- Test is read-only (no posting)
- Test skips gracefully if no credentials
- Tests pass

**Verify**:
```bash
cd ai-agents-responder && bun test src/__tests__/e2e/real-twitter.test.ts
```

**Commit**:
```
test(ai-agents): add real Twitter search E2E test
```

_Requirements: FR-1, AC-1.1 through AC-1.5_
_Design: Poller component_

---

### Task 3.12: [VERIFY] Quality checkpoint [x]

**Do**: Run complete test suite

**Verify**:
```bash
cd ai-agents-responder && bun test
```

**Done when**: All tests pass (unit + integration + E2E)

**Commit**: `chore(ai-agents): pass quality checkpoint` (if fixes needed)

---

## Phase 4: Quality Gates

### Task 4.1: Linting setup - Biome and Oxlint

**Do**:
1. Copy `biome.json` from bird root to ai-agents-responder/
2. Update package.json scripts:
   - lint: Run both Biome and Oxlint
   - lint:biome: `biome check src/`
   - lint:oxlint: `oxlint src/`
   - lint:fix: `biome check --write src/`
   - format: `biome format --write src/`
3. Run lint:fix to auto-fix issues
4. Document any remaining manual fixes needed

**Files**:
- `ai-agents-responder/biome.json` - Create - Biome config
- `ai-agents-responder/package.json` - Modify - Add lint scripts

**Done when**:
- Biome and Oxlint configured
- All auto-fixable issues resolved
- Linting passes

**Verify**:
```bash
cd ai-agents-responder && bun run lint
```

**Commit**:
```
chore(ai-agents): configure Biome and Oxlint
```

_Requirements: NFR-11_
_Design: Existing Patterns - Code Style_

---

### Task 4.2: Type checking - strict mode validation

**Do**:
1. Ensure tsconfig.json has strict: true
2. Run type check on all files
3. Fix any type errors:
   - Add explicit return types
   - Fix any implicit any
   - Resolve strict null checks
4. Add `check-types` script to package.json

**Files**:
- `ai-agents-responder/tsconfig.json` - Modify - Verify strict mode
- `ai-agents-responder/package.json` - Modify - Add check-types script

**Done when**:
- All files pass strict type checking
- No implicit any
- No type errors

**Verify**:
```bash
cd ai-agents-responder && bun run check-types
```

**Commit**:
```
chore(ai-agents): enable strict type checking
```

_Design: Technical Decisions - TypeScript Patterns_

---

### Task 4.3: [VERIFY] Full local CI - all quality checks

**Do**: Run complete local CI suite

**Verify**:
```bash
cd ai-agents-responder && bun run lint && bun run check-types && bun test
```

**Done when**: All commands pass

**Commit**: `chore(ai-agents): pass full local CI` (if fixes needed)

---

### Task 4.4: README - setup and usage documentation

**Do**:
1. Create `ai-agents-responder/README.md`:
   - Project overview and goal
   - Prerequisites (Bun, credentials)
   - Setup instructions:
     - Clone, install dependencies
     - Copy .env.example to .env
     - Configure credentials (BIRD_COOKIE_SOURCE or manual tokens)
     - Configure MANUS_API_KEY
     - Run seed-db script
   - Usage:
     - Dry-run mode testing
     - Production mode
   - Architecture overview (link to design.md)
   - Troubleshooting common issues
   - Links to specs/ directory

**Files**:
- `ai-agents-responder/README.md` - Create - Project documentation

**Done when**:
- README covers all setup steps
- Usage examples clear
- Troubleshooting section helpful

**Verify**:
```bash
cd ai-agents-responder && cat README.md | grep "## Setup"
```

**Commit**:
```
docs(ai-agents): add comprehensive README
```

_Requirements: Success Criteria_
_Design: File Structure_

---

### Task 4.5: Create PR with passing CI

**Do**:
1. Verify current branch is feature branch: `git branch --show-current`
2. Push branch: `git push -u origin ai-agents-implementation`
3. Create PR using gh CLI:
   ```bash
   gh pr create --title "feat(ai-agents): Twitter auto-responder with AI summaries" --body "$(cat <<'EOF'
   ## Summary
   - Standalone application monitoring Twitter for AI agent posts by 50K+ influencers
   - Automated PDF summary generation via Manus API
   - PNG conversion and reply posting within 5-minute window
   - Conservative rate limits prevent spam detection (10-15/day, 10min gaps)
   - SQLite state management for deduplication and rate limiting
   - Comprehensive test coverage (unit, integration, E2E)

   ## Test Plan
   - [x] Unit tests pass (config, filters, templates, database)
   - [x] Integration tests pass (filter+DB, Manus API)
   - [x] E2E tests pass (full pipeline, real Twitter search)
   - [x] Lint and type check pass
   - [x] Dry-run mode tested locally
   - [ ] Production mode tested with real credentials (manual)

   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   EOF
   )"
   ```
4. If gh CLI unavailable, provide URL for manual PR creation

**Verify**:
```bash
gh pr checks --watch
```

**Done when**:
- PR created successfully
- All CI checks pass (lint, types, tests)
- PR ready for review

**If CI fails**:
1. Read failure: `gh pr checks`
2. Fix locally
3. Push: `git push`
4. Re-verify: `gh pr checks --watch`

**Commit**: None (PR creation only)

_Requirements: All FRs and NFRs_
_Design: Complete implementation_

---

## Notes

**POC shortcuts taken**:
- Hardcoded search query and result count in early tasks
- Skipped follower count and rate limit checks initially
- No retry logic or circuit breaker in POC
- Minimal error handling in POC

**Production TODOs addressed in Phase 2**:
- Full filter pipeline (all 4 stages)
- Retry logic with exponential backoff
- Circuit breaker for Manus failures
- Comprehensive error handling
- Graceful shutdown
- Daily rate limit reset

**Testing philosophy**:
- Unit tests: Mock external dependencies, test logic in isolation
- Integration tests: Real DB (in-memory), real-ish interactions
- E2E tests: Full pipeline with mocks + optional real API tests
- Dry-run mode: Safe production validation without posting

**Quality gates**:
- Lint: Biome + Oxlint (from bird patterns)
- Types: Strict TypeScript, no implicit any
- Tests: Comprehensive coverage (unit + integration + E2E per user request)
- CI: GitHub Actions (inherits from bird if available)

**End-to-end validation strategy**:
- POC Phase (Task 1.23): Manual E2E script tests full pipeline in dry-run mode
- Testing Phase (Task 3.10-3.12): Automated E2E tests with mocks and optional real API calls
- All E2E tests verify actual external systems when credentials available:
  - Real Manus API calls to validate PDF generation
  - Real Twitter searches to validate Bird integration
  - Browser automation NOT used (command-line focused per project nature)
