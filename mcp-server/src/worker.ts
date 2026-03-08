import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { AuthService, InMemoryAuditRecordStore } from "@agentbond/auth";
import { IntentService } from "@agentbond/intent";
import { TOOL_DEFINITIONS } from "./tools.js";
import { handleToolCall, type ServiceDeps } from "./handlers.js";

const VERSION = "0.1.0";

function createWorkerServer(deps: ServiceDeps): McpServer {
  const server = new McpServer({
    name: "agentbond",
    version: VERSION,
  });

  for (const tool of TOOL_DEFINITIONS) {
    server.tool(
      tool.name,
      tool.description,
      tool.inputSchema.shape,
      async (args: Record<string, unknown>) => {
        return handleToolCall(deps, tool.name, args);
      },
    );
  }

  return server;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(
        JSON.stringify({ name: "agentbond", version: VERSION, status: "ok" }),
        { headers: { "content-type": "application/json" } },
      );
    }

    // MCP endpoint
    if (url.pathname === "/mcp") {
      // Stateless mode: create fresh server + transport per request
      const auditStore = new InMemoryAuditRecordStore();
      const deps: ServiceDeps = {
        authService: new AuthService({ auditStore }),
        intentService: new IntentService({ auditStore }),
      };
      const server = createWorkerServer(deps);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      return transport.handleRequest(request);
    }

    return new Response("Not found", { status: 404 });
  },
};
