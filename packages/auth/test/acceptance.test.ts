import { describe, it, expect, beforeEach } from "vitest";
import type {
  AuthorizationToken,
  AgentIdentity,
  AgentAction,
  AuthorizationDecision,
} from "@agentbond/core";
import { AuthService, type ValidationError } from "../src/index.js";

// Test helpers
const futureExpiry = "2099-01-01T00:00:00Z";
const pastExpiry = "2020-01-01T00:00:00Z";
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

function isValidationError(
  result: AuthorizationDecision | ValidationError,
): result is ValidationError {
  return "ok" in result && result.ok === false;
}

describe("Authorization Acceptance Tests", () => {
  let service: AuthService;

  beforeEach(() => {
    service = new AuthService();
  });

  it("TC-01: valid token with matching scope → ALLOWED", async () => {
    await service.issueToken(makeRootToken());
    const action = makeAction({
      scope: {
        domain: "api.stripe.com",
        operations: ["read"],
        resources: ["/invoices/123"],
      },
    });
    const result = await service.evaluateAndConsume("token-root", action, "10");
    expect(isValidationError(result)).toBe(false);
    const decision = result as AuthorizationDecision;
    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("ALLOWED");
    expect(decision.message).toBe("Authorization granted");
  });

  it("TC-02: expired token → TOKEN_EXPIRED", async () => {
    await service.issueToken(makeRootToken({ expiry: pastExpiry }));
    const action = makeAction();
    const result = await service.evaluateAndConsume("token-root", action, "10");
    const decision = result as AuthorizationDecision;
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("TOKEN_EXPIRED");
    expect(decision.message).toBe("Authorization token has expired");
    expect(decision.retryable).toBe(false);
  });

  it("TC-03: revoked token → TOKEN_REVOKED", async () => {
    await service.issueToken(makeRootToken({ status: "revoked" }));
    const action = makeAction();
    const result = await service.evaluateAndConsume("token-root", action, "10");
    const decision = result as AuthorizationDecision;
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("TOKEN_REVOKED");
    expect(decision.message).toBe("Authorization token has been revoked");
    expect(decision.retryable).toBe(false);
  });

  it("TC-04: action on non-matching domain → SCOPE_MISMATCH", async () => {
    await service.issueToken(makeRootToken());
    const action = makeAction({
      scope: {
        domain: "api.paypal.com",
        operations: ["read"],
      },
    });
    const result = await service.evaluateAndConsume("token-root", action, "10");
    const decision = result as AuthorizationDecision;
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("SCOPE_MISMATCH");
    expect(decision.message).toBe(
      "Requested action is outside authorized scope",
    );
  });

  it("TC-05: action with non-matching operation → SCOPE_MISMATCH", async () => {
    await service.issueToken(makeRootToken());
    const action = makeAction({
      scope: {
        domain: "api.stripe.com",
        operations: ["delete"],
        resources: ["/invoices/123"],
      },
    });
    const result = await service.evaluateAndConsume("token-root", action, "10");
    const decision = result as AuthorizationDecision;
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("SCOPE_MISMATCH");
  });

  it("TC-06: action exceeding budget → BUDGET_EXCEEDED", async () => {
    await service.issueToken(makeRootToken({ budget: { limit: "100", currency: "credits" } }));
    const action = makeAction({
      scope: {
        domain: "api.stripe.com",
        operations: ["read"],
        resources: ["/invoices/123"],
      },
    });
    const result = await service.evaluateAndConsume("token-root", action, "101");
    const decision = result as AuthorizationDecision;
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("BUDGET_EXCEEDED");
    expect(decision.message).toBe("Insufficient budget for this action");
    expect(decision.retryable).toBe(true);
  });

  it("TC-07: child token with revoked parent → PARENT_TOKEN_INACTIVE (child status unchanged)", async () => {
    await service.issueToken(makeRootToken());
    await service.issueToken({
      id: "token-child",
      parentTokenId: "token-root",
      issuedBy: bob,
      issuedTo: charlie,
      scopes: [
        {
          domain: "api.stripe.com",
          operations: ["read"],
          resources: ["/invoices/123"],
        },
      ],
      budget: { limit: "500", currency: "credits" },
      expiry: futureExpiry,
      status: "active",
    });

    // Revoke the parent
    service.updateTokenStatus("token-root", "revoked");

    const action = makeAction({
      actor: charlie,
      scope: {
        domain: "api.stripe.com",
        operations: ["read"],
        resources: ["/invoices/123"],
      },
    });
    const result = await service.evaluateAndConsume("token-child", action, "10");
    const decision = result as AuthorizationDecision;
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("PARENT_TOKEN_INACTIVE");
    expect(decision.message).toBe("Parent token in chain is inactive");
    expect(decision.retryable).toBe(true);

    // Child token status should NOT have been changed
    const childToken = service.getToken("token-child");
    expect(childToken?.status).toBe("active");
  });

  it("TC-08: issuing child token with wider scope than parent → rejection error", async () => {
    await service.issueToken(makeRootToken());
    await expect(
      service.issueToken({
        id: "token-bad-child",
        parentTokenId: "token-root",
        issuedBy: bob,
        issuedTo: charlie,
        scopes: [
          {
            domain: "api.stripe.com",
            operations: ["read", "write", "charge"], // 'charge' not in parent
          },
        ],
        budget: { limit: "500", currency: "credits" },
        expiry: futureExpiry,
        status: "active",
      }),
    ).rejects.toThrow("Child token scopes must be a subset of parent token scopes");
  });

  it("TC-09: concurrent consumption requests have correct total", async () => {
    await service.issueToken(
      makeRootToken({ budget: { limit: "100", currency: "credits" } }),
    );

    const makeConsumeAction = (id: string): AgentAction => ({
      id,
      actor: bob,
      scope: {
        domain: "api.stripe.com",
        operations: ["read"],
        resources: ["/invoices/123"],
      },
      timestamp: now,
    });

    // Fire two concurrent consumption requests
    const [result1, result2] = await Promise.all([
      service.evaluateAndConsume(
        "token-root",
        makeConsumeAction("action-a"),
        "60",
      ),
      service.evaluateAndConsume(
        "token-root",
        makeConsumeAction("action-b"),
        "60",
      ),
    ]);

    const d1 = result1 as AuthorizationDecision;
    const d2 = result2 as AuthorizationDecision;

    // At least one should succeed, at least one should fail
    // (because 60 + 60 = 120 > 100)
    const results = [d1.allowed, d2.allowed];
    expect(results).toContain(true);
    expect(results).toContain(false);

    // The failed one should be BUDGET_EXCEEDED
    const failed = d1.allowed ? d2 : d1;
    expect(failed.reasonCode).toBe("BUDGET_EXCEEDED");
  });

  it("TC-10: suspended parent reactivated → child becomes ALLOWED again", async () => {
    await service.issueToken(makeRootToken());
    await service.issueToken({
      id: "token-child",
      parentTokenId: "token-root",
      issuedBy: bob,
      issuedTo: charlie,
      scopes: [
        {
          domain: "api.stripe.com",
          operations: ["read"],
          resources: ["/invoices/123"],
        },
      ],
      budget: { limit: "500", currency: "credits" },
      expiry: futureExpiry,
      status: "active",
    });

    const action = makeAction({
      id: "action-tc10-1",
      actor: charlie,
      scope: {
        domain: "api.stripe.com",
        operations: ["read"],
        resources: ["/invoices/123"],
      },
    });

    // Suspend parent
    service.updateTokenStatus("token-root", "suspended");
    const result1 = await service.evaluateAndConsume("token-child", action, "10");
    expect((result1 as AuthorizationDecision).reasonCode).toBe("PARENT_TOKEN_INACTIVE");

    // Reactivate parent
    service.updateTokenStatus("token-root", "active");
    const action2 = makeAction({
      id: "action-tc10-2",
      actor: charlie,
      scope: {
        domain: "api.stripe.com",
        operations: ["read"],
        resources: ["/invoices/123"],
      },
    });
    const result2 = await service.evaluateAndConsume("token-child", action2, "10");
    expect((result2 as AuthorizationDecision).reasonCode).toBe("ALLOWED");

    // Child token status was never changed
    const childToken = service.getToken("token-child");
    expect(childToken?.status).toBe("active");
  });

  it("TC-11: amount of '0' → INVALID_INPUT", async () => {
    await service.issueToken(makeRootToken());
    const action = makeAction();
    const result = await service.evaluateAndConsume("token-root", action, "0");
    expect(isValidationError(result)).toBe(true);
    const error = result as ValidationError;
    expect(error.error.code).toBe("INVALID_INPUT");
    expect(error.error.retryable).toBe(false);
  });

  it("TC-12: missing required fields → INVALID_INPUT", async () => {
    await service.issueToken(makeRootToken());

    // Missing tokenId
    const result = await service.evaluateAndConsume(
      "",
      makeAction(),
      "10",
    );
    expect(isValidationError(result)).toBe(true);
    const error = result as ValidationError;
    expect(error.error.code).toBe("INVALID_INPUT");
    expect(error.error.message).toContain("tokenId");
  });

  it("TC-13: child token scope exceeds parent scope at evaluation time → PARENT_SCOPE_EXCEEDED", async () => {
    // Simulate a token that bypassed issuance validation (defensive check)
    // We directly set up the token store with an inconsistent child
    await service.issueToken(
      makeRootToken({
        scopes: [
          {
            domain: "api.stripe.com",
            operations: ["read"],
            resources: ["/invoices/*"],
          },
        ],
      }),
    );

    // Manually create a child with wider scope than parent
    // (simulating a bypass of issuance validation)
    await service.issueToken(
      makeRootToken({
        id: "token-wide-parent",
        scopes: [
          {
            domain: "api.stripe.com",
            operations: ["read", "write", "charge"],
          },
        ],
      }),
    );
    // Now create a child referencing the narrow parent but with wide scope
    // We need to force-insert this token. We'll use a workaround:
    // Issue a token with parentTokenId pointing to the narrow root
    // but whose scope exceeds parent scope.
    // The issuer would normally reject this, so we use a fresh service
    // with a pre-populated store.

    const { InMemoryTokenStore, InMemoryBudgetLedgerStore } = await import(
      "../src/index.js"
    );
    const tokenStore = new InMemoryTokenStore();
    const ledgerStore = new InMemoryBudgetLedgerStore();
    const service2 = new AuthService({ tokenStore, ledgerStore });

    // Parent with narrow scope
    const parent: AuthorizationToken = {
      id: "parent-narrow",
      issuedBy: alice,
      issuedTo: bob,
      scopes: [
        {
          domain: "api.stripe.com",
          operations: ["read"],
          resources: ["/invoices/*"],
        },
      ],
      budget: { limit: "1000", currency: "credits" },
      expiry: futureExpiry,
      status: "active",
    };
    tokenStore.set(parent);

    // Child with wider scope (bypassed issuance validation)
    const child: AuthorizationToken = {
      id: "child-wide",
      parentTokenId: "parent-narrow",
      issuedBy: bob,
      issuedTo: charlie,
      scopes: [
        {
          domain: "api.stripe.com",
          operations: ["read", "write"], // 'write' not in parent
          resources: ["/invoices/123"],
        },
      ],
      budget: { limit: "500", currency: "credits" },
      expiry: futureExpiry,
      status: "active",
    };
    tokenStore.set(child);

    // Action uses 'write' which parent doesn't allow
    const action = makeAction({
      actor: charlie,
      scope: {
        domain: "api.stripe.com",
        operations: ["write"],
        resources: ["/invoices/123"],
      },
    });

    const result = await service2.evaluateAndConsume("child-wide", action, "10");
    const decision = result as AuthorizationDecision;
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("PARENT_SCOPE_EXCEEDED");
    expect(decision.message).toBe(
      "Requested scope exceeds parent token scope",
    );
  });

  it("TC-14: child budget exceeds parent remaining balance → PARENT_BUDGET_EXCEEDED", async () => {
    const { InMemoryTokenStore, InMemoryBudgetLedgerStore } = await import(
      "../src/index.js"
    );
    const tokenStore = new InMemoryTokenStore();
    const ledgerStore = new InMemoryBudgetLedgerStore();
    const service2 = new AuthService({ tokenStore, ledgerStore });

    const parent: AuthorizationToken = {
      id: "parent-budget",
      issuedBy: alice,
      issuedTo: bob,
      scopes: [
        {
          domain: "api.stripe.com",
          operations: ["read"],
          resources: ["/invoices/*"],
        },
      ],
      budget: { limit: "100", currency: "credits" },
      expiry: futureExpiry,
      status: "active",
    };
    tokenStore.set(parent);

    // Consume 80 from parent's budget
    await ledgerStore.append({
      id: "ledger-parent-1",
      tokenId: "parent-budget",
      amount: "80",
      actionId: "action-parent-consume",
      timestamp: now,
    });

    // Child with limit=50 (was valid at issuance, now parent only has 20 remaining)
    const child: AuthorizationToken = {
      id: "child-budget",
      parentTokenId: "parent-budget",
      issuedBy: bob,
      issuedTo: charlie,
      scopes: [
        {
          domain: "api.stripe.com",
          operations: ["read"],
          resources: ["/invoices/123"],
        },
      ],
      budget: { limit: "50", currency: "credits" },
      expiry: futureExpiry,
      status: "active",
    };
    tokenStore.set(child);

    const action = makeAction({
      actor: charlie,
      scope: {
        domain: "api.stripe.com",
        operations: ["read"],
        resources: ["/invoices/123"],
      },
    });
    const result = await service2.evaluateAndConsume("child-budget", action, "10");
    const decision = result as AuthorizationDecision;
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("PARENT_BUDGET_EXCEEDED");
    expect(decision.message).toBe(
      "Requested budget exceeds parent token budget",
    );
    expect(decision.retryable).toBe(false);
  });
});
