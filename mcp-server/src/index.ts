#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AuthService } from "@agentbond/auth";
import { TOOL_DEFINITIONS } from "./tools.js";
import { handleToolCall } from "./handlers.js";

// Version is kept in sync with package.json via changesets
const VERSION = "0.1.0";

/**
 * Create an agentbond MCP server instance with tools registered.
 */
export function createServer(service?: AuthService): McpServer {
  const svc = service ?? new AuthService();

  const server = new McpServer({
    name: "agentbond",
    version: VERSION,
  });

  // Register all tools
  for (const tool of TOOL_DEFINITIONS) {
    server.tool(
      tool.name,
      tool.description,
      tool.inputSchema.shape,
      async (args: Record<string, unknown>) => {
        return handleToolCall(svc, tool.name, args);
      },
    );
  }

  return server;
}

/**
 * Create a sandbox server for Smithery capability scanning.
 */
export function createSandboxServer(): McpServer {
  return createServer();
}

// Start server with stdio transport when run directly
const service = new AuthService();
const server = createServer(service);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

export { service, server };
