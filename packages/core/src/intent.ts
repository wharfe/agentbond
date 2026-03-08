import type { AgentAction } from "./action.js";

export interface IntentRecord {
  id: string;
  action: AgentAction;
  // Use summary format to avoid storing sensitive information directly
  evidence: {
    type: "human-instruction" | "model-summary" | "system-rule";
    content: string;
  }[];
  triggeredBy?: string;
  confidence?: number; // 0-1
}

export interface IntentPolicy {
  requireReasoning: boolean;
  auditLevel: "none" | "summary" | "full";
}
