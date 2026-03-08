import type {
  Contract,
  ContractDecision,
  ContractStatus,
  ContractStore,
  AuditRecordStore,
  IsoDatetime,
} from "@agentbond/core";
import { evaluateContract, makeDecision } from "./evaluator.js";
import { validateTransition } from "./transitioner.js";
import { InMemoryContractStore } from "./store.js";
import {
  validateCreateContractInput,
  validateTransitionInput,
  type CreateContractInput,
  type TransitionInput,
  type ValidationError,
} from "./validator.js";

export interface ContractServiceOptions {
  contractStore?: ContractStore;
  auditStore?: AuditRecordStore;
}

/**
 * Orchestration layer for contract operations.
 * Ties evaluator + transitioner + store + audit together.
 */
export class ContractService {
  private readonly contractStore: ContractStore;
  private readonly auditStore: AuditRecordStore | undefined;

  constructor(options?: ContractServiceOptions) {
    this.contractStore = options?.contractStore ?? new InMemoryContractStore();
    this.auditStore = options?.auditStore;
  }

  /**
   * Create a new contract in draft status.
   */
  async createContract(
    input: CreateContractInput,
  ): Promise<Contract | ValidationError> {
    const validationError = validateCreateContractInput(input);
    if (validationError) {
      return validationError;
    }

    const now = new Date().toISOString() as IsoDatetime;
    const id =
      input.id ??
      `contract-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const contract: Contract = {
      id,
      parties: input.parties,
      deliverable: input.deliverable,
      conditions: input.conditions,
      status: "draft",
      statusHistory: [],
      authorizationTokenRef: input.authorizationTokenRef,
      createdAt: now,
      updatedAt: now,
    };

    await this.contractStore.save(contract);

    if (this.auditStore) {
      await this.auditStore.append({
        id: `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        actionId: `create-${id}`,
        contractId: id,
        layer: "contract",
        outcome: "allowed",
        reason: "ALLOWED",
        timestamp: now,
      });
    }

    return contract;
  }

  /**
   * Transition a contract's status.
   */
  async transitionStatus(
    input: TransitionInput,
  ): Promise<ContractDecision | ValidationError> {
    const validationError = validateTransitionInput(input);
    if (validationError) {
      return validationError;
    }

    const now = new Date().toISOString() as IsoDatetime;

    const contract = await this.contractStore.findById(input.contractId);
    if (!contract) {
      return makeDecision("CONTRACT_NOT_FOUND", now);
    }

    const to = input.to as ContractStatus;
    const decision = validateTransition(contract, to, input.by.id, now);

    if (decision.allowed) {
      const from = contract.status;

      // Find the principal agent identity for the transition record
      const principal = contract.parties.find((p) => p.role === "principal")!;

      contract.status = to;
      contract.statusHistory.push({
        from,
        to,
        by: principal.agent,
        reason: input.reason,
        timestamp: now,
      });
      contract.updatedAt = now;

      await this.contractStore.save(contract);
    }

    if (this.auditStore) {
      await this.auditStore.append({
        id: `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        actionId: `transition-${input.contractId}-${input.to}`,
        contractId: input.contractId,
        layer: "contract",
        outcome: decision.allowed ? "allowed" : "denied",
        reason: decision.reasonCode,
        timestamp: now,
      });
    }

    return decision;
  }

  /**
   * Evaluate whether a contract is valid for operations (active, conditions met).
   */
  async evaluate(contractId: string): Promise<ContractDecision> {
    const now = new Date().toISOString() as IsoDatetime;
    return evaluateContract({ contractStore: this.contractStore }, { contractId, now });
  }

  /**
   * Evaluate with an explicit timestamp (for testing deadline conditions).
   */
  async evaluateAt(
    contractId: string,
    now: IsoDatetime,
  ): Promise<ContractDecision> {
    return evaluateContract({ contractStore: this.contractStore }, { contractId, now });
  }

  /**
   * Check budget_cap condition against a given budget limit.
   */
  async evaluateBudgetCap(
    contractId: string,
    budgetLimit: string,
  ): Promise<ContractDecision | ValidationError> {
    const now = new Date().toISOString() as IsoDatetime;

    if (
      !budgetLimit ||
      typeof budgetLimit !== "string" ||
      !/^[1-9]\d*$/.test(budgetLimit)
    ) {
      return {
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message: "budgetLimit must be a positive integer string",
          retryable: false,
        },
      };
    }

    const contract = await this.contractStore.findById(contractId);
    if (!contract) {
      return makeDecision("CONTRACT_NOT_FOUND", now);
    }

    if (contract.status !== "active") {
      return makeDecision("CONTRACT_NOT_ACTIVE", now, contract.id);
    }

    for (const cond of contract.conditions) {
      if (cond.type === "budget_cap") {
        const value = cond.value as { limit: string };
        if (BigInt(budgetLimit) > BigInt(value.limit)) {
          return makeDecision("CONTRACT_BUDGET_EXCEEDED", now, contract.id);
        }
      }
    }

    return makeDecision("ALLOWED", now, contract.id);
  }

  /**
   * Get a contract by ID.
   */
  async getContract(id: string): Promise<Contract | null> {
    return this.contractStore.findById(id);
  }

  /**
   * Get contracts by party agent ID.
   */
  async getContractsByPartyId(agentId: string): Promise<Contract[]> {
    return this.contractStore.findByPartyId(agentId);
  }
}
