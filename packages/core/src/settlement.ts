import type { AgentIdentity } from "./identity.js";

export interface SettlementHook {
  provider: "mock" | "stripe" | "coinbase" | "onchain" | `custom:${string}`;
  endpoint?: string;
}

export interface SettlementRecord {
  id: string;
  from: AgentIdentity;
  to: AgentIdentity;
  amount: string; // Stringified integer
  currency: string;
  trigger: "task_complete" | "budget_depleted" | "manual";
  txHash?: string;
}
