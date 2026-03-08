import { describe, it, expect, beforeEach } from "vitest";
import { AuthService } from "@agentbond/auth";
import { handleToolCall } from "../src/handlers.js";

describe("MCP Tool Handlers", () => {
  let service: AuthService;

  const futureExpiry = "2099-01-01T00:00:00Z";
  const now = "2026-03-08T00:00:00Z";

  beforeEach(() => {
    service = new AuthService();
  });

  describe("agentbond_issue_token", () => {
    it("issues a root token", async () => {
      const result = await handleToolCall(service, "agentbond_issue_token", {
        id: "token-1",
        issuedBy: { id: "human-1", type: "human" },
        issuedTo: { id: "agent-1", type: "ai" },
        scopes: [{ domain: "api.stripe.com", operations: ["read"] }],
        budget: { limit: "1000", currency: "credits" },
        expiry: futureExpiry,
      });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text);
      expect(data.id).toBe("token-1");
      expect(data.status).toBe("active");
    });

    it("rejects child token with wider scope", async () => {
      await handleToolCall(service, "agentbond_issue_token", {
        id: "parent",
        issuedBy: { id: "human-1", type: "human" },
        issuedTo: { id: "agent-1", type: "ai" },
        scopes: [{ domain: "api.stripe.com", operations: ["read"] }],
        budget: { limit: "1000", currency: "credits" },
        expiry: futureExpiry,
      });

      const result = await handleToolCall(service, "agentbond_issue_token", {
        id: "child",
        parentTokenId: "parent",
        issuedBy: { id: "agent-1", type: "ai" },
        issuedTo: { id: "agent-2", type: "ai" },
        scopes: [
          { domain: "api.stripe.com", operations: ["read", "write"] },
        ],
        budget: { limit: "500", currency: "credits" },
        expiry: futureExpiry,
      });
      expect(result.isError).toBe(true);
    });
  });

  describe("agentbond_evaluate_action", () => {
    it("allows a valid action", async () => {
      await handleToolCall(service, "agentbond_issue_token", {
        id: "token-1",
        issuedBy: { id: "human-1", type: "human" },
        issuedTo: { id: "agent-1", type: "ai" },
        scopes: [{ domain: "api.stripe.com", operations: ["read"] }],
        budget: { limit: "1000", currency: "credits" },
        expiry: futureExpiry,
      });

      const result = await handleToolCall(
        service,
        "agentbond_evaluate_action",
        {
          tokenId: "token-1",
          action: {
            id: "action-1",
            actor: { id: "agent-1", type: "ai" },
            scope: { domain: "api.stripe.com", operations: ["read"] },
            timestamp: now,
          },
          amount: "10",
        },
      );
      const data = JSON.parse(result.content[0]!.text);
      expect(data.allowed).toBe(true);
      expect(data.reasonCode).toBe("ALLOWED");
    });

    it("denies scope mismatch", async () => {
      await handleToolCall(service, "agentbond_issue_token", {
        id: "token-1",
        issuedBy: { id: "human-1", type: "human" },
        issuedTo: { id: "agent-1", type: "ai" },
        scopes: [{ domain: "api.stripe.com", operations: ["read"] }],
        budget: { limit: "1000", currency: "credits" },
        expiry: futureExpiry,
      });

      const result = await handleToolCall(
        service,
        "agentbond_evaluate_action",
        {
          tokenId: "token-1",
          action: {
            id: "action-2",
            actor: { id: "agent-1", type: "ai" },
            scope: { domain: "api.paypal.com", operations: ["read"] },
            timestamp: now,
          },
          amount: "10",
        },
      );
      const data = JSON.parse(result.content[0]!.text);
      expect(data.allowed).toBe(false);
      expect(data.reasonCode).toBe("SCOPE_MISMATCH");
    });
  });

  describe("token status management", () => {
    beforeEach(async () => {
      await handleToolCall(service, "agentbond_issue_token", {
        id: "token-1",
        issuedBy: { id: "human-1", type: "human" },
        issuedTo: { id: "agent-1", type: "ai" },
        scopes: [{ domain: "api.stripe.com", operations: ["read"] }],
        budget: { limit: "1000", currency: "credits" },
        expiry: futureExpiry,
      });
    });

    it("revokes a token", async () => {
      const result = await handleToolCall(
        service,
        "agentbond_revoke_token",
        { tokenId: "token-1" },
      );
      const data = JSON.parse(result.content[0]!.text);
      expect(data.ok).toBe(true);
      expect(data.status).toBe("revoked");
    });

    it("suspends and reactivates a token", async () => {
      await handleToolCall(service, "agentbond_suspend_token", {
        tokenId: "token-1",
      });
      let token = JSON.parse(
        (
          await handleToolCall(service, "agentbond_get_token", {
            tokenId: "token-1",
          })
        ).content[0]!.text,
      );
      expect(token.status).toBe("suspended");

      await handleToolCall(service, "agentbond_reactivate_token", {
        tokenId: "token-1",
      });
      token = JSON.parse(
        (
          await handleToolCall(service, "agentbond_get_token", {
            tokenId: "token-1",
          })
        ).content[0]!.text,
      );
      expect(token.status).toBe("active");
    });
  });

  describe("agentbond_get_token", () => {
    it("returns error for non-existent token", async () => {
      const result = await handleToolCall(service, "agentbond_get_token", {
        tokenId: "nonexistent",
      });
      expect(result.isError).toBe(true);
    });
  });

  describe("audit tools", () => {
    beforeEach(async () => {
      await handleToolCall(service, "agentbond_issue_token", {
        id: "token-1",
        issuedBy: { id: "human-1", type: "human" },
        issuedTo: { id: "agent-1", type: "ai" },
        scopes: [{ domain: "api.stripe.com", operations: ["read"] }],
        budget: { limit: "1000", currency: "credits" },
        expiry: futureExpiry,
      });

      await handleToolCall(service, "agentbond_evaluate_action", {
        tokenId: "token-1",
        action: {
          id: "action-1",
          actor: { id: "agent-1", type: "ai" },
          scope: { domain: "api.stripe.com", operations: ["read"] },
          timestamp: now,
        },
        amount: "10",
      });
    });

    it("returns audit log", async () => {
      const result = await handleToolCall(
        service,
        "agentbond_get_audit_log",
        {},
      );
      const data = JSON.parse(result.content[0]!.text);
      expect(data).toHaveLength(1);
      expect(data[0].outcome).toBe("allowed");
    });

    it("returns audit by action ID", async () => {
      const result = await handleToolCall(
        service,
        "agentbond_get_audit_by_action",
        { actionId: "action-1" },
      );
      const data = JSON.parse(result.content[0]!.text);
      expect(data).toHaveLength(1);
    });

    it("returns audit by token ID", async () => {
      const result = await handleToolCall(
        service,
        "agentbond_get_audit_by_token",
        { tokenId: "token-1" },
      );
      const data = JSON.parse(result.content[0]!.text);
      expect(data).toHaveLength(1);
    });
  });

  it("returns error for unknown tool", async () => {
    const result = await handleToolCall(service, "unknown_tool", {});
    expect(result.isError).toBe(true);
  });
});
