import type { AgentIdentity } from "./identity.js";

export interface ContractParty {
  agent: AgentIdentity;
  role: "principal" | "executor" | "approver" | "payer" | "payee";
}

export interface Contract {
  id: string;
  parties: ContractParty[];
  deliverable: DeliverableSpec;
  conditions: ContractCondition[];
  status: "draft" | "active" | "completed" | "disputed";
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
