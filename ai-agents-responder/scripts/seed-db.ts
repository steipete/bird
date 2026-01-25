#!/usr/bin/env bun
/**
 * Seed Database Script
 *
 * Populates the author_cache table with known AI influencers from seed-authors.json.
 * Can be run multiple times safely (uses upsert).
 *
 * Usage: bun scripts/seed-db.ts
 */

import { initDatabase } from '../src/database.js';
import type { SeedAuthor } from '../src/types.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  // Load seed authors from JSON
  const seedPath = join(__dirname, '../data/seed-authors.json');
  let authors: SeedAuthor[];

  try {
    const content = readFileSync(seedPath, 'utf-8');
    authors = JSON.parse(content) as SeedAuthor[];
  } catch (error) {
    console.error(`Failed to read seed-authors.json: ${(error as Error).message}`);
    process.exit(1);
  }

  // Validate seed data
  if (!Array.isArray(authors) || authors.length === 0) {
    console.error('seed-authors.json must contain a non-empty array');
    process.exit(1);
  }

  console.log(`Loaded ${authors.length} authors from seed-authors.json`);

  // Get database path from env or use default
  const dbPath = process.env.DATABASE_PATH || './data/responder.db';
  console.log(`Using database: ${dbPath}`);

  // Initialize database
  const db = await initDatabase();

  // Seed authors
  try {
    await db.seedAuthorsFromJson(authors);
    console.log(`Successfully seeded ${authors.length} authors into author_cache`);
  } catch (error) {
    console.error(`Failed to seed authors: ${(error as Error).message}`);
    process.exit(1);
  }

  // Close database
  await db.close();
  console.log('Database closed');
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
