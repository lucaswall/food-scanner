#!/usr/bin/env npx tsx

/**
 * MCP Server for read-only Fitbit API access
 * OAuth 2.0 with file-based token storage (~/.config/mcp-fitbit/tokens.json)
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env from parent directory (food-scanner project root)
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env.local') });

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { tools } from './tools/index.js';

const server = new Server(
  {
    name: 'mcp-fitbit',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: tools.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })),
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = tools.find((t) => t.name === request.params.name);

  if (!tool) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  }

  const result = await tool.handler(request.params.arguments as never);
  return {
    content: result.content,
    isError: result.isError,
  };
});

async function main() {
  try {
    // Validate env vars are present (will error on first tool call if missing)
    const hasCredentials =
      process.env.FITBIT_CLIENT_ID && process.env.FITBIT_CLIENT_SECRET;
    if (!hasCredentials) {
      console.error(
        'Warning: FITBIT_CLIENT_ID and/or FITBIT_CLIENT_SECRET not set. ' +
          'Authentication will fail until these are configured.',
      );
    }

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('mcp-fitbit server running on stdio');
  } catch (error) {
    console.error('Failed to start mcp-fitbit:', error);
    process.exit(1);
  }
}

main();
