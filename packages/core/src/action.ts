import type { IsoDatetime } from "./types.js";
import type { AgentIdentity } from "./identity.js";

export interface ActionScope {
  domain: string; // e.g. "api.stripe.com", "mcp:filesystem"
  operations: string[]; // e.g. ["read", "write"]
  resources?: string[]; // glob notation, e.g. ["/invoices/*"]
}

export interface AgentAction {
  id: string;
  actor: AgentIdentity;
  scope: ActionScope;
  timestamp: IsoDatetime;

  // References to other layers (optional = layer not in use)
  authorizationRef?: string;
  intentRef?: string;
  contractRef?: string;
  settlementRef?: string;
}
