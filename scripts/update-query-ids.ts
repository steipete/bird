#!/usr/bin/env tsx
/**
 * Fetches current Twitter/X GraphQL query IDs from public client bundles and
 * updates src/lib/query-ids.json.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const TARGET_OPERATIONS = [
  'CreateTweet',
  'CreateRetweet',
  'FavoriteTweet',
  'DeleteBookmark',
  'TweetDetail',
  'SearchTimeline',
  'Bookmarks',
  'BookmarkFolderTimeline',
  'Following',
  'Followers',
  'Likes',
  'ExploreSidebar',
  'ExplorePage',
  'GenericTimelineById',
  'TrendHistory',
] as const;

type OperationName = (typeof TARGET_OPERATIONS)[number];

const DISCOVERY_PAGES = [
  'https://x.com/?lang=en',
  'https://x.com/explore',
  'https://x.com/notifications',
  'https://x.com/settings/profile',
];

const BUNDLE_URL_REGEX =
  /https:\/\/abs\.twimg\.com\/responsive-web\/client-web(?:-legacy)?\/[A-Za-z0-9.-]+\.js/g;

const OPERATION_PATTERNS = [
  // Modern bundles export operations like:
  //   e.exports={queryId:"...",operationName:"CreateTweet",operationType:"mutation",...}
  {
    regex: /e\.exports=\{queryId\s*:\s*["']([^"']+)["']\s*,\s*operationName\s*:\s*["']([^"']+)["']/gs,
    operationGroup: 2,
    queryIdGroup: 1,
  },
  {
    regex: /e\.exports=\{operationName\s*:\s*["']([^"']+)["']\s*,\s*queryId\s*:\s*["']([^"']+)["']/gs,
    operationGroup: 1,
    queryIdGroup: 2,
  },
  {
    regex: /operationName\s*[:=]\s*["']([^"']+)["'](.{0,4000}?)queryId\s*[:=]\s*["']([^"']+)["']/gs,
    operationGroup: 1,
    queryIdGroup: 3,
  },
  {
    regex: /queryId\s*[:=]\s*["']([^"']+)["'](.{0,4000}?)operationName\s*[:=]\s*["']([^"']+)["']/gs,
    operationGroup: 3,
    queryIdGroup: 1,
  },
] as const;

const QUERY_IDS_PATH = path.resolve(process.cwd(), 'src/lib/query-ids.json');
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

interface DiscoveredOperation {
  queryId: string;
  bundle: string;
}

async function readExistingIds(): Promise<Record<OperationName, string>> {
  try {
    const contents = await fs.readFile(QUERY_IDS_PATH, 'utf8');
    const parsed = JSON.parse(contents) as Record<string, string>;
    const result: Partial<Record<OperationName, string>> = {};
    for (const op of TARGET_OPERATIONS) {
      if (typeof parsed[op] === 'string' && parsed[op].trim().length > 0) {
        result[op] = parsed[op].trim();
      }
    }
    return result as Record<OperationName, string>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[warn] Failed to read existing query IDs:', error);
    }
    return {} as Record<OperationName, string>;
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} for ${url}: ${body.slice(0, 120)}`);
  }
  return response.text();
}

async function discoverBundles(): Promise<string[]> {
  const bundles = new Set<string>();
  for (const page of DISCOVERY_PAGES) {
    try {
      const html = await fetchText(page);
      for (const match of html.matchAll(BUNDLE_URL_REGEX)) {
        bundles.add(match[0]);
      }
    } catch (error) {
      console.warn(`[warn] Could not fetch ${page}:`, error instanceof Error ? error.message : error);
    }
  }

  const discovered = Array.from(bundles);
  if (discovered.length === 0) {
    throw new Error('No client bundles discovered; x.com layout may have changed.');
  }
  return discovered;
}

function extractOperations(
  bundleContents: string,
  bundleLabel: string,
  targets: Set<OperationName>,
  discovered: Map<OperationName, DiscoveredOperation>,
): void {
  for (const pattern of OPERATION_PATTERNS) {
    pattern.regex.lastIndex = 0; // reset stateful regex
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(bundleContents)) !== null) {
      const operationName = match[pattern.operationGroup];
      const queryId = match[pattern.queryIdGroup];
      if (!operationName || !queryId) continue;

      if (!targets.has(operationName as OperationName)) continue;
      if (!/^[a-zA-Z0-9_-]+$/.test(queryId)) continue;
      const op = operationName as OperationName;
      if (discovered.has(op)) continue;
      discovered.set(op, { queryId, bundle: bundleLabel });
      if (discovered.size === targets.size) {
        return;
      }
    }
  }
}

async function fetchAndExtract(
  bundleUrls: string[],
  targets: Set<OperationName>,
): Promise<Map<OperationName, DiscoveredOperation>> {
  const discovered = new Map<OperationName, DiscoveredOperation>();
  const CONCURRENCY = 6;

  for (let i = 0; i < bundleUrls.length; i += CONCURRENCY) {
    const chunk = bundleUrls.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (url) => {
        if (discovered.size === targets.size) {
          return;
        }
        const label = url.split('/').at(-1) ?? url;
        try {
          const js = await fetchText(url);
          extractOperations(js, label, targets, discovered);
        } catch (error) {
          console.warn(`[warn] Failed to scan ${label}:`, error instanceof Error ? error.message : error);
        }
      }),
    );
    if (discovered.size === targets.size) {
      break;
    }
  }

  return discovered;
}

async function writeIds(ids: Record<OperationName, string>): Promise<void> {
  const ordered: Record<OperationName, string> = {} as Record<OperationName, string>;
  for (const op of TARGET_OPERATIONS) {
    if (ids[op]) {
      ordered[op] = ids[op];
    }
  }
  const json = `${JSON.stringify(ordered, null, 2)}\n`;
  await fs.mkdir(path.dirname(QUERY_IDS_PATH), { recursive: true });
  await fs.writeFile(QUERY_IDS_PATH, json, 'utf8');
}

async function main(): Promise<void> {
  console.log('[info] Discovering Twitter/X client bundles…');
  const bundleUrls = await discoverBundles();
  console.log(`[info] Found ${bundleUrls.length} bundles`);

  const targets = new Set<OperationName>(TARGET_OPERATIONS);
  const existing = await readExistingIds();

  const discovered = await fetchAndExtract(bundleUrls, targets);
  if (discovered.size === 0) {
    throw new Error('No query IDs discovered; extraction patterns may need an update.');
  }

  const nextIds: Record<OperationName, string> = { ...existing };
  for (const op of TARGET_OPERATIONS) {
    const found = discovered.get(op);
    if (found?.queryId) {
      nextIds[op] = found.queryId;
    }
  }

  await writeIds(nextIds);

  for (const op of TARGET_OPERATIONS) {
    const previous = existing[op];
    const current = nextIds[op];
    const source = discovered.get(op)?.bundle ?? 'existing file';
    if (previous && current && previous !== current) {
      console.log(`✅ ${op}: ${previous} → ${current} (${source})`);
    } else if (current) {
      console.log(`✅ ${op}: ${current} (${source})`);
    } else {
      console.warn(`⚠️  ${op}: not found (kept previous value if present)`);
    }
  }

  console.log(`[info] Updated ${QUERY_IDS_PATH}`);
}

main().catch((error) => {
  console.error('[error]', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
