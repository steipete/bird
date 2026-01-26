#!/usr/bin/env node
/**
 * Bird MCP Server
 *
 * Exposes Twitter/X functionality via Model Context Protocol.
 * Users can add this MCP server to Cursor, Claude Desktop, or other MCP clients.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { resolveCredentials, TwitterClient, type TwitterClientOptions } from '../lib/index.js';
import { tools, toolHandlers } from './tools.js';

/**
 * Create and configure the MCP server
 */
async function createServer(): Promise<Server> {
  const server = new Server(
    {
      name: 'bird-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Cache Twitter client instance
  let cachedClient: TwitterClient | null = null;

  /**
   * Get or create Twitter client with credentials
   */
  async function getTwitterClient(): Promise<TwitterClient> {
    if (cachedClient) {
      return cachedClient;
    }

    // Resolve credentials from environment or browser cookies
    const result = await resolveCredentials({
      authToken: process.env.AUTH_TOKEN,
      ct0: process.env.CT0,
      cookieSource: process.env.COOKIE_SOURCE?.split(',') as Array<'safari' | 'chrome' | 'firefox'>,
      chromeProfile: process.env.CHROME_PROFILE,
      firefoxProfile: process.env.FIREFOX_PROFILE,
    });

    const { cookies } = result;

    if (!cookies.authToken || !cookies.ct0) {
      throw new Error(
        'Twitter credentials not found. Set AUTH_TOKEN and CT0 environment variables, ' +
          'or ensure browser cookies are available. Warnings: ' +
          result.warnings.join('; '),
      );
    }

    const options: TwitterClientOptions = {
      cookies: {
        authToken: cookies.authToken,
        ct0: cookies.ct0,
        cookieHeader: cookies.cookieHeader,
        source: cookies.source,
      },
      timeoutMs: Number(process.env.TIMEOUT_MS) || 30000,
      quoteDepth: Number(process.env.QUOTE_DEPTH) || 1,
    };

    cachedClient = new TwitterClient(options);
    return cachedClient;
  }

  // Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: tools as Tool[] };
  });

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const handler = toolHandlers[name];
    if (!handler) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    try {
      const client = await getTwitterClient();
      const result = await handler(client, args || {});
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Bird MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
