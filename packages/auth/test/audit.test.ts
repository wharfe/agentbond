import { describe, it, expect, beforeEach } from "vitest";
import type {
  AuthorizationToken,
  AgentIdentity,
  AgentAction,
  AuthorizationDecision,
  AuditRecord,
} from "@agentbond/core";
import { AuthService } from "../src/index.js";

const futureExpiry = "2099-01-01T00:00:00Z";
const now = "2026-03-08T00:00:00Z";

const alice: AgentIdentity = { id: "alice-id", type: "human" };
const bob: AgentIdentity = { id: "bob-id", type: "ai" };

function makeRootToken(
  overrides?: Partial<AuthorizationToken>,
): AuthorizationToken {
  return {
    id: "token-root",
    issuedBy: alice,
    issuedTo: bob,
    scopes: [
      {
        domain: "api.stripe.com",
        operations: ["read", "write"],
        resources: ["/invoices/*"],
      },
    ],
    budget: { limit: "1000", currency: "credits" },
    expiry: futureExpiry,
    status: "active",
    ...overrides,
  };
}

function makeAction(overrides?: Partial<AgentAction>): AgentAction {
  return {
    id: "action-1",
    actor: bob,
    scope: {
      domain: "api.stripe.com",
      operations: ["read"],
      resources: ["/invoices/123"],
    },
    timestamp: now,
    ...overrides,
  };
}

describe("AuditRecord Integration", () => {
  let service: AuthService;

  beforeEach(() => {
    service = new AuthService();
  });

  it("records an audit entry for an allowed action", async () => {
    await service.issueToken(makeRootToken());
    await service.evaluateAndConsume("token-root", makeAction(), "10");

    const logs = await service.getAuditLog();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.actionId).toBe("action-1");
    expect(logs[0]!.authorizationTokenId).toBe("token-root");
    expect(logs[0]!.layer).toBe("authorization");
    expect(logs[0]!.outcome).toBe("allowed");
    expect(logs[0]!.reason).toBe("ALLOWED");
    // Timestamp is now server-generated, so just verify it's a valid ISO string
    expect(logs[0]!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("records an audit entry for a denied action", async () => {
    await service.issueToken(makeRootToken());
    const action = makeAction({
      id: "action-denied",
      scope: { domain: "api.paypal.com", operations: ["read"] },
    });
    await service.evaluateAndConsume("token-root", action, "10");

    const logs = await service.getAuditLog();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.outcome).toBe("denied");
    expect(logs[0]!.reason).toBe("SCOPE_MISMATCH");
  });

  it("findByActionId returns correct records", async () => {
    await service.issueToken(makeRootToken());
    await service.evaluateAndConsume(
      "token-root",
      makeAction({ id: "action-a" }),
      "10",
    );
    await service.evaluateAndConsume(
      "token-root",
      makeAction({ id: "action-b" }),
      "10",
    );

    const logsA = await service.getAuditByActionId("action-a");
    expect(logsA).toHaveLength(1);
    expect(logsA[0]!.actionId).toBe("action-a");

    const logsB = await service.getAuditByActionId("action-b");
    expect(logsB).toHaveLength(1);
    expect(logsB[0]!.actionId).toBe("action-b");
  });

  it("findByTokenId returns correct records", async () => {
    await service.issueToken(makeRootToken());
    await service.evaluateAndConsume("token-root", makeAction(), "10");

    const logs = await service.getAuditByTokenId("token-root");
    expect(logs).toHaveLength(1);
    expect(logs[0]!.authorizationTokenId).toBe("token-root");

    const empty = await service.getAuditByTokenId("nonexistent");
    expect(empty).toHaveLength(0);
  });

  it("list with filters works correctly", async () => {
    await service.issueToken(makeRootToken());

    // Allowed action
    await service.evaluateAndConsume(
      "token-root",
      makeAction({ id: "action-ok", timestamp: "2026-03-08T01:00:00Z" }),
      "10",
    );

    // Denied action (wrong domain)
    await service.evaluateAndConsume(
      "token-root",
      makeAction({
        id: "action-denied",
        scope: { domain: "other.com", operations: ["read"] },
        timestamp: "2026-03-08T02:00:00Z",
      }),
      "10",
    );

    // Filter by outcome
    const allowed = await service.getAuditLog({ outcome: "allowed" });
    expect(allowed).toHaveLength(1);
    expect(allowed[0]!.actionId).toBe("action-ok");

    const denied = await service.getAuditLog({ outcome: "denied" });
    expect(denied).toHaveLength(1);
    expect(denied[0]!.actionId).toBe("action-denied");

    // Filter by time range — use a far-future since to get no results
    const sinceResult = await service.getAuditLog({
      since: "2099-01-01T00:00:00Z",
    });
    expect(sinceResult).toHaveLength(0);

    // Filter by limit
    const limited = await service.getAuditLog({ limit: 1 });
    expect(limited).toHaveLength(1);

    // Filter by layer
    const authLogs = await service.getAuditLog({ layer: "authorization" });
    expect(authLogs).toHaveLength(2);

    const intentLogs = await service.getAuditLog({ layer: "intent" });
    expect(intentLogs).toHaveLength(0);
  });

  it("multiple actions create multiple audit records", async () => {
    await service.issueToken(makeRootToken());

    for (let i = 0; i < 5; i++) {
      await service.evaluateAndConsume(
        "token-root",
        makeAction({ id: `action-${i}` }),
        "10",
      );
    }

    const logs = await service.getAuditLog();
    expect(logs).toHaveLength(5);
    expect(logs.every((l) => l.layer === "authorization")).toBe(true);
  });
});
