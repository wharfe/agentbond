import type { AgentIdentity } from "./identity.js";
import type { IsoDatetime } from "./types.js";

export interface SettlementHook {
  provider: "mock" | "stripe" | "coinbase" | "onchain" | `custom:${string}`;
  endpoint?: string;
}

export type SettlementTrigger =
  | "manual"
  | "contract_completed"
  | "budget_depleted";

export type SettlementStatus = "pending" | "completed" | "failed";

export interface SettlementRequest {
  id: string;
  from: AgentIdentity;
  to: AgentIdentity;
  amount: string; // Positive integer string only
  currency: "credits"; // MVP: credits only
  trigger: SettlementTrigger;
  contractId?: string;
  authorizationTokenRef?: string;
  metadata?: Record<string, unknown>;
}

export interface SettlementResult {
  success: boolean;
  providerRef?: string;
  txHash?: string;
  error?: string;
}

export interface SettlementRecord {
  id: string;
  request: SettlementRequest;
  result: SettlementResult;
  provider: string;
  status: SettlementStatus;
  createdAt: IsoDatetime;
}

export interface SettlementDecision {
  allowed: boolean;
  reasonCode: SettlementReasonCode;
  message: string;
  retryable: boolean;
  evaluatedAt: IsoDatetime;
  settlementId?: string;
}

export type SettlementReasonCode =
  | "ALLOWED"
  | "SETTLEMENT_NOT_FOUND"
  | "PROVIDER_NOT_FOUND"
  | "PROVIDER_ERROR"
  | "CONTRACT_NOT_FOUND"
  | "CONTRACT_NOT_COMPLETED"
  | "INVALID_INPUT";

export interface SettlementProvider {
  name: string;
  execute(request: SettlementRequest): Promise<SettlementResult>;
}

export interface SettlementStore {
  save(record: SettlementRecord): Promise<void>;
  findById(id: string): Promise<SettlementRecord | null>;
  findByContractId(contractId: string): Promise<SettlementRecord[]>;
}

export interface SettlementProviderRegistry {
  register(provider: SettlementProvider): void;
  get(name: string): SettlementProvider | null;
}

export interface SettlementTriggerHook {
  trigger: Exclude<SettlementTrigger, "manual">;
  contractId?: string;
  handler: (request: SettlementRequest) => Promise<void>;
}
