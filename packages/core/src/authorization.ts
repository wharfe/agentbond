import type { IsoDatetime } from "./types.js";
import type { AgentIdentity } from "./identity.js";
import type { ActionScope } from "./action.js";
import type { IntentPolicy } from "./intent.js";
import type { SettlementHook } from "./settlement.js";

export interface Budget {
  limit: string; // Stringified integer (avoids floating point errors)
  currency: "credits"; // MVP supports credits only. Stripe/Coinbase via adapters later
  resetPolicy?: "per-task" | "per-session" | "never";
}

export interface AuthorizationToken {
  id: string;
  parentTokenId?: string; // Delegation chain link. undefined for root tokens
  issuedBy: AgentIdentity;
  issuedTo: AgentIdentity;
  scopes: ActionScope[];
  budget: Budget;
  expiry: IsoDatetime;
  status: "active" | "suspended" | "revoked";
  // expired is not a status value. Expiry is always determined from the expiry field.
  // Including expired in status would create dual representation and be a bug source.

  // Extension points for lower layers (not implemented in MVP, types only)
  intentPolicy?: IntentPolicy;
  contractRef?: string;
  settlementHook?: SettlementHook;
}

export interface AuthorizationDecision {
  allowed: boolean;
  reasonCode: AuthorizationReasonCode;
  message: string; // Standard messages from authorization.spec.md Section 5.3
  retryable: boolean;
  evaluatedAt: IsoDatetime;
  tokenId?: string;
}

export type AuthorizationReasonCode =
  | "ALLOWED"
  | "TOKEN_NOT_FOUND"
  | "TOKEN_EXPIRED"
  | "TOKEN_REVOKED"
  | "TOKEN_SUSPENDED"
  | "SCOPE_MISMATCH"
  | "BUDGET_EXCEEDED"
  | "PARENT_TOKEN_INACTIVE"
  | "PARENT_SCOPE_EXCEEDED"
  | "PARENT_BUDGET_EXCEEDED";

export interface BudgetLedgerEntry {
  id: string;
  tokenId: string;
  amount: string; // Positive integer strings only ("0", negatives, floats are invalid)
  actionId: string;
  timestamp: IsoDatetime;
}

export interface BudgetLedgerStore {
  append(entry: BudgetLedgerEntry): Promise<void>;
  sumByTokenId(tokenId: string): Promise<string>;
}

export interface BudgetService {
  consumeIfAvailable(
    tokenId: string,
    amount: string,
    actionId: string,
  ): Promise<AuthorizationDecision>;
}
