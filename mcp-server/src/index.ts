#!/usr/bin/env node

import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AuthService } from "@agentbond/auth";
import { TOOL_DEFINITIONS } from "./tools.js";
import { handleToolCall } from "./handlers.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const service = new AuthService();

const server = new McpServer({
  name: "agentbond",
  version: pkg.version,
});

// Register all tools
for (const tool of TOOL_DEFINITIONS) {
  server.tool(
    tool.name,
    tool.description,
    tool.inputSchema.shape,
    async (args: Record<string, unknown>) => {
      return handleToolCall(service, tool.name, args);
    },
  );
}

// Start server with stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

export { service, server };
