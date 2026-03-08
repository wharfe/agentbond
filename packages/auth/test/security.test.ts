import { describe, it, expect, beforeEach } from "vitest";
import type {
  AuthorizationToken,
  AgentIdentity,
  AgentAction,
  AuthorizationDecision,
} from "@agentbond/core";
import {
  AuthService,
  InMemoryTokenStore,
  InMemoryBudgetLedgerStore,
} from "../src/index.js";

const futureExpiry = "2099-01-01T00:00:00Z";
const now = "2026-03-08T00:00:00Z";

const alice: AgentIdentity = { id: "alice-id", type: "human" };
const bob: AgentIdentity = { id: "bob-id", type: "ai" };
const charlie: AgentIdentity = { id: "charlie-id", type: "ai" };

function makeAction(overrides?: Partial<AgentAction>): AgentAction {
  return {
    id: "action-1",
    actor: bob,
    scope: {
      domain: "api.stripe.com",
      operations: ["read"],
    },
    timestamp: now,
    ...overrides,
  };
}

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

describe("Security: Timestamp spoofing prevention", () => {
  let service: AuthService;

  beforeEach(() => {
    service = new AuthService();
  });

  it("expired token is rejected even when action.timestamp is in the past", async () => {
    // Token that expired 1 second ago
    const justExpired = new Date(Date.now() - 1000).toISOString();
    await service.issueToken(
      makeRootToken({ expiry: justExpired as `${string}Z` }),
    );

    // Action with old timestamp where token was still valid
    const action = makeAction({ timestamp: "2020-01-01T00:00:00Z" });
    const result = await service.evaluateAndConsume("token-root", action, "10");
    const decision = result as AuthorizationDecision;
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("TOKEN_EXPIRED");
  });
});

describe("Security: Negative/zero amount rejection in consumeIfAvailable", () => {
  let service: AuthService;

  beforeEach(() => {
    service = new AuthService();
  });

  it("rejects negative amount", async () => {
    await service.issueToken(makeRootToken());
    const result = await service.consumeIfAvailable(
      "token-root",
      "-10",
      "action-neg",
    );
    expect(result.allowed).toBe(false);
  });

  it("rejects zero amount", async () => {
    await service.issueToken(makeRootToken());
    const result = await service.consumeIfAvailable(
      "token-root",
      "0",
      "action-zero",
    );
    expect(result.allowed).toBe(false);
  });

  it("rejects non-integer string", async () => {
    await service.issueToken(makeRootToken());
    const result = await service.consumeIfAvailable(
      "token-root",
      "abc",
      "action-abc",
    );
    expect(result.allowed).toBe(false);
  });

  it("accepts valid positive integer", async () => {
    await service.issueToken(makeRootToken());
    const result = await service.consumeIfAvailable(
      "token-root",
      "10",
      "action-ok",
    );
    expect(result.allowed).toBe(true);
  });
});

describe("Security: Parent chain cycle detection", () => {
  it("does not hang on circular parent references", async () => {
    const tokenStore = new InMemoryTokenStore();
    const ledgerStore = new InMemoryBudgetLedgerStore();
    const service = new AuthService({ tokenStore, ledgerStore });

    // Create a cycle: A -> B -> A
    const tokenA: AuthorizationToken = {
      id: "token-a",
      parentTokenId: "token-b",
      issuedBy: alice,
      issuedTo: bob,
      scopes: [{ domain: "api.stripe.com", operations: ["read"] }],
      budget: { limit: "1000", currency: "credits" },
      expiry: futureExpiry,
      status: "active",
    };
    const tokenB: AuthorizationToken = {
      id: "token-b",
      parentTokenId: "token-a",
      issuedBy: bob,
      issuedTo: charlie,
      scopes: [{ domain: "api.stripe.com", operations: ["read"] }],
      budget: { limit: "500", currency: "credits" },
      expiry: futureExpiry,
      status: "active",
    };
    tokenStore.set(tokenA);
    tokenStore.set(tokenB);

    const action = makeAction({ actor: bob });

    // Should complete without hanging, returning PARENT_TOKEN_INACTIVE due to cycle
    const result = await service.evaluateAndConsume("token-a", action, "10");
    const decision = result as AuthorizationDecision;
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("PARENT_TOKEN_INACTIVE");
  });
});

describe("Security: Root token field validation at issuance", () => {
  let service: AuthService;

  beforeEach(() => {
    service = new AuthService();
  });

  it("rejects token with invalid budget limit (negative)", async () => {
    await expect(
      service.issueToken(
        makeRootToken({ budget: { limit: "-100", currency: "credits" } }),
      ),
    ).rejects.toThrow("Token budget limit must be a positive integer string");
  });

  it("rejects token with invalid budget limit (zero)", async () => {
    await expect(
      service.issueToken(
        makeRootToken({ budget: { limit: "0", currency: "credits" } }),
      ),
    ).rejects.toThrow("Token budget limit must be a positive integer string");
  });

  it("rejects token with invalid budget limit (non-numeric)", async () => {
    await expect(
      service.issueToken(
        makeRootToken({ budget: { limit: "abc", currency: "credits" } }),
      ),
    ).rejects.toThrow("Token budget limit must be a positive integer string");
  });

  it("rejects token with invalid expiry format", async () => {
    await expect(
      service.issueToken(makeRootToken({ expiry: "not-a-date" as never })),
    ).rejects.toThrow("Token expiry must be a valid RFC 3339 datetime string");
  });

  it("accepts token with valid fields", async () => {
    const token = await service.issueToken(makeRootToken());
    expect(token.id).toBe("token-root");
  });
});
