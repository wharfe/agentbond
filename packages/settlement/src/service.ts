import type {
  SettlementRecord,
  SettlementDecision,
  SettlementRequest,
  SettlementStore,
  SettlementProviderRegistry,
  AuditRecordStore,
  ContractStore,
  IsoDatetime,
} from "@agentbond/core";
import { executeSettlement, makeDecision } from "./executor.js";
import { InMemorySettlementStore } from "./store.js";
import { InMemoryProviderRegistry, mockProvider } from "./provider.js";
import {
  validateCreateSettlementInput,
  type CreateSettlementInput,
  type ValidationError,
} from "./validator.js";

export interface SettlementServiceOptions {
  settlementStore?: SettlementStore;
  providerRegistry?: SettlementProviderRegistry;
  auditStore?: AuditRecordStore;
  contractStore?: ContractStore;
}

/**
 * Orchestration layer for settlement operations.
 * Ties executor + store + provider registry + audit together.
 */
export class SettlementService {
  private readonly settlementStore: SettlementStore;
  private readonly providerRegistry: SettlementProviderRegistry;
  private readonly auditStore: AuditRecordStore | undefined;
  private readonly contractStore: ContractStore | undefined;

  constructor(options?: SettlementServiceOptions) {
    this.settlementStore =
      options?.settlementStore ?? new InMemorySettlementStore();

    if (options?.providerRegistry) {
      this.providerRegistry = options.providerRegistry;
    } else {
      const registry = new InMemoryProviderRegistry();
      registry.register(mockProvider);
      this.providerRegistry = registry;
    }

    this.auditStore = options?.auditStore;
    this.contractStore = options?.contractStore;
  }

  /**
   * Create and execute a settlement.
   */
  async createSettlement(
    input: CreateSettlementInput,
    providerName = "mock",
  ): Promise<SettlementDecision | ValidationError> {
    const validationError = validateCreateSettlementInput(input);
    if (validationError) {
      return validationError;
    }

    const now = new Date().toISOString() as IsoDatetime;

    // If contractId is specified, validate the contract
    if (input.contractId && this.contractStore) {
      const contract = await this.contractStore.findById(input.contractId);
      if (!contract) {
        const decision = makeDecision("CONTRACT_NOT_FOUND", now);
        await this.appendAudit("contract-check", input.contractId, decision, now);
        return decision;
      }
      if (contract.status !== "completed") {
        const decision = makeDecision("CONTRACT_NOT_COMPLETED", now);
        await this.appendAudit("contract-check", input.contractId, decision, now);
        return decision;
      }
    } else if (input.contractId && !this.contractStore) {
      // contractId specified but no contract store available
      const decision = makeDecision("CONTRACT_NOT_FOUND", now);
      await this.appendAudit("contract-check", input.contractId, decision, now);
      return decision;
    }

    const id =
      input.id ??
      `settlement-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const request: SettlementRequest = {
      id,
      from: input.from,
      to: input.to,
      amount: input.amount,
      currency: input.currency as "credits",
      trigger: input.trigger,
      contractId: input.contractId,
      authorizationTokenRef: input.authorizationTokenRef,
      metadata: input.metadata,
    };

    const { record, decision } = await executeSettlement(
      { providerRegistry: this.providerRegistry },
      request,
      providerName,
      now,
    );

    await this.settlementStore.save(record);
    await this.appendAudit(`settlement-${id}`, input.contractId, decision, now, id);

    return decision;
  }

  private async appendAudit(
    actionId: string,
    contractId: string | undefined,
    decision: SettlementDecision,
    timestamp: IsoDatetime,
    settlementId?: string,
  ): Promise<void> {
    if (this.auditStore) {
      await this.auditStore.append({
        id: `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        actionId,
        settlementId,
        contractId,
        layer: "settlement",
        outcome: decision.allowed ? "allowed" : "denied",
        reason: decision.reasonCode,
        timestamp,
      });
    }
  }

  /**
   * Get a settlement record by ID.
   */
  async getSettlement(id: string): Promise<SettlementRecord | null> {
    return this.settlementStore.findById(id);
  }

  /**
   * Get settlement records by contract ID.
   */
  async getSettlementsByContractId(
    contractId: string,
  ): Promise<SettlementRecord[]> {
    return this.settlementStore.findByContractId(contractId);
  }
}
