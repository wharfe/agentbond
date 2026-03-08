import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { AuthService, InMemoryAuditRecordStore } from "@agentbond/auth";
import { IntentService } from "@agentbond/intent";
import { ContractService } from "@agentbond/contract";
import { TOOL_DEFINITIONS } from "./tools.js";
import { handleToolCall, type ServiceDeps } from "./handlers.js";

const VERSION = "0.1.0";

// Session store for MCP protocol (in-memory, per Worker isolate)
const sessions = new Map<
  string,
  { transport: WebStandardStreamableHTTPServerTransport; createdAt: number }
>();

// Clean up sessions older than 5 minutes
function cleanupSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > 5 * 60 * 1000) {
      sessions.delete(id);
    }
  }
}

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

function createSessionDeps(): ServiceDeps {
  const auditStore = new InMemoryAuditRecordStore();
  return {
    authService: new AuthService({ auditStore }),
    intentService: new IntentService({ auditStore }),
    contractService: new ContractService({ auditStore }),
  };
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

    // MCP server card for Smithery scanning
    if (
      url.pathname === "/.well-known/mcp/server-card.json" &&
      request.method === "GET"
    ) {
      const tools = TOOL_DEFINITIONS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: JSON.parse(JSON.stringify(t.inputSchema.shape)),
      }));
      return new Response(
        JSON.stringify({
          serverInfo: { name: "agentbond", version: VERSION },
          authentication: { required: false },
          tools,
          resources: [],
          prompts: [],
        }),
        { headers: { "content-type": "application/json" } },
      );
    }

    // MCP endpoint
    if (url.pathname === "/mcp") {
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      // Clone request so we can read body and still forward original
      const clonedReq = request.clone();
      let parsed: unknown;
      try {
        parsed = JSON.parse(await clonedReq.text());
      } catch {
        // Not JSON or unreadable — pass through to transport as-is
        const deps = createSessionDeps();
        const server = createWorkerServer(deps);
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        await server.connect(transport);
        return transport.handleRequest(request);
      }

      const msg = parsed as { method?: string };
      const isInitialize =
        msg.method === "initialize" ||
        msg.method === "notifications/initialized";

      if (isInitialize) {
        // Pass initialize requests through normally
        const deps = createSessionDeps();
        const server = createWorkerServer(deps);
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        await server.connect(transport);
        return transport.handleRequest(request);
      }

      // Non-initialize request: auto-initialize first, then handle
      const deps = createSessionDeps();
      const server = createWorkerServer(deps);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);

      const initReq = new Request(request.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 0,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "auto-init", version: "1.0.0" },
          },
        }),
      });
      await transport.handleRequest(initReq);

      const notifyReq = new Request(request.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
      });
      await transport.handleRequest(notifyReq);

      // Rebuild request with proper Accept header
      const actualReq = new Request(request.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(parsed),
      });
      return transport.handleRequest(actualReq);
    }

    return new Response("Not found", { status: 404 });
  },
};
