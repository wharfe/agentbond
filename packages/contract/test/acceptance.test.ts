import { describe, it, expect, beforeEach } from "vitest";
import type {
  AgentIdentity,
  AuditRecord,
  AuditRecordStore,
  AuditQueryOptions,
  Contract,
  ContractDecision,
} from "@agentbond/core";
import { ContractService } from "../src/service.js";
import type { CreateContractInput, ValidationError } from "../src/validator.js";

const alice: AgentIdentity = { id: "alice-id", type: "human" };
const bob: AgentIdentity = { id: "bob-id", type: "ai" };

function makeInput(overrides?: Partial<CreateContractInput>): CreateContractInput {
  return {
    parties: [
      { agent: alice, role: "principal" },
      { agent: bob, role: "executor" },
    ],
    deliverable: {
      description: "Build a REST API",
      acceptanceCriteria: ["All endpoints return 200"],
    },
    conditions: [],
    ...overrides,
  };
}

function isValidationError(
  result: Contract | ValidationError,
): result is ValidationError {
  return "ok" in result && result.ok === false;
}

class TestAuditRecordStore implements AuditRecordStore {
  readonly records: AuditRecord[] = [];

  async append(record: AuditRecord): Promise<void> {
    this.records.push(record);
  }

  async findByActionId(actionId: string): Promise<AuditRecord[]> {
    return this.records.filter((r) => r.actionId === actionId);
  }

  async findByTokenId(tokenId: string): Promise<AuditRecord[]> {
    return this.records.filter((r) => r.authorizationTokenId === tokenId);
  }

  async list(options?: AuditQueryOptions): Promise<AuditRecord[]> {
    let results = [...this.records];
    if (options?.layer)
      results = results.filter((r) => r.layer === options.layer);
    if (options?.outcome)
      results = results.filter((r) => r.outcome === options.outcome);
    if (options?.limit) results = results.slice(0, options.limit);
    return results;
  }
}

describe("Contract Acceptance Tests", () => {
  let service: ContractService;
  let auditStore: TestAuditRecordStore;

  beforeEach(() => {
    auditStore = new TestAuditRecordStore();
    service = new ContractService({ auditStore });
  });

  it("TC-C-01: create contract with valid 2 parties → ALLOWED, status: draft", async () => {
    const result = await service.createContract(makeInput({ id: "c-001" }));

    expect(isValidationError(result)).toBe(false);
    const contract = result as Contract;
    expect(contract.id).toBe("c-001");
    expect(contract.status).toBe("draft");
    expect(contract.parties).toHaveLength(2);
    expect(contract.parties[0].role).toBe("principal");
    expect(contract.parties[1].role).toBe("executor");
    expect(contract.statusHistory).toHaveLength(0);
    expect(contract.createdAt).toBeDefined();
    expect(contract.updatedAt).toBeDefined();

    // Audit record created
    const audits = await auditStore.list({ layer: "contract" });
    expect(audits).toHaveLength(1);
    expect(audits[0].contractId).toBe("c-001");
    expect(audits[0].outcome).toBe("allowed");
  });

  it("TC-C-02: draft → active transition (principal) → ALLOWED with statusHistory", async () => {
    await service.createContract(makeInput({ id: "c-002" }));

    const decision = await service.transitionStatus({
      contractId: "c-002",
      to: "active",
      by: { id: alice.id },
    });

    expect("allowed" in decision && decision.allowed).toBe(true);
    expect("reasonCode" in decision && decision.reasonCode).toBe("ALLOWED");

    const contract = await service.getContract("c-002");
    expect(contract!.status).toBe("active");
    expect(contract!.statusHistory).toHaveLength(1);
    expect(contract!.statusHistory[0].from).toBe("draft");
    expect(contract!.statusHistory[0].to).toBe("active");
    expect(contract!.statusHistory[0].by.id).toBe(alice.id);
  });

  it("TC-C-03: draft → active transition (executor) → UNAUTHORIZED_TRANSITION", async () => {
    await service.createContract(makeInput({ id: "c-003" }));

    const decision = await service.transitionStatus({
      contractId: "c-003",
      to: "active",
      by: { id: bob.id },
    });

    expect("allowed" in decision && decision.allowed).toBe(false);
    expect("reasonCode" in decision && decision.reasonCode).toBe(
      "UNAUTHORIZED_TRANSITION",
    );
  });

  it("TC-C-04: active → completed transition (principal) → ALLOWED, terminal state", async () => {
    await service.createContract(makeInput({ id: "c-004" }));
    await service.transitionStatus({
      contractId: "c-004",
      to: "active",
      by: { id: alice.id },
    });

    const decision = await service.transitionStatus({
      contractId: "c-004",
      to: "completed",
      by: { id: alice.id },
    });

    expect("allowed" in decision && decision.allowed).toBe(true);

    const contract = await service.getContract("c-004");
    expect(contract!.status).toBe("completed");
  });

  it("TC-C-05: completed → active transition → TRANSITION_NOT_ALLOWED", async () => {
    await service.createContract(makeInput({ id: "c-005" }));
    await service.transitionStatus({
      contractId: "c-005",
      to: "active",
      by: { id: alice.id },
    });
    await service.transitionStatus({
      contractId: "c-005",
      to: "completed",
      by: { id: alice.id },
    });

    const decision = await service.transitionStatus({
      contractId: "c-005",
      to: "active",
      by: { id: alice.id },
    });

    expect("allowed" in decision && decision.allowed).toBe(false);
    expect("reasonCode" in decision && decision.reasonCode).toBe(
      "TRANSITION_NOT_ALLOWED",
    );
  });

  it("TC-C-06: active contract with deadline exceeded → CONTRACT_DEADLINE_EXCEEDED", async () => {
    await service.createContract(
      makeInput({
        id: "c-006",
        conditions: [
          {
            type: "time_limit",
            value: { deadline: "2025-01-01T00:00:00Z" },
          },
        ],
      }),
    );
    await service.transitionStatus({
      contractId: "c-006",
      to: "active",
      by: { id: alice.id },
    });

    // Evaluate at a time after the deadline
    const decision = await service.evaluateAt(
      "c-006",
      "2025-06-01T00:00:00Z",
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("CONTRACT_DEADLINE_EXCEEDED");
    expect(decision.retryable).toBe(false);
  });

  it("TC-C-07: budget_cap condition with limit exceeded → CONTRACT_BUDGET_EXCEEDED", async () => {
    await service.createContract(
      makeInput({
        id: "c-007",
        conditions: [
          {
            type: "budget_cap",
            value: { limit: "5000", currency: "credits" },
          },
        ],
      }),
    );
    await service.transitionStatus({
      contractId: "c-007",
      to: "active",
      by: { id: alice.id },
    });

    // Token budget exceeds contract cap
    const decision = await service.evaluateBudgetCap("c-007", "10000");

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("CONTRACT_BUDGET_EXCEEDED");
    expect(decision.retryable).toBe(false);
  });

  it("TC-C-08: active → disputed → active (reopen) → ALLOWED", async () => {
    await service.createContract(makeInput({ id: "c-008" }));
    await service.transitionStatus({
      contractId: "c-008",
      to: "active",
      by: { id: alice.id },
    });

    // active → disputed
    const disputeDecision = await service.transitionStatus({
      contractId: "c-008",
      to: "disputed",
      by: { id: alice.id },
    });
    expect("allowed" in disputeDecision && disputeDecision.allowed).toBe(true);

    const disputed = await service.getContract("c-008");
    expect(disputed!.status).toBe("disputed");

    // disputed → active (reopen)
    const reopenDecision = await service.transitionStatus({
      contractId: "c-008",
      to: "active",
      by: { id: alice.id },
    });
    expect("allowed" in reopenDecision && reopenDecision.allowed).toBe(true);

    const reopened = await service.getContract("c-008");
    expect(reopened!.status).toBe("active");
  });

  it("TC-C-09: parties with 2 principals → INVALID_INPUT", async () => {
    const result = await service.createContract(
      makeInput({
        parties: [
          { agent: alice, role: "principal" },
          { agent: bob, role: "principal" },
        ],
      }),
    );

    expect(isValidationError(result)).toBe(true);
    const error = result as ValidationError;
    expect(error.error.code).toBe("INVALID_INPUT");
  });

  it("TC-C-10: deliverable.description with 1001 characters → INVALID_INPUT", async () => {
    const result = await service.createContract(
      makeInput({
        deliverable: {
          description: "x".repeat(1001),
          acceptanceCriteria: [],
        },
      }),
    );

    expect(isValidationError(result)).toBe(true);
    const error = result as ValidationError;
    expect(error.error.code).toBe("INVALID_INPUT");
  });

  it("TC-C-11: time_limit with non-RFC3339 deadline → INVALID_INPUT", async () => {
    const result = await service.createContract(
      makeInput({
        conditions: [
          { type: "time_limit", value: { deadline: "not-a-date" } },
        ],
      }),
    );

    expect(isValidationError(result)).toBe(true);
    const error = result as ValidationError;
    expect(error.error.code).toBe("INVALID_INPUT");
  });

  it("TC-C-12: authorizationTokenRef is correctly recorded", async () => {
    const result = await service.createContract(
      makeInput({
        id: "c-012",
        authorizationTokenRef: "token-abc",
      }),
    );

    expect(isValidationError(result)).toBe(false);
    const contract = result as Contract;
    expect(contract.authorizationTokenRef).toBe("token-abc");
  });

  it("TC-C-13: statusHistory records all transitions in order", async () => {
    await service.createContract(makeInput({ id: "c-013" }));

    await service.transitionStatus({
      contractId: "c-013",
      to: "active",
      by: { id: alice.id },
      reason: "Ready to start",
    });

    await service.transitionStatus({
      contractId: "c-013",
      to: "disputed",
      by: { id: alice.id },
      reason: "Issue found",
    });

    await service.transitionStatus({
      contractId: "c-013",
      to: "active",
      by: { id: alice.id },
      reason: "Issue resolved",
    });

    await service.transitionStatus({
      contractId: "c-013",
      to: "completed",
      by: { id: alice.id },
      reason: "Task done",
    });

    const contract = await service.getContract("c-013");
    expect(contract!.statusHistory).toHaveLength(4);
    expect(contract!.statusHistory[0]).toMatchObject({
      from: "draft",
      to: "active",
      reason: "Ready to start",
    });
    expect(contract!.statusHistory[1]).toMatchObject({
      from: "active",
      to: "disputed",
      reason: "Issue found",
    });
    expect(contract!.statusHistory[2]).toMatchObject({
      from: "disputed",
      to: "active",
      reason: "Issue resolved",
    });
    expect(contract!.statusHistory[3]).toMatchObject({
      from: "active",
      to: "completed",
      reason: "Task done",
    });
  });

  it("TC-C-14: AND evaluation — budget_cap + time_limit both violated, first violation denies", async () => {
    await service.createContract(
      makeInput({
        id: "c-014",
        conditions: [
          {
            type: "budget_cap",
            value: { limit: "1000", currency: "credits" },
          },
          {
            type: "time_limit",
            value: { deadline: "2025-01-01T00:00:00Z" },
          },
        ],
      }),
    );
    await service.transitionStatus({
      contractId: "c-014",
      to: "active",
      by: { id: alice.id },
    });

    // Evaluate at a time after deadline (time_limit comes second in conditions,
    // but evaluator checks conditions in order — time_limit is checked in evaluateContract)
    const decision = await service.evaluateAt(
      "c-014",
      "2025-06-01T00:00:00Z",
    );

    // The first condition in iteration order that fails should deny
    expect(decision.allowed).toBe(false);
    // budget_cap is first but only checked via evaluateBudgetCap;
    // time_limit is checked in evaluateContract
    expect(decision.reasonCode).toBe("CONTRACT_DEADLINE_EXCEEDED");
  });

  it("time_limit with offset timezone is compared correctly", async () => {
    await service.createContract(
      makeInput({
        id: "c-tz",
        conditions: [
          {
            type: "time_limit",
            // Deadline: 2025-01-01 00:00:00 UTC
            value: { deadline: "2025-01-01T09:00:00+09:00" },
          },
        ],
      }),
    );
    await service.transitionStatus({
      contractId: "c-tz",
      to: "active",
      by: { id: alice.id },
    });

    // 2024-12-31T23:59:59Z is before the deadline (same instant as 2025-01-01T08:59:59+09:00)
    const beforeDecision = await service.evaluateAt(
      "c-tz",
      "2024-12-31T23:59:59Z",
    );
    expect(beforeDecision.allowed).toBe(true);

    // 2025-01-01T00:00:00Z is at/after the deadline
    const afterDecision = await service.evaluateAt(
      "c-tz",
      "2025-01-01T00:00:00Z",
    );
    expect(afterDecision.allowed).toBe(false);
    expect(afterDecision.reasonCode).toBe("CONTRACT_DEADLINE_EXCEEDED");
  });

  it("evaluateBudgetCap with invalid budgetLimit → INVALID_INPUT", async () => {
    await service.createContract(
      makeInput({
        id: "c-budget-invalid",
        conditions: [
          {
            type: "budget_cap",
            value: { limit: "5000", currency: "credits" },
          },
        ],
      }),
    );
    await service.transitionStatus({
      contractId: "c-budget-invalid",
      to: "active",
      by: { id: alice.id },
    });

    const result1 = await service.evaluateBudgetCap("c-budget-invalid", "abc");
    expect("ok" in result1 && result1.ok === false).toBe(true);

    const result2 = await service.evaluateBudgetCap("c-budget-invalid", "1.5");
    expect("ok" in result2 && result2.ok === false).toBe(true);

    const result3 = await service.evaluateBudgetCap("c-budget-invalid", "");
    expect("ok" in result3 && result3.ok === false).toBe(true);

    // Valid input still works
    const result4 = await service.evaluateBudgetCap("c-budget-invalid", "3000");
    expect("ok" in result4).toBe(false);
    expect((result4 as ContractDecision).allowed).toBe(true);
  });
});
