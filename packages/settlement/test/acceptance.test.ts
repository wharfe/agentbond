import { describe, it, expect, beforeEach } from "vitest";
import type {
  AgentIdentity,
  AuditRecord,
  AuditRecordStore,
  AuditQueryOptions,
  ContractStore,
  Contract,
  SettlementDecision,
  SettlementProvider,
  SettlementRequest,
  SettlementTriggerHook,
} from "@agentbond/core";
import { SettlementService } from "../src/service.js";
import { InMemoryProviderRegistry, mockProvider } from "../src/provider.js";
import type { CreateSettlementInput, ValidationError } from "../src/validator.js";

const alice: AgentIdentity = { id: "alice-id", type: "human" };
const bob: AgentIdentity = { id: "bob-id", type: "ai" };

function makeInput(
  overrides?: Partial<CreateSettlementInput>,
): CreateSettlementInput {
  return {
    from: alice,
    to: bob,
    amount: "1000",
    currency: "credits",
    trigger: "manual",
    ...overrides,
  };
}

function isValidationError(
  result: SettlementDecision | ValidationError,
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

class TestContractStore implements ContractStore {
  private readonly contracts = new Map<string, Contract>();

  async save(contract: Contract): Promise<void> {
    this.contracts.set(contract.id, contract);
  }

  async findById(id: string): Promise<Contract | null> {
    return this.contracts.get(id) ?? null;
  }

  async findByPartyId(_agentId: string): Promise<Contract[]> {
    return [];
  }

  addContract(contract: Contract): void {
    this.contracts.set(contract.id, contract);
  }
}

function makeContract(
  id: string,
  status: "draft" | "active" | "completed" | "disputed",
): Contract {
  return {
    id,
    parties: [
      { agent: alice, role: "principal" },
      { agent: bob, role: "executor" },
    ],
    deliverable: {
      description: "Test deliverable",
      acceptanceCriteria: [],
    },
    conditions: [],
    status,
    statusHistory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("Settlement Acceptance Tests", () => {
  let service: SettlementService;
  let auditStore: TestAuditRecordStore;
  let contractStore: TestContractStore;

  beforeEach(() => {
    auditStore = new TestAuditRecordStore();
    contractStore = new TestContractStore();
    service = new SettlementService({
      auditStore,
      contractStore,
    });
  });

  it("TC-S-01: manual settlement with mock provider → ALLOWED, record saved", async () => {
    const decision = await service.createSettlement(
      makeInput({ id: "s-001" }),
    );

    expect(isValidationError(decision)).toBe(false);
    const d = decision as SettlementDecision;
    expect(d.allowed).toBe(true);
    expect(d.reasonCode).toBe("ALLOWED");
    expect(d.settlementId).toBe("s-001");

    const record = await service.getSettlement("s-001");
    expect(record).not.toBeNull();
    expect(record!.provider).toBe("mock");
    expect(record!.status).toBe("completed");
    expect(record!.request.amount).toBe("1000");
    expect(record!.request.currency).toBe("credits");
    expect(record!.result.success).toBe(true);
  });

  it("TC-S-02: settlement without contractId → ALLOWED", async () => {
    const decision = await service.createSettlement(
      makeInput({ id: "s-002" }),
    );

    expect(isValidationError(decision)).toBe(false);
    const d = decision as SettlementDecision;
    expect(d.allowed).toBe(true);
    expect(d.reasonCode).toBe("ALLOWED");
  });

  it("TC-S-03: settlement with contractId and completed contract → ALLOWED", async () => {
    contractStore.addContract(makeContract("contract-003", "completed"));

    const decision = await service.createSettlement(
      makeInput({ id: "s-003", contractId: "contract-003" }),
    );

    expect(isValidationError(decision)).toBe(false);
    const d = decision as SettlementDecision;
    expect(d.allowed).toBe(true);
    expect(d.reasonCode).toBe("ALLOWED");
  });

  it("TC-S-04: settlement with contractId and active contract → CONTRACT_NOT_COMPLETED", async () => {
    contractStore.addContract(makeContract("contract-004", "active"));

    const decision = await service.createSettlement(
      makeInput({ id: "s-004", contractId: "contract-004" }),
    );

    expect(isValidationError(decision)).toBe(false);
    const d = decision as SettlementDecision;
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe("CONTRACT_NOT_COMPLETED");
    expect(d.retryable).toBe(true);
  });

  it("TC-S-05: settlement with non-existent contractId → CONTRACT_NOT_FOUND", async () => {
    const decision = await service.createSettlement(
      makeInput({ id: "s-005", contractId: "non-existent" }),
    );

    expect(isValidationError(decision)).toBe(false);
    const d = decision as SettlementDecision;
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe("CONTRACT_NOT_FOUND");
    expect(d.retryable).toBe(false);
  });

  it("TC-S-06: settlement with non-existent provider → PROVIDER_NOT_FOUND with settlementId", async () => {
    const decision = await service.createSettlement(
      makeInput({ id: "s-006" }),
      "non-existent-provider",
    );

    expect(isValidationError(decision)).toBe(false);
    const d = decision as SettlementDecision;
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe("PROVIDER_NOT_FOUND");
    expect(d.retryable).toBe(false);
    expect(d.settlementId).toBe("s-006");
  });

  it("TC-S-07: amount '0' → INVALID_INPUT", async () => {
    const decision = await service.createSettlement(
      makeInput({ amount: "0" }),
    );

    expect(isValidationError(decision)).toBe(true);
    const error = decision as ValidationError;
    expect(error.error.code).toBe("INVALID_INPUT");
    expect(error.error.message).toContain("amount");
  });

  it("TC-S-08: from and to are the same agent → INVALID_INPUT", async () => {
    const decision = await service.createSettlement(
      makeInput({ from: alice, to: alice }),
    );

    expect(isValidationError(decision)).toBe(true);
    const error = decision as ValidationError;
    expect(error.error.code).toBe("INVALID_INPUT");
    expect(error.error.message).toContain("different");
  });

  it("TC-S-09: settlement creates AuditRecord with settlementId", async () => {
    await service.createSettlement(makeInput({ id: "s-009" }));

    const audits = await auditStore.list({ layer: "settlement" });
    expect(audits).toHaveLength(1);
    expect(audits[0].settlementId).toBe("s-009");
    expect(audits[0].layer).toBe("settlement");
    expect(audits[0].outcome).toBe("allowed");
    expect(audits[0].reason).toBe("ALLOWED");
  });

  it("TC-S-10: get settlement record by ID", async () => {
    await service.createSettlement(makeInput({ id: "s-010" }));

    const record = await service.getSettlement("s-010");
    expect(record).not.toBeNull();
    expect(record!.id).toBe("s-010");
    expect(record!.request.from.id).toBe(alice.id);
    expect(record!.request.to.id).toBe(bob.id);

    // Non-existent ID
    const notFound = await service.getSettlement("non-existent");
    expect(notFound).toBeNull();
  });

  it("TC-S-11: get settlement records by contractId", async () => {
    contractStore.addContract(makeContract("contract-011", "completed"));

    await service.createSettlement(
      makeInput({ id: "s-011a", contractId: "contract-011" }),
    );
    await service.createSettlement(
      makeInput({ id: "s-011b", contractId: "contract-011" }),
    );
    await service.createSettlement(makeInput({ id: "s-011c" })); // no contractId

    const records = await service.getSettlementsByContractId("contract-011");
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.id).sort()).toEqual(["s-011a", "s-011b"]);
  });

  it("TC-S-12: SettlementTriggerHook interface is defined for future auto triggers", async () => {
    // Verify the interface exists and can be used
    const hook: SettlementTriggerHook = {
      trigger: "contract_completed",
      contractId: "contract-012",
      handler: async (_request: SettlementRequest) => {
        // Future implementation
      },
    };

    expect(hook.trigger).toBe("contract_completed");
    expect(hook.contractId).toBe("contract-012");
    expect(typeof hook.handler).toBe("function");

    // Also verify budget_depleted trigger
    const budgetHook: SettlementTriggerHook = {
      trigger: "budget_depleted",
      handler: async () => {},
    };
    expect(budgetHook.trigger).toBe("budget_depleted");
  });

  // Review finding: contract validation denials must produce AuditRecords

  it("CONTRACT_NOT_FOUND denial creates AuditRecord", async () => {
    await service.createSettlement(
      makeInput({ contractId: "non-existent" }),
    );

    const audits = await auditStore.list({ layer: "settlement" });
    expect(audits).toHaveLength(1);
    expect(audits[0].outcome).toBe("denied");
    expect(audits[0].reason).toBe("CONTRACT_NOT_FOUND");
    expect(audits[0].contractId).toBe("non-existent");
  });

  it("CONTRACT_NOT_COMPLETED denial creates AuditRecord", async () => {
    contractStore.addContract(makeContract("contract-active", "active"));

    await service.createSettlement(
      makeInput({ contractId: "contract-active" }),
    );

    const audits = await auditStore.list({ layer: "settlement" });
    expect(audits).toHaveLength(1);
    expect(audits[0].outcome).toBe("denied");
    expect(audits[0].reason).toBe("CONTRACT_NOT_COMPLETED");
    expect(audits[0].contractId).toBe("contract-active");
  });

  // Additional edge case tests

  it("amount with negative value → INVALID_INPUT", async () => {
    const decision = await service.createSettlement(
      makeInput({ amount: "-100" }),
    );

    expect(isValidationError(decision)).toBe(true);
  });

  it("amount with decimal → INVALID_INPUT", async () => {
    const decision = await service.createSettlement(
      makeInput({ amount: "1.5" }),
    );

    expect(isValidationError(decision)).toBe(true);
  });

  it("invalid currency → INVALID_INPUT", async () => {
    const decision = await service.createSettlement(
      makeInput({ currency: "usd" }),
    );

    expect(isValidationError(decision)).toBe(true);
  });

  it("provider error returns PROVIDER_ERROR with retryable=true", async () => {
    const registry = new InMemoryProviderRegistry();
    const failingProvider: SettlementProvider = {
      name: "failing",
      async execute() {
        return { success: false, error: "Service unavailable" };
      },
    };
    registry.register(failingProvider);

    const failService = new SettlementService({
      providerRegistry: registry,
      auditStore,
    });

    const decision = await failService.createSettlement(
      makeInput({ id: "s-fail" }),
      "failing",
    );

    expect(isValidationError(decision)).toBe(false);
    const d = decision as SettlementDecision;
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe("PROVIDER_ERROR");
    expect(d.retryable).toBe(true);

    // Record is saved even on failure
    const record = await failService.getSettlement("s-fail");
    expect(record).not.toBeNull();
    expect(record!.status).toBe("failed");
  });

  it("provider throwing exception returns PROVIDER_ERROR", async () => {
    const registry = new InMemoryProviderRegistry();
    const throwingProvider: SettlementProvider = {
      name: "throwing",
      async execute() {
        throw new Error("Network error");
      },
    };
    registry.register(throwingProvider);

    const throwService = new SettlementService({
      providerRegistry: registry,
      auditStore,
    });

    const decision = await throwService.createSettlement(
      makeInput({ id: "s-throw" }),
      "throwing",
    );

    expect(isValidationError(decision)).toBe(false);
    const d = decision as SettlementDecision;
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe("PROVIDER_ERROR");
    expect(d.retryable).toBe(true);
  });
});
