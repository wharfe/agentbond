import { describe, it, expect, beforeEach } from "vitest";
import type {
  IntentDecision,
  AuditRecord,
  AuditRecordStore,
  AuditQueryOptions,
} from "@agentbond/core";
import { IntentService, type ValidationError } from "../src/index.js";

// Minimal in-memory AuditRecordStore for testing (avoids auth dependency)
class TestAuditRecordStore implements AuditRecordStore {
  private readonly records: AuditRecord[] = [];
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
    let results = this.records;
    if (options?.layer) results = results.filter((r) => r.layer === options.layer);
    if (options?.outcome) results = results.filter((r) => r.outcome === options.outcome);
    if (options?.limit !== undefined) results = results.slice(0, options.limit);
    return results;
  }
}

const now = "2026-03-08T00:00:00Z";

function isValidationError(
  result: unknown,
): result is ValidationError {
  return (
    typeof result === "object" &&
    result !== null &&
    "ok" in result &&
    (result as ValidationError).ok === false
  );
}

describe("Intent Acceptance Tests", () => {
  let service: IntentService;
  let auditStore: TestAuditRecordStore;

  beforeEach(() => {
    auditStore = new TestAuditRecordStore();
    service = new IntentService({ auditStore });
  });

  it("TC-I-01: requireReasoning: true with 1 evidence → ALLOWED, intentRef populated in AuditRecord", async () => {
    // Record an intent
    const intentResult = await service.recordIntent({
      actionId: "action-001",
      tokenId: "token-001",
      evidence: [
        {
          type: "human-instruction",
          content: "User requested invoice listing",
        },
      ],
      createdAt: now,
    });

    expect(isValidationError(intentResult)).toBe(false);
    const intentRecord = intentResult as Exclude<typeof intentResult, ValidationError>;
    expect(intentRecord.id).toBeDefined();

    // Evaluate with requireReasoning: true
    const decision = await service.evaluateAndRecord({
      actionId: "action-001",
      tokenId: "token-001",
      intentPolicy: { requireReasoning: true, auditLevel: "summary" },
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("ALLOWED");
    expect(decision.message).toBe("Intent recorded successfully");
    expect(decision.intentId).toBe(intentRecord.id);

    // Verify AuditRecord has intentRef
    const auditRecords = await auditStore.list({ layer: "intent" });
    expect(auditRecords.length).toBe(1);
    expect(auditRecords[0].intentRef).toBe(intentRecord.id);
    expect(auditRecords[0].outcome).toBe("allowed");
  });

  it("TC-I-02: requireReasoning: true without IntentRecord → INTENT_REQUIRED, denied AuditRecord", async () => {
    const decision = await service.evaluateAndRecord({
      actionId: "action-002",
      tokenId: "token-001",
      intentPolicy: { requireReasoning: true, auditLevel: "summary" },
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("INTENT_REQUIRED");
    expect(decision.message).toBe(
      "Intent record is required by policy but not provided",
    );
    expect(decision.retryable).toBe(true);

    // Verify AuditRecord
    const auditRecords = await auditStore.list({ layer: "intent" });
    expect(auditRecords.length).toBe(1);
    expect(auditRecords[0].outcome).toBe("denied");
    expect(auditRecords[0].reason).toBe("INTENT_REQUIRED");
  });

  it("TC-I-03: requireReasoning: false without IntentRecord → ALLOWED", async () => {
    const decision = await service.evaluateAndRecord({
      actionId: "action-003",
      tokenId: "token-001",
      intentPolicy: { requireReasoning: false, auditLevel: "summary" },
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("ALLOWED");
  });

  it("TC-I-04: empty evidence array → INVALID_INPUT", async () => {
    const result = await service.recordIntent({
      actionId: "action-004",
      tokenId: "token-001",
      evidence: [],
      createdAt: now,
    });

    expect(isValidationError(result)).toBe(true);
    const error = result as ValidationError;
    expect(error.error.code).toBe("INVALID_INPUT");
    expect(error.error.message).toContain("at least 1");
  });

  it("TC-I-05: evidence content of 1001 characters → INVALID_INPUT", async () => {
    const longContent = "a".repeat(1001);
    const result = await service.recordIntent({
      actionId: "action-005",
      tokenId: "token-001",
      evidence: [
        {
          type: "model-summary",
          content: longContent,
        },
      ],
      createdAt: now,
    });

    expect(isValidationError(result)).toBe(true);
    const error = result as ValidationError;
    expect(error.error.code).toBe("INVALID_INPUT");
    expect(error.error.message).toContain("1000");
  });

  it("TC-I-06: non-existent intentId → INTENT_NOT_FOUND", async () => {
    const decision = await service.evaluateAndRecord({
      actionId: "action-006",
      tokenId: "token-001",
      intentPolicy: { requireReasoning: true, auditLevel: "summary" },
      intentId: "non-existent-intent",
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("INTENT_NOT_FOUND");
    expect(decision.message).toBe("Specified intent record not found");
    expect(decision.retryable).toBe(false);
  });

  it("TC-I-07: auditLevel: 'none' → intentRef NOT recorded in AuditRecord", async () => {
    // Record an intent first
    await service.recordIntent({
      actionId: "action-007",
      tokenId: "token-001",
      evidence: [
        {
          type: "system-rule",
          content: "Scheduled task trigger",
        },
      ],
      createdAt: now,
    });

    // Evaluate with auditLevel: 'none'
    const decision = await service.evaluateAndRecord({
      actionId: "action-007",
      tokenId: "token-001",
      intentPolicy: { requireReasoning: true, auditLevel: "none" },
    });

    expect(decision.allowed).toBe(true);

    // Verify AuditRecord does NOT have intentRef
    const auditRecords = await auditStore.list({ layer: "intent" });
    expect(auditRecords.length).toBe(1);
    expect(auditRecords[0].intentRef).toBeUndefined();
  });

  it("TC-I-08: auditLevel: 'summary' → intentRef recorded in AuditRecord", async () => {
    // Record an intent first
    const intentResult = await service.recordIntent({
      actionId: "action-008",
      tokenId: "token-001",
      evidence: [
        {
          type: "human-instruction",
          content: "User instructed to fetch data",
        },
      ],
      createdAt: now,
    });

    const intentRecord = intentResult as Exclude<typeof intentResult, ValidationError>;

    // Evaluate with auditLevel: 'summary'
    await service.evaluateAndRecord({
      actionId: "action-008",
      tokenId: "token-001",
      intentPolicy: { requireReasoning: true, auditLevel: "summary" },
    });

    // Verify AuditRecord has intentRef
    const auditRecords = await auditStore.list({ layer: "intent" });
    expect(auditRecords.length).toBe(1);
    expect(auditRecords[0].intentRef).toBe(intentRecord.id);
  });

  it("TC-I-09: triggeredBy specified → task chain is traceable", async () => {
    // Record parent task intent
    const parentResult = await service.recordIntent({
      id: "intent-parent",
      actionId: "action-parent",
      tokenId: "token-001",
      evidence: [
        {
          type: "human-instruction",
          content: "Generate monthly report",
        },
      ],
      createdAt: now,
    });

    const parentIntent = parentResult as Exclude<typeof parentResult, ValidationError>;

    // Record child task intent with triggeredBy
    const childResult = await service.recordIntent({
      id: "intent-child",
      actionId: "action-child",
      tokenId: "token-001",
      evidence: [
        {
          type: "model-summary",
          content: "Fetching invoice data as part of monthly report",
        },
      ],
      triggeredBy: parentIntent.id,
      createdAt: now,
    });

    const childIntent = childResult as Exclude<typeof childResult, ValidationError>;
    expect(childIntent.triggeredBy).toBe("intent-parent");

    // Verify task chain is traceable
    const retrieved = await service.getIntent("intent-child");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.triggeredBy).toBe("intent-parent");

    // Can trace back to parent
    const parent = await service.getIntent(retrieved!.triggeredBy!);
    expect(parent).not.toBeNull();
    expect(parent!.id).toBe("intent-parent");
  });

  it("TC-I-10: confidence of 1.1 → INVALID_INPUT", async () => {
    const result = await service.recordIntent({
      actionId: "action-010",
      tokenId: "token-001",
      evidence: [
        {
          type: "model-summary",
          content: "Some reasoning",
        },
      ],
      confidence: 1.1,
      createdAt: now,
    });

    expect(isValidationError(result)).toBe(true);
    const error = result as ValidationError;
    expect(error.error.code).toBe("INVALID_INPUT");
    expect(error.error.message).toContain("confidence");
  });
});

describe("Intent Security Tests", () => {
  let service: IntentService;
  let auditStore: TestAuditRecordStore;

  beforeEach(() => {
    auditStore = new TestAuditRecordStore();
    service = new IntentService({ auditStore });
  });

  it("intentId pointing to a different tokenId is rejected", async () => {
    // Record intent for token-A
    await service.recordIntent({
      id: "intent-for-token-a",
      actionId: "action-X",
      tokenId: "token-A",
      evidence: [{ type: "human-instruction", content: "Do action X" }],
      createdAt: now,
    });

    // Try to use that intent with token-B
    const decision = await service.evaluateAndRecord({
      actionId: "action-X",
      tokenId: "token-B",
      intentPolicy: { requireReasoning: true, auditLevel: "summary" },
      intentId: "intent-for-token-a",
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("INTENT_NOT_FOUND");
  });

  it("intentId pointing to a different actionId is rejected", async () => {
    // Record intent for action-A
    const result = await service.recordIntent({
      id: "intent-for-action-a",
      actionId: "action-A",
      tokenId: "token-001",
      evidence: [{ type: "human-instruction", content: "Do action A" }],
      createdAt: now,
    });
    expect(isValidationError(result)).toBe(false);

    // Try to use that intent for action-B
    const decision = await service.evaluateAndRecord({
      actionId: "action-B",
      tokenId: "token-001",
      intentPolicy: { requireReasoning: true, auditLevel: "summary" },
      intentId: "intent-for-action-a",
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("INTENT_NOT_FOUND");
  });

  it("evidence with null element returns INVALID_INPUT (not TypeError)", async () => {
    const result = await service.recordIntent({
      actionId: "action-null-ev",
      tokenId: "token-001",
      evidence: [null as unknown as { type: "human-instruction"; content: string }],
      createdAt: now,
    });

    expect(isValidationError(result)).toBe(true);
    const error = result as ValidationError;
    expect(error.error.code).toBe("INVALID_INPUT");
    expect(error.error.message).toContain("evidence[0]");
  });

  it("evidence with non-object element returns INVALID_INPUT", async () => {
    const result = await service.recordIntent({
      actionId: "action-str-ev",
      tokenId: "token-001",
      evidence: ["not an object" as unknown as { type: "human-instruction"; content: string }],
      createdAt: now,
    });

    expect(isValidationError(result)).toBe(true);
    const error = result as ValidationError;
    expect(error.error.code).toBe("INVALID_INPUT");
  });

  it("duplicate id is rejected", async () => {
    await service.recordIntent({
      id: "intent-dup",
      actionId: "action-dup-1",
      tokenId: "token-001",
      evidence: [{ type: "system-rule", content: "First record" }],
      createdAt: now,
    });

    await expect(
      service.recordIntent({
        id: "intent-dup",
        actionId: "action-dup-2",
        tokenId: "token-001",
        evidence: [{ type: "system-rule", content: "Duplicate id" }],
        createdAt: now,
      }),
    ).rejects.toThrow("already exists");
  });

  it("duplicate actionId is rejected", async () => {
    await service.recordIntent({
      id: "intent-1",
      actionId: "action-same",
      tokenId: "token-001",
      evidence: [{ type: "system-rule", content: "First" }],
      createdAt: now,
    });

    await expect(
      service.recordIntent({
        id: "intent-2",
        actionId: "action-same",
        tokenId: "token-001",
        evidence: [{ type: "system-rule", content: "Duplicate actionId" }],
        createdAt: now,
      }),
    ).rejects.toThrow("already exists");
  });
});
