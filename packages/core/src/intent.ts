import type { IsoDatetime } from "./types.js";

export interface IntentEvidence {
  type: "human-instruction" | "model-summary" | "system-rule";
  content: string; // Max 1000 characters. Summary format only, no raw logs.
}

export interface IntentRecord {
  id: string;
  actionId: string; // Reference to AgentAction.id
  tokenId: string; // Reference to AuthorizationToken.id
  evidence: IntentEvidence[]; // At least 1 required when requireReasoning: true
  triggeredBy?: string; // Parent task ID for task chain tracking
  confidence?: number; // 0-1
  createdAt: IsoDatetime; // Created after action execution
}

export interface IntentPolicy {
  requireReasoning: boolean;
  auditLevel: "none" | "summary" | "full";
}

export interface IntentDecision {
  allowed: boolean;
  reasonCode: IntentReasonCode;
  message: string;
  retryable: boolean;
  evaluatedAt: IsoDatetime;
  intentId?: string;
}

export type IntentReasonCode =
  | "ALLOWED"
  | "INTENT_REQUIRED"
  | "INTENT_NOT_FOUND"
  | "INVALID_INPUT";

export interface IntentStore {
  save(record: IntentRecord): Promise<void>;
  findByActionId(actionId: string): Promise<IntentRecord | null>;
  findById(id: string): Promise<IntentRecord | null>;
}
