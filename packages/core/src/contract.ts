import type { AgentIdentity } from "./identity.js";
import type { IsoDatetime } from "./types.js";

export interface ContractParty {
  agent: AgentIdentity;
  role: "principal" | "executor" | "approver" | "payer" | "payee";
}

export type ContractStatus = "draft" | "active" | "completed" | "disputed";

export interface ContractStatusTransition {
  from: ContractStatus;
  to: ContractStatus;
  by: AgentIdentity;
  reason?: string;
  timestamp: IsoDatetime;
}

export interface Contract {
  id: string;
  parties: ContractParty[];
  deliverable: DeliverableSpec;
  conditions: ContractCondition[];
  status: ContractStatus;
  statusHistory: ContractStatusTransition[];
  authorizationTokenRef?: string;
  createdAt: IsoDatetime;
  updatedAt: IsoDatetime;
}

export interface DeliverableSpec {
  description: string;
  schema?: Record<string, unknown>; // JSON Schema
  acceptanceCriteria: string[];
}

export interface ContractCondition {
  type: "budget_cap" | "time_limit" | "approval_gate" | "custom";
  value: unknown;
}

export interface ContractDecision {
  allowed: boolean;
  reasonCode: ContractReasonCode;
  message: string;
  retryable: boolean;
  evaluatedAt: IsoDatetime;
  contractId?: string;
}

export type ContractReasonCode =
  | "ALLOWED"
  | "CONTRACT_NOT_FOUND"
  | "CONTRACT_NOT_ACTIVE"
  | "CONTRACT_DEADLINE_EXCEEDED"
  | "CONTRACT_BUDGET_EXCEEDED"
  | "TRANSITION_NOT_ALLOWED"
  | "UNAUTHORIZED_TRANSITION"
  | "INVALID_INPUT";

export interface ContractStore {
  save(contract: Contract): Promise<void>;
  findById(id: string): Promise<Contract | null>;
  findByPartyId(agentId: string): Promise<Contract[]>;
}
