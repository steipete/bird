#!/usr/bin/env node

/**
 * bird - CLI tool for posting tweets and replies
 *
 * Usage:
 *   bird tweet "Hello world!"
 *   bird reply <tweet-id> "This is a reply"
 *   bird reply <tweet-url> "This is a reply"
 *   bird read <tweet-id-or-url>
 *   bird --mcp  (start MCP server)
 */

import { createProgram, KNOWN_COMMANDS } from './cli/program.js';
import { createCliContext } from './cli/shared.js';
import { resolveCliInvocation } from './lib/cli-args.js';

const rawArgs: string[] = process.argv.slice(2);

// Check for MCP mode before anything else
if (rawArgs.includes('--mcp') || rawArgs.includes('-mcp')) {
  import('./mcp/index.js').catch((err) => {
    console.error('Failed to start MCP server:', err);
    process.exit(1);
  });
} else {

const normalizedArgs: string[] = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;

const ctx = createCliContext(normalizedArgs);

const program = createProgram(ctx);

const { argv, showHelp } = resolveCliInvocation(normalizedArgs, KNOWN_COMMANDS);

if (showHelp) {
  program.outputHelp();
  process.exit(0);
}

if (argv) {
  program.parse(argv);
} else {
  program.parse(['node', 'bird', ...normalizedArgs]);
}

} // end MCP else block
